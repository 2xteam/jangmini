import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { buildSystemPrompt } from './prompt';
import { getContact } from './tools/getContact';
import { getExperience } from './tools/getExperience';
import { getPresentation } from './tools/getPresentation';
import { getProjects } from './tools/getProjects';
import { getResume } from './tools/getResume';
import { getSkills } from './tools/getSkills';
import { connectDb } from '@/lib/db';
import { Answer } from '@/models/Answer';
import { Suggestion } from '@/models/Suggestion';
import { ReaderHistory } from '@/models/ReaderHistory';
import { checkGuards, bumpUsage, clientIp, hashIp, isAllowedOrigin } from '@/lib/guard';
import { sessionFromRequest } from '@/lib/reader-session';
import { findSuggestion } from '@/lib/suggestions';

export const maxDuration = 30;

/**
 * 챗 API. 방어 순서가 중요하다 —
 *
 *   ① 킬스위치            환경 변수. DB 와 무관하게 닫힌다
 *   ② Origin 검증 (L5)    스크립트 직격을 걸러낸다
 *   ③ 입력 검증 (L1)      system 역할 거부 · 글자 수 · 개수
 *   ④ **캐시 조회 (L0)**  맞으면 여기서 끝. 제한도 세지 않는다
 *   ⑤ 제한 검사 (L2·L3)   OpenAI 를 부르기 **전에** 본다
 *   ⑥ OpenAI
 *   ⑦ 이력·집계 기록
 *
 * ④가 ⑤보다 먼저인 이유 — 캐시 히트는 OpenAI 를 부르지 않으므로 비용이 0이다.
 * 여기에 제한을 걸면 **돈이 들지 않는 요청을 막는 셈**이고, 방문자는 문서를
 * 보러 갈 이유가 없는데도 막힌다.
 */

/**
 * 기본값이 "꺼짐"이다. 켜려면 Vercel 환경 변수에 CHAT_ENABLED=true 를 넣는다.
 *
 * **DB 설정(`settings`)으로 두지 않는다** — DB 를 못 읽는 상황에서도 채팅이
 * 열리지 않아야 하고, DB 가 뚫렸을 때 설정 한 줄로 과금 경로가 열리면 안 된다.
 */
const CHAT_ENABLED = process.env.CHAT_ENABLED === 'true';

/**
 * assistant 메시지 한 개의 글자 수 상한.
 * 역할별로 나누는 이유 — 하나로 합쳐 6000자로 뒀더니 "20턴 각 400자" 같은
 * **정상 대화가 막혔다.** 답변은 원래 길다. 그렇다고 검사를 빼면 방문자가
 * assistant 메시지에 거대한 문자열을 넣어 입력 토큰을 부풀릴 수 있다.
 */
const MAX_ASSISTANT_CHARS = 4000;
/** 한 요청 전체의 글자 수 상한. 단가에 천장을 둔다 */
const MAX_TOTAL_CHARS = 20000;

/**
 * 사용자에게는 언제나 같은 문구를 준다. 원본은 error.message 를 그대로
 * 돌려줬고, 배포된 사이트에서 `t.unshift is not a function` 이 노출됐다.
 */
const GENERIC_ERROR = '답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';

function logError(where: string, error: unknown) {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  console.error(`[CHAT-API] ${where}:`, detail);
}

function reject(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type IncomingMessage = { role?: unknown; content?: unknown };

/** 한국어 글자가 있으면 ko. 없으면 en */
function detectLang(text: string): 'ko' | 'en' {
  return /[가-힣]/.test(text) ? 'ko' : 'en';
}

/**
 * 캐시된 답변을 AI SDK 의 데이터 스트림 형식으로 흘려보낸다.
 *
 * 통째로 주지 않고 조각내는 이유 — 클라이언트가 `useChat` 이라 스트림을
 * 기대한다. 그리고 즉시 완성된 글이 나오면 캐시임이 티가 나서, 같은 질문의
 * 답변만 유독 다르게 느껴진다.
 */
function streamCached(text: string): Response {
  const encoder = new TextEncoder();
  const CHUNK = 24;
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < text.length; i += CHUNK) {
        const piece = text.slice(i, i + CHUNK);
        controller.enqueue(encoder.encode(`0:${JSON.stringify(piece)}\n`));
        await new Promise((r) => setTimeout(r, 18));
      }
      controller.enqueue(
        encoder.encode(
          `d:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } })}\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'x-vercel-ai-data-stream': 'v1',
      /** 어디서 왔는지 알 수 있게 — 검증할 때 이 헤더를 본다 */
      'x-jangmini-source': 'cache',
    },
  });
}

export async function POST(req: Request) {
  /* ── ① 킬스위치 ─────────────────────────────────────────── */
  if (!CHAT_ENABLED) {
    return reject(503, '준비 중입니다. 곧 열립니다.');
  }

  /* ── ② L5 Origin ────────────────────────────────────────── */
  if (!isAllowedOrigin(req)) {
    return reject(403, '허용되지 않은 요청입니다.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    logError('본문 파싱', err);
    return reject(400, '요청 형식이 올바르지 않습니다.');
  }

  const { messages, suggestionKey, clientId } = (body ?? {}) as {
    messages?: unknown;
    suggestionKey?: unknown;
    clientId?: unknown;
  };

  /* ── ③ L1 입력 검증 ─────────────────────────────────────── */
  if (!Array.isArray(messages)) return reject(400, '요청 형식이 올바르지 않습니다.');

  const session = sessionFromRequest(req);
  const limits = await (await import('@/lib/limits')).getLimits();

  if (messages.length === 0 || messages.length > limits.maxMessages) {
    return reject(400, '대화가 너무 깁니다. 새로 시작해 주세요.');
  }

  let totalChars = 0;
  for (const raw of messages as IncomingMessage[]) {
    if (!raw || typeof raw !== 'object') return reject(400, '요청 형식이 올바르지 않습니다.');
    /**
     * 클라이언트가 보낸 system 역할을 받지 않는다. 받으면 방문자가 페르소나를
     * 갈아치우고 이 키를 범용 GPT 로 쓸 수 있다. system 은 서버만 넣는다.
     */
    if (raw.role !== 'user' && raw.role !== 'assistant') {
      return reject(400, '요청 형식이 올바르지 않습니다.');
    }
    const content = typeof raw.content === 'string' ? raw.content : '';
    if (raw.role === 'user' && content.length > limits.maxUserChars) {
      return reject(400, `한 번에 ${limits.maxUserChars}자까지 물어볼 수 있습니다.`);
    }
    if (raw.role === 'assistant' && content.length > MAX_ASSISTANT_CHARS) {
      return reject(400, '대화가 너무 깁니다. 새로 시작해 주세요.');
    }
    totalChars += content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return reject(400, '대화가 너무 깁니다. 새로 시작해 주세요.');
  }

  const lastUser = [...(messages as IncomingMessage[])]
    .reverse()
    .find((m) => m.role === 'user');
  const question = typeof lastUser?.content === 'string' ? lastUser.content : '';
  const lang = detectLang(question);

  const cid = typeof clientId === 'string' && clientId.length <= 64 ? clientId : 'unknown';
  const ipHash = hashIp(clientIp(req));
  const ua = req.headers.get('user-agent')?.slice(0, 200) ?? null;

  /* ── ④ L0 캐시 ──────────────────────────────────────────
   * 추천 질문(고정 key)일 때만 본다. 자유 입력은 캐시하지 않는다 —
   * 텍스트를 해시하면 거의 안 맞고, 방문자가 조금씩 다른 문장으로 캐시
   * 컬렉션을 채울 수 있다.
   *
   * **첫 턴에서만** 캐시를 쓴다. 대화 도중이면 앞 문맥을 무시한 답이 되어
   * 엉뚱해진다.
   */
  const key =
    typeof suggestionKey === 'string' && findSuggestion(suggestionKey) ? suggestionKey : null;
  const isFirstTurn = (messages as IncomingMessage[]).filter((m) => m.role === 'user').length === 1;

  if (key && isFirstTurn) {
    try {
      await connectDb();
      const hit = await Answer.findOne({
        key,
        lang,
        sourceVersion: limits.sourceVersion,
      }).lean<{ answer: string }>();
      if (hit?.answer) {
        /** 기록은 기다리지 않는다 — 응답을 늦출 이유가 없다 */
        void Promise.all([
          Answer.updateOne({ key, lang, sourceVersion: limits.sourceVersion }, { $inc: { hits: 1 } }),
          Suggestion.updateOne({ key }, { $inc: { hits: 1 } }),
          ReaderHistory.create({
            readerId: session?.readerId ?? null,
            clientId: cid,
            ipHash,
            suggestionKey: key,
            question,
            answer: hit.answer,
            lang,
            source: 'cache',
            ua,
          }),
          bumpUsage({ requests: 1, cacheHits: 1 }),
        ]).catch((err) => logError('캐시 히트 기록', err));
        return streamCached(hit.answer);
      }
    } catch (err) {
      /** 캐시를 못 읽어도 OpenAI 로 계속 간다 */
      logError('캐시 조회', err);
    }
  }

  /* ── ⑤ L2·L3 제한 ───────────────────────────────────────── */
  const guard = await checkGuards({
    clientId: cid,
    ipHash,
    reader: session
      ? { readerId: session.readerId, unlimited: session.unlimited, dailyCap: session.dailyCap }
      : null,
  });
  if (!guard.ok) {
    void bumpUsage({ requests: 1, blocked: 1 });
    return reject(guard.status, guard.message, guard.browseHint ? { browse: true } : {});
  }

  /* ── ⑥ OpenAI ───────────────────────────────────────────── */
  try {
    /**
     * ⚠️ tool 을 더하거나 지울 때는 **세 군데를 함께** 고친다. 하나라도
     * 빠지면 런타임 에러다 —
     *   ① 이 객체
     *   ② src/components/chat/tool-renderer.tsx 의 case
     *   ③ 해당 컴포넌트 파일
     */
    const tools = {
      getPresentation,
      getExperience,
      getProjects,
      getSkills,
      getResume,
      getContact,
    };

    const result = streamText({
      model: openai(limits.model),
      messages: [buildSystemPrompt(), ...messages],
      toolCallStreaming: true,
      tools,
      maxSteps: limits.maxSteps,
      maxTokens: limits.maxOutputTokens,
      onFinish: ({ text, usage }) => {
        void Promise.all([
          ReaderHistory.create({
            readerId: session?.readerId ?? null,
            clientId: cid,
            ipHash,
            suggestionKey: key,
            question,
            answer: text ?? '',
            lang,
            source: 'openai',
            model: limits.model,
            tokensIn: usage?.promptTokens ?? 0,
            tokensOut: usage?.completionTokens ?? 0,
            ua,
          }),
          bumpUsage({
            requests: 1,
            openaiCalls: 1,
            tokensIn: usage?.promptTokens ?? 0,
            tokensOut: usage?.completionTokens ?? 0,
          }),
        ]).catch((err) => logError('완료 기록', err));
      },
    });

    return result.toDataStreamResponse({
      headers: { 'x-jangmini-source': 'openai' },
      getErrorMessage: (error) => {
        logError('스트리밍', error);
        return GENERIC_ERROR;
      },
    });
  } catch (err) {
    logError('요청 처리', err);
    return reject(500, GENERIC_ERROR);
  }
}
