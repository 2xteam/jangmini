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

/**
 * L5 — 우리 사이트에서 온 요청인지 본다.
 *
 * 헤더는 위조할 수 있으므로 **봇 차단 이상을 기대하지 않는다.** 다만
 * 스크립트로 엔드포인트를 직접 두드리는 경우는 대부분 여기서 걸린다.
 * 같은 출처의 fetch 에는 브라우저가 origin 을 붙인다.
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  /** 서버 사이드 호출이나 curl 은 origin 이 없다 — 개발 편의상 통과시킨다 */
  if (!origin) return process.env.NODE_ENV !== 'production';
  try {
    const host = new URL(origin).host;
    return (
      host === 'jangmini.myjane.co.kr' ||
      host.endsWith('.vercel.app') ||
      host.startsWith('localhost:') ||
      host === 'localhost'
    );
  } catch {
    return false;
  }
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
