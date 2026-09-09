import { connectDb } from '@/lib/db';
import { Setting } from '@/models/Setting';

/**
 * 한도 설정을 `settings` 컬렉션에서 읽는다.
 *
 * **환경 변수에 두지 않는 이유** — Vercel 환경 변수는 그 배포를 만들 때
 * 스냅샷된다. 숫자 하나 바꿀 때마다 재배포해야 한다.
 * → my-obsidian-vault / 30-Patterns/Vercel 배포 패턴.md
 *
 * ## 예외 하나 — CHAT_ENABLED
 *
 * 채팅을 켜고 끄는 스위치는 **환경 변수로 남긴다.** DB 를 못 읽는 상황에서도
 * 채팅이 열리지 않아야 하고, DB 가 뚫렸을 때 설정 한 줄로 과금 경로가 열리면
 * 안 된다. `src/app/api/chat/route.ts` 에 있다.
 *
 * ## 메모이즈
 *
 * 매 요청마다 12개 문서를 읽지 않도록 60초 캐시한다. 캐시는 `globalThis` 에
 * 둔다 — 서버리스 인스턴스가 재사용될 때 물려받는다. Admin 에서 값을 바꾸면
 * **최대 60초 뒤** 반영된다(즉시 반영이 필요하면 `invalidateLimits()`).
 */

export type Limits = {
  anonPerMinute: number;
  anonPerHour: number;
  anonPerDay: number;
  globalDailyRequests: number;
  globalDailyTokens: number;
  maxUserChars: number;
  maxMessages: number;
  maxOutputTokens: number;
  maxSteps: number;
  model: string;
  sourceVersion: number;
  welcomeEnabled: boolean;
};

/** settings 를 못 읽을 때 쓰는 값. **막는 쪽으로** 기울여 둔다 */
const FALLBACK: Limits = {
  anonPerMinute: 3,
  anonPerHour: 15,
  anonPerDay: 30,
  globalDailyRequests: 500,
  globalDailyTokens: 500_000,
  maxUserChars: 500,
  maxMessages: 21,
  maxOutputTokens: 800,
  maxSteps: 3,
  model: 'gpt-4o-mini',
  sourceVersion: 1,
  welcomeEnabled: true,
};

const KEYS: Record<keyof Limits, string> = {
  anonPerMinute: 'chat.anon.perMinute',
  anonPerHour: 'chat.anon.perHour',
  anonPerDay: 'chat.anon.perDay',
  globalDailyRequests: 'chat.global.dailyRequests',
  globalDailyTokens: 'chat.global.dailyTokens',
  maxUserChars: 'chat.maxUserChars',
  maxMessages: 'chat.maxMessages',
  maxOutputTokens: 'chat.maxOutputTokens',
  maxSteps: 'chat.maxSteps',
  model: 'chat.model',
  sourceVersion: 'content.sourceVersion',
  welcomeEnabled: 'welcome.enabled',
};

const TTL_MS = 60_000;

type Cache = { value: Limits; at: number } | null;
const g = globalThis as unknown as { _jangminiLimits?: Cache };

export function invalidateLimits() {
  g._jangminiLimits = null;
}

export async function getLimits(): Promise<Limits> {
  const cached = g._jangminiLimits;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  try {
    await connectDb();
    const docs = await Setting.find({ _id: { $in: Object.values(KEYS) } })
      .lean<{ _id: string; value: unknown }[]>();
    const byId = new Map(docs.map((d) => [d._id, d.value]));

    const pick = <K extends keyof Limits>(k: K): Limits[K] => {
      const raw = byId.get(KEYS[k]);
      if (raw === undefined || raw === null) return FALLBACK[k];
      /**
       * 타입을 확인한다. Admin 에서 숫자 칸에 문자열이 들어가면 이후 비교가
       * 전부 조용히 이상해진다 (`"3" > 10` 은 false, `"30" < 5` 도 false).
       */
      if (typeof FALLBACK[k] === 'number') {
        const n = Number(raw);
        return (Number.isFinite(n) ? n : FALLBACK[k]) as Limits[K];
      }
      if (typeof FALLBACK[k] === 'boolean') return Boolean(raw) as Limits[K];
      return (typeof raw === 'string' && raw ? raw : FALLBACK[k]) as Limits[K];
    };

    const value: Limits = {
      anonPerMinute: pick('anonPerMinute'),
      anonPerHour: pick('anonPerHour'),
      anonPerDay: pick('anonPerDay'),
      globalDailyRequests: pick('globalDailyRequests'),
      globalDailyTokens: pick('globalDailyTokens'),
      maxUserChars: pick('maxUserChars'),
      maxMessages: pick('maxMessages'),
      maxOutputTokens: pick('maxOutputTokens'),
      maxSteps: pick('maxSteps'),
      model: pick('model'),
      sourceVersion: pick('sourceVersion'),
      welcomeEnabled: pick('welcomeEnabled'),
    };
    g._jangminiLimits = { value, at: Date.now() };
    return value;
  } catch (err) {
    /**
     * DB 를 못 읽어도 채팅을 열어 둔다 — 대신 FALLBACK(막는 쪽 값)을 쓴다.
     * 여기서 throw 하면 DB 가 잠깐 흔들릴 때 사이트가 통째로 죽는다.
     */
    console.error('[LIMITS] settings 읽기 실패, 폴백 사용:', err instanceof Error ? err.message : err);
    return FALLBACK;
  }
}
