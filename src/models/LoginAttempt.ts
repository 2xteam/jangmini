import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/**
 * 로그인 실패 기록. **전수 시도를 막는 유일한 장치**다.
 *
 * 초기 비밀번호가 4자리라 10,000회면 전부 시도된다. 게다가 그 계정은
 * admin 권한과 무제한 질문 권한을 함께 갖는다 → src/models/Reader.ts
 *
 * `readers_history` 에 섞지 않는다 — 섞으면 질문 수를 세는 쿼리가 로그인
 * 실패까지 세어 버린다.
 */
export type LoginAttemptDoc = {
  ipHash: string;
  readerId: string;
  ok: boolean;
  createdAt?: Date;
};

const schema = new Schema<LoginAttemptDoc>(
  {
    ipHash: { type: String, required: true },
    readerId: { type: String, required: true },
    ok: { type: Boolean, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ ipHash: 1, createdAt: -1 });
/** 1시간이면 지운다. 잠금 창(15분)보다 넉넉하고 오래 들고 있을 이유가 없다 */
schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 });

export const LoginAttempt = defineModel<LoginAttemptDoc>(
  'LoginAttempt',
  schema,
  'login_attempts',
);
