import crypto from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * reader 세션 쿠키.
 *
 * ## myjane 여섯 앱과 완전히 별개다
 *
 * myjane 공용 세션 쿠키 `snap_user` 는 `.myjane.co.kr` 에 붙는다. jangmini 는
 * 그 하위 도메인이라 **그 쿠키가 요청마다 자동으로 도착한다.** 절대 보지 않는다.
 * jangmini 의 로그인 여부는 `jangmini_reader` 하나로만 판단한다.
 *
 * 그리고 이 쿠키는 **호스트 전용**이다 — `domain` 을 지정하지 않는다. 지정하면
 * `.myjane.co.kr` 로 퍼져 여섯 앱에 전송된다.
 * → my-obsidian-vault / 10-Projects/jangmini.md
 *
 * ## 서명
 *
 * 평문 쿠키를 믿지 않는다. `payload.sig` 형태로 HMAC-SHA256 서명을 붙이고,
 * 비교는 **timing-safe** 로 한다.
 *
 * ## admin 세션은 만료시키지 않는다 (2026-09-20 사용자 지시)
 *
 * 원래는 admin 세션 2시간 + 비밀번호 재확인 10분이었다. 이력서를 고치는 일은
 * 한 번에 길게 앉아서 하는 작업이라 **문장을 쓰는 도중에 튕겨 나갔다.**
 * 쓰던 내용을 잃는 것이 실제로 반복해서 일어났다.
 *
 * ⚠️ **맞바꾼 것을 분명히 적어 둔다.** `readers.role` 로 admin 을 구분하므로
 * 이 계정의 비밀번호가 곧 admin 권한이고, 이제 쿠키를 한 번 받은 기기는
 * 사실상 영구히 admin 이다. 기기를 잃었거나 쿠키가 샜다고 판단되면
 * **`SESSION_SECRET` 을 새로 발급**해야 한다 — 그러면 이미 나간 쿠키가
 * 전부 한꺼번에 무효가 된다. 로그아웃만으로는 그 기기 하나뿐이다.
 *
 * 되돌리려면 아래 `ADMIN_TTL_SEC` 와 `STEP_UP_WINDOW_MS` 두 상수만 원래대로
 * 돌리면 된다. 다른 곳은 손대지 않았다.
 */

export const COOKIE_NAME = 'jangmini_reader';

const READER_TTL_SEC = 30 * 24 * 60 * 60;
/**
 * admin 세션 수명. 예전 값은 `2 * 60 * 60` (2시간).
 *
 * 쿠키에 '무한' 은 없다 — `Max-Age` 는 숫자여야 한다. 10년이면 사실상
 * 만료되지 않는다.
 */
const ADMIN_TTL_SEC = 10 * 365 * 24 * 60 * 60;

export type ReaderSession = {
  readerId: string;
  role: 'reader' | 'admin';
  unlimited: boolean;
  dailyCap: number | null;
  /** reader 계정 자체의 만료. 세션 만료와 다르다 */
  expiresAt: number | null;
  /** 세션 만료 (epoch ms) */
  exp: number;
  /** `/admin` 비밀번호 재확인을 통과한 시각. 없으면 admin 화면에 못 들어간다 */
  stepUpAt?: number;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('SESSION_SECRET 이 없거나 너무 짧습니다');
  }
  return s;
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function serializeSession(s: ReaderSession): string {
  const payload = b64(JSON.stringify(s));
  return `${payload}.${sign(payload)}`;
}

export function parseSession(token: string | undefined): ReaderSession | null {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  const expected = sign(payload);
  /**
   * 길이가 다르면 timingSafeEqual 이 throw 한다. 먼저 길이를 본다.
   * 그리고 문자열 비교(`===`)를 쓰지 않는다 — 타이밍으로 서명을 맞출 수 있다.
   */
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ReaderSession;
    if (!s?.readerId || typeof s.exp !== 'number') return null;
    /** 세션 만료 */
    if (Date.now() > s.exp) return null;
    /** 계정 만료 — 세션이 살아 있어도 계정이 지났으면 무효다 */
    if (s.expiresAt != null && Date.now() > s.expiresAt) return null;
    return s;
  } catch {
    return null;
  }
}

export function ttlSecFor(role: 'reader' | 'admin'): number {
  return role === 'admin' ? ADMIN_TTL_SEC : READER_TTL_SEC;
}

/** Set-Cookie 문자열. `domain` 을 **넣지 않는다** (위 주석 참고) */
export function cookieHeader(token: string, maxAgeSec: number): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function clearCookieHeader(): string {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/** 요청 헤더에서 직접 읽는다 (라우트 핸들러용) */
export function sessionFromRequest(req: Request): ReaderSession | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return parseSession(rest.join('='));
  }
  return null;
}

/** 서버 컴포넌트용 */
export async function sessionFromCookies(): Promise<ReaderSession | null> {
  const store = await cookies();
  return parseSession(store.get(COOKIE_NAME)?.value);
}

/**
 * 비밀번호 재확인의 유효 기간.
 *
 * 예전 값은 10분이었고, **이것이 편집 중에 튕기던 진짜 원인**이었다. 한
 * 문장을 오래 붙들고 있으면 저장 버튼을 누르는 순간 창이 이미 닫혀 있었다.
 *
 * `null` 이면 만료를 보지 않는다 — 한 번 확인했으면 계속 유효하다.
 * 다시 조이려면 밀리초를 넣으면 된다 (예: `12 * 60 * 60 * 1000`).
 */
export const STEP_UP_WINDOW_MS: number | null = null;

export function isAdminReady(s: ReaderSession | null): boolean {
  if (!s || s.role !== 'admin') return false;
  /** 재확인 자체는 여전히 필요하다 — 한 번도 안 했으면 못 들어간다 */
  if (!s.stepUpAt) return false;
  if (STEP_UP_WINDOW_MS === null) return true;
  return Date.now() - s.stepUpAt < STEP_UP_WINDOW_MS;
}
