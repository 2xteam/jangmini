import crypto from 'node:crypto';
import { connectDb } from '@/lib/db';
import { ReaderHistory } from '@/models/ReaderHistory';
import { Usage, usageDateKey } from '@/models/Usage';
import { getLimits, type Limits } from '@/lib/limits';

/**
 * 비용 방어. 층별 역할은 my-obsidian-vault / 50-Plans/D jangmini 구축.md 참고.
 *
 *   L2  익명 제한 — clientId 와 ipHash 중 **엄격한 쪽**
 *   L3  전역 일일 캡 — usage 문서 한 건으로 판정
 *   L5  Origin 검증
 *
 * L2 는 완벽할 수 없다. 시크릿 창이면 clientId 가 초기화되고 IP 도 바뀔 수
 * 있다. **실제 방어선은 L3 과 OpenAI 프로젝트 하드 리밋이다.** L2 는
 * "실수로 많이 쓰는 것" 과 가벼운 반복을 막는 용도다.
 */

/** 원문 IP 를 저장하지 않는다 */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? '';
  return crypto.createHash('sha256').update(`${ip}|${salt}`).digest('hex').slice(0, 32);
}

/**
 * 클라이언트 IP.
 *
 * Vercel 은 `x-forwarded-for` 에 프록시 체인을 넣는다. **맨 앞이 클라이언트**고
 * 뒤쪽은 프록시다. 맨 뒤를 쓰면 모든 방문자가 같은 IP 로 보여 제한이 전역
 * 제한이 되어 버린다.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') ?? '0.0.0.0';
}

/** 우리 호스트인가 */
function isOurHost(host: string): boolean {
  return (
    host === 'jangmini.myjane.co.kr' ||
    host.endsWith('.vercel.app') ||
    host.startsWith('localhost:') ||
    host === 'localhost'
  );
}

/**
 * 다른 사이트가 사용자의 쿠키를 업고 이 API 를 부르는 것을 막는다(CSRF).
 *
 * ⚠️ **같은 출처의 GET 에는 브라우저가 `Origin` 을 붙이지 않는다.**
 * 규격이 그렇다 — `Origin` 은 교차 출처 요청과, 같은 출처라도 GET/HEAD 가
 * 아닌 요청에만 붙는다.
 *
 * 예전에는 `Origin` 이 없으면 개발에서만 통과시켰다. 그래서 **운영의 admin
 * 화면이 통째로 403** 이었다 — 네 탭이 모두 GET 으로 읽는데 그 GET 에는
 * `Origin` 이 없으니, 로그인도 권한도 멀쩡한데 "허용되지 않은 요청입니다"
 * 만 떴다. 로컬에서는 개발 예외로 통과해서 증상이 안 보였다(2026-09-11).
 *
 * 그래서 `Sec-Fetch-Site` 를 본다. 요즘 브라우저가 모든 요청에 붙인다.
 *
 *   same-origin  우리 화면이 우리 API 를 부른 것 — 통과
 *   none         주소창·북마크 — 교차 출처가 아니므로 CSRF 가 아니다. 통과
 *   same-site    `*.myjane.co.kr` 의 다른 앱 — **막는다.** 쿠키는 호스트
 *                전용이지만 대상 호스트 기준으로 실려 나가므로 위험하다
 *   cross-site   막는다
 *
 * 헤더가 아예 없는 옛 클라이언트는 `Referer` 로 한 번 더 본다.
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      return isOurHost(new URL(origin).host);
    } catch {
      return false;
    }
  }

  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return isOurHost(new URL(referer).host);
    } catch {
      return false;
    }
  }

  /** 아무 단서도 없다 — 개발에서 curl 로 확인할 수 있게 열어 둔다 */
  return process.env.NODE_ENV !== 'production';
}

export type GuardResult =
  | { ok: true; limits: Limits }
  | { ok: false; status: number; message: string; browseHint?: boolean };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 요청 하나를 통과시킬지 판단한다.
 *
 * `reader` 가 있으면 분·시·일 제한을 면제하되 **`dailyCap` 은 적용한다** —
 * 계정이 뚫려도 무한 과금은 막는다 (2026-09-08 사용자 결정).
 */
export async function checkGuards(opts: {
  clientId: string;
  ipHash: string;
  reader: { readerId: string; unlimited: boolean; dailyCap: number | null } | null;
}): Promise<GuardResult> {
  const limits = await getLimits();
  await connectDb();

  const now = Date.now();

  /* ── L3 전역 일일 캡 ─────────────────────────────────────
   * 먼저 본다. 전역이 막혔으면 개인 카운트를 셀 이유가 없다.
   */
  const today = usageDateKey();
  const usage = await Usage.findById(today).lean<{ requests: number; tokensIn: number; tokensOut: number }>();
  if (usage) {
    const tokens = (usage.tokensIn ?? 0) + (usage.tokensOut ?? 0);
    if (usage.requests >= limits.globalDailyRequests || tokens >= limits.globalDailyTokens) {
      return {
        ok: false,
        status: 429,
        message: '오늘 AI 답변 한도가 찼습니다. 내용은 문서에서 바로 보실 수 있어요.',
        browseHint: true,
      };
    }
  }

  /* ── reader ─────────────────────────────────────────────── */
  if (opts.reader) {
    if (opts.reader.dailyCap != null) {
      const since = new Date(now - DAY);
      const used = await ReaderHistory.countDocuments({
        readerId: opts.reader.readerId,
        createdAt: { $gte: since },
      });
      if (used >= opts.reader.dailyCap) {
        return {
          ok: false,
          status: 429,
          message: '이 계정의 하루 질문 한도에 도달했습니다.',
          browseHint: true,
        };
      }
    }
    return { ok: true, limits };
  }

  /* ── L2 익명 제한 ────────────────────────────────────────
   * clientId 와 ipHash 를 각각 세고 **더 많이 쓴 쪽**을 기준으로 삼는다.
   * 스토리지를 지워도 IP 가 남아 조금 더 버틴다.
   */
  const windows: { ms: number; limit: number; label: string }[] = [
    { ms: MINUTE, limit: limits.anonPerMinute, label: '잠시 후' },
    { ms: HOUR, limit: limits.anonPerHour, label: '한 시간 뒤' },
    { ms: DAY, limit: limits.anonPerDay, label: '내일' },
  ];

  for (const w of windows) {
    const since = new Date(now - w.ms);
    const [byClient, byIp] = await Promise.all([
      ReaderHistory.countDocuments({ clientId: opts.clientId, createdAt: { $gte: since } }),
      ReaderHistory.countDocuments({ ipHash: opts.ipHash, createdAt: { $gte: since } }),
    ]);
    if (Math.max(byClient, byIp) >= w.limit) {
      return {
        ok: false,
        status: 429,
        message: `질문이 너무 많습니다. ${w.label} 다시 시도해 주세요. 내용은 문서에서 바로 보실 수 있어요.`,
        browseHint: true,
      };
    }
  }

  return { ok: true, limits };
}

/** 일별 집계에 더한다. 실패해도 요청을 막지 않는다 */
export async function bumpUsage(delta: Partial<Omit<UsageInc, '_id'>>) {
  try {
    await connectDb();
    await Usage.updateOne(
      { _id: usageDateKey() },
      { $inc: delta as Record<string, number>, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    console.error('[GUARD] usage 집계 실패:', err instanceof Error ? err.message : err);
  }
}

type UsageInc = {
  _id: string;
  requests: number;
  cacheHits: number;
  openaiCalls: number;
  tokensIn: number;
  tokensOut: number;
  blocked: number;
};
