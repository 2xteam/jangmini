import type { Metadata } from 'next';
import { sessionFromCookies, isAdminReady } from '@/lib/reader-session';
import { AdminConsole } from './console';
import { StepUpForm } from './step-up';
import { DocShell } from '@/components/doc-shell';

/**
 * jangmini 자체 admin. **myjane 통합 admin 과 무관하다** — 이 앱의 DB 만 본다
 * → my-obsidian-vault / 10-Projects/jangmini.md
 *
 * 3단 관문 —
 *   ① 로그인 안 됨 / admin 아님 → 아무것도 보여주지 않는다
 *   ② admin 이지만 비밀번호 재확인 안 됨 → step-up 폼
 *   ③ 통과 → 콘솔
 *
 * ②가 필요한 이유는 admin 을 `readers.role` 로 구분해서다 — reader 비밀번호가
 * 곧 admin 권한이고 초기값이 4자리다 → src/app/api/reader/stepup/route.ts
 */
export const metadata: Metadata = {
  title: '관리 — jangmini',
  /** 검색엔진에 넣지 않는다 */
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await sessionFromCookies();

  if (!session || session.role !== 'admin') {
    return (
      <DocShell title="관리" lead="접근 권한이 없습니다.">
        <p className="text-muted-foreground text-sm">
          관리자 계정으로 로그인한 뒤 다시 열어 주세요. 로그인 버튼은 첫 화면 우상단에 있습니다.
        </p>
      </DocShell>
    );
  }

  if (!isAdminReady(session)) {
    return (
      <DocShell title="관리" lead="비밀번호를 다시 확인해 주세요.">
        <StepUpForm readerId={session.readerId} />
      </DocShell>
    );
  }

  return (
    <DocShell title="관리" lead={`${session.readerId} · 세션은 2시간 뒤 만료됩니다.`}>
      <AdminConsole />
    </DocShell>
  );
}
