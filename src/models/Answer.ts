import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/**
 * 사전 생성된 답변 캐시. **비용 방어의 L0** 이고 가장 큰 절감 수단이다.
 *
 * 추천 질문의 답변을 미리 한 번 만들어 두고, 방문자가 그 칩을 누르면
 * **OpenAI 를 호출하지 않고** 여기서 읽어 흘려보낸다.
 *
 * ## 왜 자유 입력을 캐시하지 않나
 *
 * 입력 텍스트를 해시하면 "경력이 어떻게 되나요"와 "경력 어떻게 되세요"가
 * 다른 키가 되어 거의 안 맞는다. 반대로 방문자가 조금씩 다른 문장을 던져
 * **이 컬렉션을 쓰레기로 채울** 수도 있다. 그래서 `key` 는 우리가 정한
 * 고정 slug 뿐이다 → src/lib/suggestions.ts
 *
 * ## sourceVersion
 *
 * 콘텐츠를 재수집하면 `settings["content.sourceVersion"]` 을 올린다. 조회는
 * 항상 현재 버전으로만 하므로 **옛 답변은 자동으로 안 맞는다.** 이게 없으면
 * 노션을 고쳐도 챗봇이 옛 이야기를 계속 한다.
 */
export type AnswerDoc = {
  key: string;
  lang: 'ko' | 'en';
  sourceVersion: number;
  answer: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** 사람이 손봤는지. true 면 재생성 스크립트가 건너뛴다 */
  reviewed: boolean;
  hits: number;
  createdAt?: Date;
  updatedAt?: Date;
};

const schema = new Schema<AnswerDoc>(
  {
    key: { type: String, required: true },
    lang: { type: String, required: true, enum: ['ko', 'en'] },
    sourceVersion: { type: Number, required: true },
    answer: { type: String, required: true },
    model: { type: String, required: true },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    reviewed: { type: Boolean, default: false },
    hits: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ key: 1, lang: 1, sourceVersion: 1 }, { unique: true });

export const Answer = defineModel<AnswerDoc>('Answer', schema, 'answers');
