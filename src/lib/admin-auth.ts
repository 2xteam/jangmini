import { sessionFromRequest, isAdminReady, type ReaderSession } from '@/lib/reader-session';
import { isAllowedOrigin } from '@/lib/guard';

/**
 * admin API 의 관문. **모든 `/api/admin/*` 라우트가 첫 줄에서 이걸 부른다.**
 *
 * 한 곳에 모으는 이유 — 라우트마다 각자 검사하면 새 라우트를 만들 때
 * 빠뜨리기 쉽고, 빠뜨려도 아무 에러가 나지 않는다. 관리 화면이 조용히
 * 열려 있는 것이 최악이다.
 *
 * 통과 조건 세 개 —
 *   · Origin 이 우리 사이트
 *   · 세션의 role 이 admin
 *   · **10분 안에 비밀번호를 재확인**했다 (step-up)
 */
export type AdminOk = { ok: true; session: ReaderSession };
export type AdminFail = { ok: false; response: Response };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function requireAdmin(req: Request): AdminOk | AdminFail {
  if (!isAllowedOrigin(req)) {
    return { ok: false, response: json(403, { error: '허용되지 않은 요청입니다.' }) };
  }
  const session = sessionFromRequest(req);
  if (!session || session.role !== 'admin') {
    return { ok: false, response: json(403, { error: '권한이 없습니다.' }) };
  }
  if (!isAdminReady(session)) {
    /**
     * 401 이 아니라 **403 + 코드**를 준다. 화면이 이걸 보고 "다시 로그아웃"
     * 이 아니라 "비밀번호 재확인" 을 띄워야 한다.
     */
    return {
      ok: false,
      response: json(403, { error: '비밀번호를 다시 확인해 주세요.', code: 'STEP_UP_REQUIRED' }),
    };
  }
  return { ok: true, session };
}
