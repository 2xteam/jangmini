import { connectDb } from '@/lib/db';
import { Answer } from '@/models/Answer';
import { Suggestion } from '@/models/Suggestion';
import { requireAdmin } from '@/lib/admin-auth';
import { getLimits } from '@/lib/limits';

/** 추천 질문과 캐시된 답변을 함께 준다 — 검수 화면이 쓴다 */
export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  await connectDb();
  const limits = await getLimits();

  const [suggestions, answers] = await Promise.all([
    Suggestion.find({}).sort({ order: 1 }).lean(),
    Answer.find({ sourceVersion: limits.sourceVersion }).lean(),
  ]);
  const byKey = new Map(answers.map((a) => [`${a.key}:${a.lang}`, a]));

  return Response.json(
    {
      sourceVersion: limits.sourceVersion,
      items: suggestions.map((s) => {
        const a = byKey.get(`${s.key}:ko`);
        return {
          key: s.key,
          category: s.category,
          question: s.question,
          enabled: s.enabled,
          hits: s.hits,
          answer: a?.answer ?? null,
          reviewed: a?.reviewed ?? false,
          answerHits: a?.hits ?? 0,
        };
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * 답변을 손으로 고치거나 검수 표시를 켠다.
 *
 * `reviewed: true` 인 답변은 `pnpm warm` 이 건너뛴다 — 사람이 다듬은 문장을
 * 재생성이 덮으면 안 된다.
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
  const { key, answer, reviewed, enabled } = (body ?? {}) as Record<string, unknown>;
  if (typeof key !== 'string' || !key) {
    return Response.json({ error: 'key 가 필요합니다.' }, { status: 400 });
  }

  await connectDb();
  const limits = await getLimits();

  if (typeof enabled === 'boolean') {
    await Suggestion.updateOne({ key }, { $set: { enabled } });
  }

  const set: Record<string, unknown> = {};
  if (typeof answer === 'string') {
    if (!answer.trim() || answer.length > 4000) {
      return Response.json({ error: '답변은 1~4000자여야 합니다.' }, { status: 400 });
    }
    set.answer = answer.trim();
  }
  if (typeof reviewed === 'boolean') set.reviewed = reviewed;

  if (Object.keys(set).length) {
    const r = await Answer.updateOne(
      { key, lang: 'ko', sourceVersion: limits.sourceVersion },
      { $set: { ...set, model: 'manual', updatedAt: new Date() } },
    );
    if (!r.matchedCount) {
      return Response.json(
        { error: '이 버전의 캐시된 답변이 없습니다. pnpm warm 을 먼저 돌려 주세요.' },
        { status: 404 },
      );
    }
  }
  return Response.json({ ok: true });
}
