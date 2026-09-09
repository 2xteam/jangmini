import bcrypt from 'bcryptjs';
import { connectDb } from '@/lib/db';
import { Reader } from '@/models/Reader';
import { LoginAttempt } from '@/models/LoginAttempt';
import {
  sessionFromRequest,
  serializeSession,
  cookieHeader,
  ttlSecFor,
} from '@/lib/reader-session';
import { clientIp, hashIp, isAllowedOrigin } from '@/lib/guard';

/**
 * `/admin` 진입용 비밀번호 재확인 (step-up).
 *
 * ## 왜 필요한가
 *
 * admin 을 별도 컬렉션이 아니라 `readers.role` 로 구분한다(2026-09-08 사용자
 * 결정). 그래서 **reader 비밀번호가 곧 admin 권한**이고, 초기 비밀번호는
 * 4자리다. 로그인 쿠키만으로 admin 화면을 열어 주면, 쿠키가 남은 기기를
 * 누가 쓰기만 해도 관리 화면이 열린다.
 *
 * 그래서 `/admin` 은 **10분 안에 비밀번호를 확인한 세션**만 들어갈 수 있다
 * → src/lib/reader-session.ts 의 STEP_UP_WINDOW_MS
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json(403, { error: '허용되지 않은 요청입니다.' });

  const session = sessionFromRequest(req);
  if (!session || session.role !== 'admin') {
    return json(403, { error: '권한이 없습니다.' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' });
  }
  const { password } = (body ?? {}) as { password?: unknown };
  if (typeof password !== 'string' || !password || password.length > 200) {
    return json(400, { error: '비밀번호를 입력해 주세요.' });
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

    const reader = await Reader.findOne({ readerId: session.readerId }).lean<{
      passwordHash: string;
      enabled: boolean;
    }>();
    const ok =
      reader?.enabled === true && (await bcrypt.compare(password, reader.passwordHash));
    if (!ok) {
      await LoginAttempt.create({ ipHash, readerId: session.readerId, ok: false });
      return json(401, { error: '비밀번호가 맞지 않습니다.' });
    }

    const ttl = ttlSecFor('admin');
    const next = { ...session, stepUpAt: Date.now(), exp: Date.now() + ttl * 1000 };
    return json(200, { ok: true }, { 'Set-Cookie': cookieHeader(serializeSession(next), ttl) });
  } catch (err) {
    console.error('[STEPUP]', err instanceof Error ? err.message : err);
    return json(500, { error: '처리 중 문제가 생겼습니다.' });
  }
}
