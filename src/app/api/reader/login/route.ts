import bcrypt from 'bcryptjs';
import { connectDb } from '@/lib/db';
import { Reader } from '@/models/Reader';
import { LoginAttempt } from '@/models/LoginAttempt';
import {
  serializeSession,
  cookieHeader,
  ttlSecFor,
  type ReaderSession,
} from '@/lib/reader-session';
import { clientIp, hashIp, isAllowedOrigin } from '@/lib/guard';

/** IP 당 15분에 5회. 초기 비밀번호가 4자리라 이게 없으면 전수 시도가 통한다 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

/**
 * 실패 사유를 구분해서 알려주지 않는다.
 *
 * "그런 아이디가 없습니다" 와 "비밀번호가 틀렸습니다" 를 나누면 **아이디가
 * 존재하는지 알려주는 셈**이다. 계정이 손으로 발급되는 소수라 더 그렇다.
 */
const FAIL_MSG = '아이디 또는 비밀번호가 맞지 않습니다.';

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json(403, { error: '허용되지 않은 요청입니다.' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' });
  }
  const { readerId, password } = (body ?? {}) as { readerId?: unknown; password?: unknown };
  if (typeof readerId !== 'string' || typeof password !== 'string' || !readerId || !password) {
    return json(400, { error: '아이디와 비밀번호를 입력해 주세요.' });
  }
  /** 입력 길이를 제한한다 — bcrypt 는 긴 입력에 비례해 느려진다 */
  if (readerId.length > 64 || password.length > 200) {
    return json(400, { error: '입력이 너무 깁니다.' });
  }

  const ipHash = hashIp(clientIp(req));

  try {
    await connectDb();

    const fails = await LoginAttempt.countDocuments({
      ipHash,
      ok: false,
      createdAt: { $gte: new Date(Date.now() - WINDOW_MS) },
    });
    if (fails >= MAX_FAILS) {
      return json(429, { error: '시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.' });
    }

    const reader = await Reader.findOne({ readerId: readerId.trim() }).lean<{
      readerId: string;
      passwordHash: string;
      role: 'reader' | 'admin';
      enabled: boolean;
      unlimited: boolean;
      dailyCap: number | null;
      expiresAt: Date | null;
    }>();

    /**
     * 계정이 없어도 bcrypt 를 한 번 돌린다. 바로 반환하면 **응답 시간 차이로
     * 아이디의 존재를 알 수 있다.**
     */
    const hash = reader?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!reader || !ok) {
      await LoginAttempt.create({ ipHash, readerId: readerId.slice(0, 64), ok: false });
      return json(401, { error: FAIL_MSG });
    }
    if (!reader.enabled) {
      await LoginAttempt.create({ ipHash, readerId: reader.readerId, ok: false });
      return json(403, { error: '사용이 중지된 계정입니다.' });
    }
    if (reader.expiresAt && reader.expiresAt.getTime() < Date.now()) {
      await LoginAttempt.create({ ipHash, readerId: reader.readerId, ok: false });
      return json(403, { error: '이용 기간이 끝난 계정입니다.' });
    }

    const ttl = ttlSecFor(reader.role);
    const session: ReaderSession = {
      readerId: reader.readerId,
      role: reader.role,
      unlimited: reader.unlimited,
      dailyCap: reader.dailyCap ?? null,
      expiresAt: reader.expiresAt ? reader.expiresAt.getTime() : null,
      exp: Date.now() + ttl * 1000,
      /** 로그인 자체가 비밀번호 확인이므로 이때를 step-up 시각으로 삼는다 */
      stepUpAt: Date.now(),
    };

    await Promise.all([
      LoginAttempt.create({ ipHash, readerId: reader.readerId, ok: true }),
      Reader.updateOne(
        { readerId: reader.readerId },
        { $inc: { loginCount: 1 }, $set: { lastLoginAt: new Date() } },
      ),
    ]);

    return json(
      200,
      {
        readerId: reader.readerId,
        role: reader.role,
        expiresAt: session.expiresAt,
        unlimited: reader.unlimited,
      },
      { 'Set-Cookie': cookieHeader(serializeSession(session), ttl) },
    );
  } catch (err) {
    console.error('[READER-LOGIN]', err instanceof Error ? err.message : err);
    return json(500, { error: '로그인 처리 중 문제가 생겼습니다.' });
  }
}
