import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/**
 * 추천 질문.
 *
 * 문장의 원본은 `src/lib/suggestions.ts` 이고, 이 컬렉션은 **운영 상태**를
 * 담는다 — 노출 여부(`enabled`)·순서·클릭 수. Admin 에서 문장을 고치게 되면
 * 그때 원본을 여기로 옮긴다.
 *
 * `key` 는 **답변 캐시의 조회 키**다. 절대 바꾸지 않는다 → src/lib/suggestions.ts
 */
export type SuggestionDoc = {
  key: string;
  category: string;
  question: string;
  primary: boolean;
  enabled: boolean;
  order: number;
  /** 몇 번 눌렸는지 — 추천 질문을 고칠 때 근거가 된다 */
  hits: number;
  createdAt?: Date;
  updatedAt?: Date;
};

const schema = new Schema<SuggestionDoc>(
  {
    key: { type: String, required: true },
    category: { type: String, required: true },
    question: { type: String, required: true },
    primary: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    hits: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ key: 1 }, { unique: true });
schema.index({ enabled: 1, order: 1 });

export const Suggestion = defineModel<SuggestionDoc>('Suggestion', schema, 'suggestions');
