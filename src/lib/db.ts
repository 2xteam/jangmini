import mongoose, { type Model, type Schema } from 'mongoose';

/**
 * 이 앱의 DB 이름. **상수다.**
 *
 * 환경 변수로 받지 않는다. 볼트에 같은 사고가 두 번 기록돼 있다 —
 * `process.env.MONGO_DB ?? "type"` 였던 TypeLog 가 2hbk 의 .env.local 을
 * 복사할 때 `MONGO_DB=hamhibokka` 를 함께 들여와, 문서 33건이 남의 DB 로
 * 들어갔다. 오류도 경고도 없었다.
 *
 * URI 경로에 무엇이 적혀 있든 이 값이 이긴다.
 * → my-obsidian-vault / 40-Infra/MongoDB Atlas.md
 */
export const DB_NAME = 'jangmini';

const MONGO_URI = process.env.MONGO_URI;

/**
 * 커넥션 캐시는 프로덕션에서도 globalThis 에 둔다.
 * 서버리스 인스턴스가 재사용될 때 물려받아야 매 요청 새로 연결하지 않는다.
 */
type Cache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};
const globalForMongoose = globalThis as unknown as { _jangminiMongoose?: Cache };
const cache: Cache = (globalForMongoose._jangminiMongoose ??= {
  conn: null,
  promise: null,
});

export async function connectDb() {
  if (cache.conn) return cache.conn;
  if (!MONGO_URI) {
    throw new Error('MONGO_URI 가 설정되지 않았습니다');
  }
  cache.promise ??= mongoose.connect(MONGO_URI, {
    /** URI 경로를 믿지 않는다. 위 주석 참고 */
    dbName: DB_NAME,
    /** 인스턴스가 여러 개 뜨므로 인스턴스당 풀은 작게 */
    maxPoolSize: 5,
    bufferCommands: false,
    serverSelectionTimeoutMS: 20000,
  });
  cache.conn = await cache.promise;
  return cache.conn;
}

/**
 * 모델을 가져오는 유일한 자리.
 *
 * 두 가지를 함께 처리한다.
 *
 * **① 컬렉션 이름을 항상 명시한다.** mongoose 는 모델 이름을 복수로 바꿔
 * 컬렉션 이름을 만드는데, 이 앱은 이름이 섞여 있어 자동 규칙으로 다 맞출 수
 * 없다 — `Portfolio` 는 `portfolios` 가 되지만 Atlas 에 만든 것은 `portfolio`
 * 이고, `ReaderHistory` 는 `readerhistories` 가 된다. 어긋나면 **조용히 새
 * 컬렉션이 생기고** 조회만 0건이 된다. 우연히 맞는 것까지 전부 명시한다.
 *
 * **② 개발 중 스키마가 바뀌면 다시 컴파일한다.** mongoose 는 컴파일한 모델을
 * `mongoose.models` 에 담고 이 객체는 globalThis 에 있어 Next 의 HMR 을 넘어
 * 살아남는다. 그래서 스키마를 고쳐도 옛 모델이 계속 쓰이고, `strict` 가
 * 모르는 경로를 `$set` 에서 조용히 버린다 — **새 필드가 저장되지 않는데
 * 아무도 알려주지 않는다.** HMR 로 모듈이 다시 실행되면 스키마는 새 객체가
 * 되므로 동일성 비교로 알 수 있다. 매 요청마다 지우고 만들지는 않는다.
 */
export function defineModel<T>(name: string, schema: Schema<T>, collection: string): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  if (existing && process.env.NODE_ENV !== 'production' && existing.schema !== schema) {
    mongoose.deleteModel(name);
  }
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema, collection);
}
