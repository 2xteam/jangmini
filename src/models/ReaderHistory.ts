import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/**
 * 질문 이력 **겸 카운터**.
 *
 * 별도 카운터 컬렉션을 두지 않는 이유 — 두면 "제한에 걸렸는데 무슨 질문이었는지
 * 모른다" 가 된다. 세는 것과 남기는 것을 한 곳에서 한다.
 *
 * 대신 **인덱스가 필수**다. 매 요청마다 분·시·일 카운트를 세므로 인덱스가
 * 없으면 컬렉션 전체 스캔이 된다.
 *
 * IP 는 **원문을 저장하지 않는다.** `sha256(ip + IP_HASH_SALT)` 만 둔다.
 */
export type ReaderHistoryDoc = {
  /** 로그인한 reader. 익명이면 null */
  readerId: string | null;
  /** 익명 식별자 (localStorage). 시크릿 창이면 초기화되므로 약하다 */
  clientId: string;
  ipHash: string;
  /** 추천 질문이면 그 key. 자유 입력이면 null */
  suggestionKey: string | null;
  question: string;
  answer: string;
  lang: 'ko' | 'en';
  /** 캐시에서 왔는지 OpenAI 를 불렀는지 — 절감 효과를 보는 값이다 */
  source: 'cache' | 'openai';
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  ua: string | null;
  createdAt?: Date;
};

const schema = new Schema<ReaderHistoryDoc>(
  {
    readerId: { type: String, default: null },
    clientId: { type: String, required: true },
    ipHash: { type: String, required: true },
    suggestionKey: { type: String, default: null },
    question: { type: String, required: true },
    answer: { type: String, default: '' },
    lang: { type: String, default: 'ko' },
    source: { type: String, required: true, enum: ['cache', 'openai'] },
    model: { type: String, default: null },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    ua: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ clientId: 1, createdAt: -1 });
schema.index({ ipHash: 1, createdAt: -1 });
schema.index({ readerId: 1, createdAt: -1 });
/**
 * 90일 뒤 자동 삭제. 질문 로그를 무기한 들고 있지 않는다.
 * 전역 일일 캡은 이 컬렉션이 아니라 `usage` 집계로 판정하므로, 오래된 문서가
 * 사라져도 캡 계산에 영향이 없다.
 */
schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const ReaderHistory = defineModel<ReaderHistoryDoc>(
  'ReaderHistory',
  schema,
  /** ⚠️ 자동 복수화는 `readerhistories` 다. 명시해야 한다 */
  'readers_history',
);
