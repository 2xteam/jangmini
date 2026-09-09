import { sessionFromRequest } from '@/lib/reader-session';

/**
 * 현재 로그인 상태. 헤더 배지가 이걸 읽는다.
 *
 * ⚠️ myjane 의 `snap_user` 쿠키도 이 요청에 함께 도착하지만 **보지 않는다.**
 * jangmini 의 로그인 여부는 `jangmini_reader` 하나로만 판단한다.
 */
export async function GET(req: Request) {
  const s = sessionFromRequest(req);
  return Response.json(
    s
      ? {
          loggedIn: true,
          readerId: s.readerId,
          role: s.role,
          unlimited: s.unlimited,
          expiresAt: s.expiresAt,
        }
      : { loggedIn: false },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
