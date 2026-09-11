import { connectDb } from '@/lib/db';
import { Portfolio, PORTFOLIO_KINDS, type PortfolioKind } from '@/models/Portfolio';
import { requireAdmin } from '@/lib/admin-auth';
import { FIELDS, FIELD_KEYS, readPath, applyOverrides, type WithOverrides } from '@/lib/overrides';

/**
 * 이력 문서를 손으로 고친다.
 *
 * ⚠️ **원본 필드를 쓰지 않는다.** 고친 값은 `overrides` 에만 쌓는다 —
 * 문서를 직접 고치면 다음 `ingest --write` 에 지워진다. → lib/overrides.ts
 *
 * GET  ?kind=&q=            목록 (본문 제외)
 * GET  ?slug=               한 건 (원본 값 + override 값을 **둘 다** 준다)
 * PATCH { slug, key, value } override 하나 저장. value 가 null 이면 되돌린다
 */

const LIST_FIELDS = 'slug kind title summary company period.label order visibility featured overrides';

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  await connectDb();

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');

  /* ── 한 건 — 편집 화면이 쓴다 ─────────────────────────── */
  if (slug) {
    const doc = await Portfolio.findOne({ slug }).lean<WithOverrides>();
    if (!doc) return bad('없는 문서입니다.', 404);

    /*
      원본과 고친 값을 **나란히** 준다. 화면이 "원래 이랬다" 를 보여줄 수
      있어야 되돌릴지 판단할 수 있다. 값만 주면 무엇을 바꿨는지 알 수 없다.
    */
    const overrides = doc.overrides ?? {};
    const fields = FIELDS.filter((f) => !f.kinds || f.kinds.includes(doc.kind)).map((f) => ({
      ...f,
      original: readPath(doc, f.key) ?? null,
      override: f.key in overrides ? overrides[f.key] : null,
      edited: f.key in overrides,
    }));

    return Response.json(
      { doc: { slug: doc.slug, kind: doc.kind, source: doc.source, updatedAt: doc.updatedAt }, fields },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  /* ── 목록 ──────────────────────────────────────────── */
  const kind = url.searchParams.get('kind');
  const q = (url.searchParams.get('q') ?? '').trim();
  const filter: Record<string, unknown> = {};
  if (kind && (PORTFOLIO_KINDS as readonly string[]).includes(kind)) filter.kind = kind;
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [{ title: rx }, { slug: rx }, { company: rx }];
  }

  const docs = await Portfolio.find(filter)
    .select(LIST_FIELDS)
    .sort({ kind: 1, order: 1 })
    .limit(300)
    .lean<WithOverrides[]>();

  /** 목록에도 override 를 얹는다 — 고친 제목이 목록에 안 보이면 헷갈린다 */
  const rows = docs.map((d) => {
    const m = applyOverrides(d);
    return {
      slug: m.slug,
      kind: m.kind,
      title: m.title,
      summary: m.summary ?? null,
      company: m.company ?? null,
      period: m.period?.label ?? null,
      visibility: m.visibility,
      featured: Boolean(m.featured),
      editedCount: Object.keys(d.overrides ?? {}).length,
    };
  });

  const counts = await Portfolio.aggregate<{ _id: PortfolioKind; n: number }>([
    { $group: { _id: '$kind', n: { $sum: 1 } } },
  ]);

  return Response.json(
    { rows, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad('요청 형식이 올바르지 않습니다.');
  }
  const { slug, key, value } = (body ?? {}) as { slug?: unknown; key?: unknown; value?: unknown };

  if (typeof slug !== 'string' || !slug) return bad('slug 가 필요합니다.');
  if (typeof key !== 'string' || !FIELD_KEYS.has(key)) return bad('고칠 수 없는 항목입니다.');

  await connectDb();
  const doc = await Portfolio.findOne({ slug });
  if (!doc) return bad('없는 문서입니다.', 404);

  const spec = FIELDS.find((f) => f.key === key)!;
  if (spec.kinds && !spec.kinds.includes(doc.kind)) {
    return bad(`${doc.kind} 에는 없는 항목입니다.`);
  }

  /* ── 되돌리기 ─────────────────────────────────────── */
  if (value === null) {
    await Portfolio.updateOne({ slug }, { $unset: { [`overrides.${key}`]: '' } });
    return Response.json({ ok: true, key, reverted: true });
  }

  /*
    타입을 **넣을 때 맞춘다.** 설정 라우트에서 배운 것과 같다 — 숫자 칸에
    문자열이 들어가면 이후 비교가 조용히 어긋난다.
  */
  let clean: unknown = value;
  switch (spec.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) return bad('숫자를 넣어 주세요.');
      if ((key === 'contribution' || key === 'level') && (n < 0 || n > 1)) {
        return bad('0 과 1 사이 값이어야 합니다.');
      }
      clean = n;
      break;
    }
    case 'bool':
      clean = Boolean(value);
      break;
    case 'list':
      if (!Array.isArray(value)) return bad('목록이어야 합니다.');
      clean = value.map((v) => String(v).trim()).filter(Boolean);
      break;
    case 'select':
      if (!spec.options?.includes(String(value))) return bad('허용되지 않은 값입니다.');
      clean = String(value);
      break;
    default: {
      const t = String(value);
      /** 제목이 비면 목록에서 사라진 것처럼 보인다 */
      if (key === 'title' && !t.trim()) return bad('제목은 비울 수 없습니다.');
      clean = t;
    }
  }

  await Portfolio.updateOne({ slug }, { $set: { [`overrides.${key}`]: clean } });
  return Response.json({ ok: true, key, value: clean });
}
