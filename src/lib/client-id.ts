/**
 * 익명 방문자 식별자.
 *
 * **약한 식별자다.** 시크릿 창이면 새로 생기고 방문자가 지울 수도 있다.
 * 그래서 서버는 이 값과 IP 해시를 **둘 다** 세서 엄격한 쪽을 적용하고,
 * 실제 방어선은 전역 일일 캡과 OpenAI 하드 리밋이다 → src/lib/guard.ts
 *
 * ⚠️ `localStorage` 접근은 **그 자체가 throw 할 수 있다** — 프라이빗 모드나
 * 사이트 데이터를 막은 브라우저다. 그래서 전부 try/catch 로 감싸고,
 * 실패하면 메모리에만 두고 계속 진행한다. 여기서 터지면 채팅이 아예 안 된다.
 */

const KEY = 'jangmini.clientId';

let memory: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* 아래 폴백 */
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getClientId(): string {
  if (memory) return memory;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) {
      memory = stored;
      return stored;
    }
  } catch {
    /* 읽기 실패 — 새로 만들어 메모리에만 둔다 */
  }
  const id = randomId();
  memory = id;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* 쓰기 실패 — 이 세션 동안만 유지된다 */
  }
  return id;
}

/* ── 안내 모달의 "다시 보지 않기" ─────────────────────────── */

const WELCOME_KEY = 'jangmini.welcome.dismissed';

export function isWelcomeDismissed(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    /**
     * 읽을 수 없으면 **띄우지 않는다.** 매 방문마다 모달이 뜨는 것보다,
     * 안 뜨는 편이 덜 성가시다. 우상단 버튼으로 언제든 열 수 있다.
     */
    return true;
  }
}

export function dismissWelcome() {
  try {
    window.localStorage.setItem(WELCOME_KEY, '1');
  } catch {
    /* 저장 못 해도 이 세션에는 다시 뜨지 않는다 (호출자가 상태를 들고 있다) */
  }
}
