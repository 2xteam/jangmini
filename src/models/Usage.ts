import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/**
 * 일별 사용량 집계. **전역 일일 캡(L3)의 판정 근거**다.
 *
 * `_id` 가 날짜(`YYYY-MM-DD`, Asia/Seoul)다. 하루 한 문서에 `$inc` 로 쌓으므로
 * 캡 판정이 **문서 한 건 읽기**로 끝난다 — `readers_history` 를 세면 매 요청마다
 * 그날 전체를 세야 한다.
 *
 * 익명 제한(L2)이 시크릿 창으로 우회되므로, 실제 방어선은 이 캡과
 * OpenAI 프로젝트 하드 리밋이다.
 */
export type UsageDoc = {
  _id: string;
  requests: number;
  cacheHits: number;
  openaiCalls: number;
  tokensIn: number;
  tokensOut: number;
  blocked: number;
  updatedAt?: Date;
};

const schema = new Schema<UsageDoc>(
  {
    _id: { type: String, required: true },
    requests: { type: Number, default: 0 },
    cacheHits: { type: Number, default: 0 },
    openaiCalls: { type: Number, default: 0 },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    /** 제한에 걸려 막힌 횟수 — 캡이 너무 낮은지 보는 값이다 */
    blocked: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true }, _id: false },
);

export const Usage = defineModel<UsageDoc>('Usage', schema, 'usage');

/** Asia/Seoul 기준 날짜 키. UTC 로 두면 한국 자정과 캡 초기화 시점이 어긋난다 */
export function usageDateKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
