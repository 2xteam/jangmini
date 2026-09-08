import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { SYSTEM_PROMPT } from './prompt';
import { getContact } from './tools/getContact';
import { getCrazy } from './tools/getCrazy';
import { getInternship } from './tools/getIntership';
import { getPresentation } from './tools/getPresentation';
import { getProjects } from './tools/getProjects';
import { getResume } from './tools/getResume';
import { getSkills } from './tools/getSkills';
import { getSports } from './tools/getSport';

export const maxDuration = 30;

/**
 * ⚠️ 임시 차단장치다 (2026-09-08).
 *
 * 사이트가 이미 공개 배포됐는데 원본 라우트는 인증도 제한도 없었다. 게다가
 * `messages` 배열을 클라이언트가 통째로 보내므로, 방문자가 자기 지시를 넣어
 * **범용 GPT 프록시**로 쓸 수 있었다 — 500자 제한 같은 것으로는 못 막는다.
 * 배열 길이와 총 글자 수를 서버에서 직접 재야 한다.
 *
 * 여기 있는 것은 급한 구멍만 막은 것이고, 제대로 된 방어는 Phase 5 에서 한다
 * (추천질문 캐시 · readers_history 기반 제한 · 전역 일일 캡 · 인젝션 가드).
 * → my-obsidian-vault / 50-Plans/D jangmini 구축.md
 */

/** 기본값이 "꺼짐"이다. 켜려면 Vercel 환경 변수에 CHAT_ENABLED=true 를 넣는다 */
const CHAT_ENABLED = process.env.CHAT_ENABLED === 'true';

/** 한 요청의 메시지 개수 상한 (최근 10턴 ≈ 21개) */
const MAX_MESSAGES = 21;
/** 사용자가 한 번에 물어볼 수 있는 글자 수 */
const MAX_USER_CHARS = 500;
/**
 * assistant 메시지 한 개의 글자 수 상한.
 * 상한을 역할별로 나누는 이유 — 하나로 합쳐 6000자로 뒀더니 "20턴 각 400자"
 * 같은 **정상 대화가 막혔다.** 답변은 원래 길다(출력 800토큰 ≈ 한국어 2000자+).
 * 그렇다고 검사를 빼면 방문자가 assistant 메시지에 거대한 문자열을 넣어
 * 입력 토큰을 부풀릴 수 있으므로, 넉넉하지만 유한한 값을 둔다.
 * MAX_OUTPUT_TOKENS 로 만든 답이 이 값을 넘을 수는 없다.
 */
const MAX_ASSISTANT_CHARS = 4000;
/** 한 요청 전체의 글자 수 상한. 20000자 ≈ 6k 토큰으로 단가에 천장을 둔다 */
const MAX_TOTAL_CHARS = 20000;
/** 응답 토큰 상한. 없으면 한 요청의 단가에 천장이 없다 */
const MAX_OUTPUT_TOKENS = 800;

/**
 * 사용자에게는 언제나 같은 문구를 준다.
 * 원본은 error.message 를 그대로 돌려줬고, 실제로 배포된 사이트에서
 * `t.unshift is not a function` 이라는 내부 메시지가 노출되는 것을 확인했다.
 */
const GENERIC_ERROR = '답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 상세는 서버 로그로만 남긴다 */
function logError(where: string, error: unknown) {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  console.error(`[CHAT-API] ${where}:`, detail);
}

function reject(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type IncomingMessage = { role?: unknown; content?: unknown };

export async function POST(req: Request) {
  if (!CHAT_ENABLED) {
    /**
     * 개인화가 끝나기 전에는 채팅을 열지 않는다. 지금 열면 원작자의 페르소나로
     * 답하는 데다, 제한이 없어 방문자가 OpenAI 사용량을 무제한으로 태울 수 있다.
     */
    return reject(503, '준비 중입니다. 곧 열립니다.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    logError('본문 파싱', err);
    return reject(400, '요청 형식이 올바르지 않습니다.');
  }

  const messages = (body as { messages?: unknown } | null)?.messages;

  if (!Array.isArray(messages)) {
    return reject(400, '요청 형식이 올바르지 않습니다.');
  }
  if (messages.length === 0 || messages.length > MAX_MESSAGES) {
    return reject(400, '대화가 너무 깁니다. 새로 시작해 주세요.');
  }

  let totalChars = 0;
  for (const raw of messages as IncomingMessage[]) {
    if (!raw || typeof raw !== 'object') {
      return reject(400, '요청 형식이 올바르지 않습니다.');
    }
    /**
     * 클라이언트가 보낸 system 역할을 받지 않는다. 받으면 방문자가 페르소나를
     * 갈아치우고 이 키를 범용 GPT 로 쓸 수 있다. system 은 서버만 넣는다.
     */
    if (raw.role !== 'user' && raw.role !== 'assistant') {
      return reject(400, '요청 형식이 올바르지 않습니다.');
    }
    const content = typeof raw.content === 'string' ? raw.content : '';
    if (raw.role === 'user' && content.length > MAX_USER_CHARS) {
      return reject(400, `한 번에 ${MAX_USER_CHARS}자까지 물어볼 수 있습니다.`);
    }
    if (raw.role === 'assistant' && content.length > MAX_ASSISTANT_CHARS) {
      return reject(400, '대화가 너무 깁니다. 새로 시작해 주세요.');
    }
    totalChars += content.length;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return reject(400, '대화가 너무 깁니다. 새로 시작해 주세요.');
  }

  try {
    const tools = {
      getProjects,
      getPresentation,
      getResume,
      getContact,
      getSkills,
      getSports,
      getCrazy,
      getInternship,
    };

    const result = streamText({
      model: openai('gpt-4o-mini'),
      messages: [SYSTEM_PROMPT, ...messages],
      toolCallStreaming: true,
      tools,
      maxSteps: 2,
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    return result.toDataStreamResponse({
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
