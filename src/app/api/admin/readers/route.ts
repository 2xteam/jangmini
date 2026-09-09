import bcrypt from 'bcryptjs';
import { connectDb } from '@/lib/db';
import { Reader } from '@/models/Reader';
import { requireAdmin } from '@/lib/admin-auth';

/** 계정 목록. **passwordHash 는 절대 내보내지 않는다** */
export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  await connectDb();
  const rows = await Reader.find({})
    .select('readerId label memo role expiresAt enabled unlimited dailyCap lastLoginAt loginCount createdAt')
    .sort({ createdAt: 1 })
    .lean();
  return Response.json({ readers: rows }, { headers: { 'Cache-Control': 'no-store' } });
}

/** 계정 발급 */
export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const { readerId, password, label, expiresAt, dailyCap } = (body ?? {}) as Record<string, unknown>;

  if (typeof readerId !== 'string' || !/^[A-Za-z0-9._-]{3,32}$/.test(readerId)) {
    return Response.json({ error: '아이디는 영문·숫자·._- 3~32자입니다.' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8) {
    /**
     * 새로 발급하는 계정은 **8자 이상**을 요구한다. 초기 계정(2xteam)이
     * 4자리인 것은 사용자 지시였지만, 그 값을 새 계정에 물려주지 않는다.
     */
    return Response.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
  }

  await connectDb();
  if (await Reader.exists({ readerId })) {
    return Response.json({ error: '이미 있는 아이디입니다.' }, { status: 409 });
  }

  await Reader.create({
    readerId,
    passwordHash: await bcrypt.hash(password, 12),
    label: typeof label === 'string' ? label : undefined,
    role: 'reader',
    expiresAt: typeof expiresAt === 'string' && expiresAt ? new Date(expiresAt) : null,
    enabled: true,
    unlimited: true,
    dailyCap: typeof dailyCap === 'number' ? dailyCap : 500,
    loginCount: 0,
  });
  return Response.json({ ok: true, readerId });
}

/** 계정 변경 — 활성/만료/한도/비밀번호 */
export async function PATCH(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const { readerId, enabled, expiresAt, dailyCap, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof readerId !== 'string' || !readerId) {
    return Response.json({ error: 'readerId 가 필요합니다.' }, { status: 400 });
  }

  const set: Record<string, unknown> = {};
  if (typeof enabled === 'boolean') set.enabled = enabled;
  if (expiresAt === null) set.expiresAt = null;
  else if (typeof expiresAt === 'string' && expiresAt) set.expiresAt = new Date(expiresAt);
  if (dailyCap === null) set.dailyCap = null;
  else if (typeof dailyCap === 'number' && dailyCap >= 0) set.dailyCap = dailyCap;
  if (typeof password === 'string' && password) {
    if (password.length < 8) {
      return Response.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }
    set.passwordHash = await bcrypt.hash(password, 12);
  }
  if (!Object.keys(set).length) {
    return Response.json({ error: '바꿀 것이 없습니다.' }, { status: 400 });
  }

  await connectDb();
  const r = await Reader.updateOne({ readerId }, { $set: set });
  if (!r.matchedCount) return Response.json({ error: '없는 계정입니다.' }, { status: 404 });
  return Response.json({ ok: true, changed: Object.keys(set) });
}
