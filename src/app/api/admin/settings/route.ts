import { connectDb } from '@/lib/db';
import { Setting } from '@/models/Setting';
import { requireAdmin } from '@/lib/admin-auth';
import { invalidateLimits } from '@/lib/limits';

/** 설정 목록 */
export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  await connectDb();
  const rows = await Setting.find({}).sort({ _id: 1 }).lean();
  return Response.json({ settings: rows }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * 설정 하나 변경.
 *
 * 값의 타입을 **기존 값에 맞춰 강제한다.** 숫자 칸에 문자열이 들어가면
 * 이후 비교가 조용히 이상해진다 (`"3" > 10` 은 false, `"30" < 5` 도 false).
 * lib/limits.ts 에서도 한 번 더 확인하지만 들어올 때 막는 것이 낫다.
 */
export async function PATCH(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const { key, value } = (body ?? {}) as { key?: unknown; value?: unknown };
  if (typeof key !== 'string' || !key) {
    return Response.json({ error: 'key 가 필요합니다.' }, { status: 400 });
  }

  await connectDb();
  const current = await Setting.findById(key).lean<{ value: unknown }>();
  if (!current) {
    /** 새 키를 임의로 만들지 않는다 — 오타로 쓰이지 않는 설정이 쌓인다 */
    return Response.json({ error: '없는 설정 키입니다.' }, { status: 404 });
  }

  let next: unknown = value;
  if (typeof current.value === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return Response.json({ error: '0 이상의 숫자여야 합니다.' }, { status: 400 });
    }
    next = n;
  } else if (typeof current.value === 'boolean') {
    next = Boolean(value);
  } else if (typeof current.value === 'string') {
    if (typeof value !== 'string' || !value) {
      return Response.json({ error: '문자열이어야 합니다.' }, { status: 400 });
    }
    next = value;
  }

  await Setting.updateOne(
    { _id: key },
    { $set: { value: next, updatedAt: new Date(), updatedBy: auth.session.readerId } },
  );
  /** 60초 캐시를 즉시 버린다 — 안 하면 관리자가 바꿔도 최대 1분 안 먹는다 */
  invalidateLimits();

  return Response.json({ ok: true, key, value: next });
}
