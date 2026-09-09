import { connectDb } from '@/lib/db';
import { Usage, usageDateKey } from '@/models/Usage';
import { ReaderHistory } from '@/models/ReaderHistory';
import { Answer } from '@/models/Answer';
import { requireAdmin } from '@/lib/admin-auth';
import { getLimits } from '@/lib/limits';

/**
 * 사용량 요약. 오늘 캡에 얼마나 가까운지와 최근 질문을 함께 준다.
 *
 * 질문 이력에서 **clientId 와 ipHash 는 내보내지 않는다** — 관리 화면에서
 * 개별 방문자를 추적할 이유가 없고, 화면에 뜨면 그게 곧 로그로 남는다.
 */
export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  await connectDb();
  const limits = await getLimits();
  const today = usageDateKey();

  const [days, recent, answerCount, cacheHitTotal] = await Promise.all([
    Usage.find({}).sort({ _id: -1 }).limit(14).lean(),
    ReaderHistory.find({})
      .select('readerId suggestionKey question lang source model tokensIn tokensOut createdAt')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    Answer.countDocuments({ sourceVersion: limits.sourceVersion }),
    Usage.aggregate<{ _id: null; cacheHits: number; requests: number }>([
      { $group: { _id: null, cacheHits: { $sum: '$cacheHits' }, requests: { $sum: '$requests' } } },
    ]),
  ]);

  const t = days.find((d) => d._id === today);
  return Response.json(
    {
      today: {
        date: today,
        requests: t?.requests ?? 0,
        cacheHits: t?.cacheHits ?? 0,
        openaiCalls: t?.openaiCalls ?? 0,
        tokens: (t?.tokensIn ?? 0) + (t?.tokensOut ?? 0),
        blocked: t?.blocked ?? 0,
        limitRequests: limits.globalDailyRequests,
        limitTokens: limits.globalDailyTokens,
      },
      days,
      recent,
      cache: {
        answers: answerCount,
        sourceVersion: limits.sourceVersion,
        hitRate:
          cacheHitTotal[0]?.requests
            ? Math.round((cacheHitTotal[0].cacheHits / cacheHitTotal[0].requests) * 100)
            : null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
