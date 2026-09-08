import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/**
 * 관리자가 **수동으로 발급**하는 계정. 회원가입이 없다.
 *
 * myjane 여섯 앱의 공용 회원(`user` DB)과 **아무 관계가 없다.** 이 앱은 회원을
 * 공유하지 않는다 → my-obsidian-vault / 10-Projects/jangmini.md
 *
 * 로그인은 게이트가 아니다. 익명 방문자도 사이트를 전부 볼 수 있고, 이 계정은
 * **질문 제한을 푸는 용도**다 (채용 담당자는 계정이 없으므로).
 */
export type ReaderDoc = {
  readerId: string;
  /** bcrypt 해시. 평문을 저장하지 않는다 */
  passwordHash: string;
  /** 누구에게 준 계정인지 — 관리자용 메모 */
  label?: string;
  memo?: string;
  /**
   * `admin` 은 /admin 에 들어갈 수 있다.
   *
   * ⚠️ 2026-09-08 사용자 결정으로 admin 을 별도 컬렉션이 아니라 이 필드로
   * 둔다. 그래서 **reader 비밀번호가 곧 admin 권한**이다. 완화책 두 개를
   * 반드시 함께 둔다 —
   *   · /admin 진입 시 비밀번호 재확인, admin 세션 TTL 2시간 (reader 는 30일)
   *   · 로그인 시도 IP 당 15분 5회 잠금 (login_attempts)
   */
  role: 'reader' | 'admin';
  /** null 이면 무기한 */
  expiresAt: Date | null;
  enabled: boolean;
  /**
   * 분·시·일 제한을 면제한다. 다만 `dailyCap` 은 남는다 —
   * 정상 사용에는 걸리지 않는 값이고, 계정이 뚫려도 무한 과금은 막는다
   * (2026-09-08 사용자 결정).
   */
  unlimited: boolean;
  /** 안전 상한. null 이면 상한 없음 */
  dailyCap: number | null;
  lastLoginAt?: Date;
  loginCount: number;
  createdAt?: Date;
  updatedAt?: Date;
};

const schema = new Schema<ReaderDoc>(
  {
    readerId: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    label: String,
    memo: String,
    role: { type: String, required: true, enum: ['reader', 'admin'], default: 'reader' },
    expiresAt: { type: Date, default: null },
    enabled: { type: Boolean, default: true },
    unlimited: { type: Boolean, default: true },
    dailyCap: { type: Number, default: 500 },
    lastLoginAt: Date,
    loginCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ readerId: 1 }, { unique: true });

/**
 * ⚠️ `expiresAt` 에 TTL 인덱스를 걸지 않는다.
 * 걸면 만료된 **계정 자체가 사라진다.** 만료는 로그인 시점에 검사할 일이고,
 * 지난 계정도 관리자가 보고 연장할 수 있어야 한다.
 */

export const Reader = defineModel<ReaderDoc>('Reader', schema, 'readers');
