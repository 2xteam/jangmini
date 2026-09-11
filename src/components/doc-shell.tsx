import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { ScrollTop } from '@/components/scroll-top';

/**
 * 문서형 페이지의 공통 껍데기 — `/resume` `/projects` `/faq` 가 쓴다.
 *
 * 랜딩(챗)과 시각 언어를 공유하되 **레이아웃은 다르다.** 챗은 한 화면에
 * 고정이고 문서는 스크롤이다. 그래서 챗의 전체화면 구조를 재사용하지 않고
 * 여기서 따로 잡는다.
 *
 * 구조는 Brittany Chiang 계열을 참고했다 — 좌측에 프로필이 고정되고 우측이
 * 흐른다. 다만 색·타이포는 원본(toukoum) 것을 그대로 쓴다. 둘을 섞으면
 * 어느 쪽도 아니게 된다.
 */

const NAV = [
  { href: '/resume', label: '이력서' },
  { href: '/projects', label: '프로젝트' },
  { href: '/faq', label: 'FAQ' },
];

export function DocShell({
  title,
  lead,
  aside,
  backTo,
  children,
}: {
  title: string;
  lead?: string;
  /** 좌측 고정 영역에 덧붙일 것 (없으면 프로필 블록만) */
  aside?: React.ReactNode;
  /**
   * 제목 **위**에 놓는 돌아가기 링크. 상세 → 목록처럼 한 단계 위가 있을 때만 준다.
   *
   * 좌측에 두지 않는 이유 — 모바일에서는 좌측 블록이 본문 위로 접히고,
   * 그 안의 링크는 프로필·내비·메타 뒤에 묻힌다. 제목 바로 위가 어느 화면
   * 크기에서나 처음 눈에 들어오는 자리다.
   */
  backTo?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 md:px-8 md:py-16">
      <div className="md:flex md:gap-12">
        {/* 좌측 — 데스크톱에서 고정 */}
        <aside className="md:sticky md:top-16 md:h-fit md:w-64 md:shrink-0">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="w-9" />
            <span className="font-semibold">장민</span>
          </Link>
          <p className="text-muted-foreground mt-1 text-sm">Full Stack Developer</p>

          <nav className="mt-6 flex gap-4 text-sm md:flex-col md:gap-2">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {n.label}
              </Link>
            ))}
            <Link
              href="/chat"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              AI에게 묻기
            </Link>
          </nav>

          {aside && <div className="mt-6">{aside}</div>}
        </aside>

        {/* 우측 — 본문 */}
        <main className="mt-10 min-w-0 flex-1 md:mt-0">
          {backTo && (
            <Link
              href={backTo.href}
              className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm transition-colors"
            >
              <span aria-hidden="true">←</span>
              {backTo.label}
            </Link>
          )}
          <h1 className="text-3xl font-bold md:text-4xl">{title}</h1>
          {lead && <p className="text-muted-foreground mt-2 text-sm md:text-base">{lead}</p>}
          <div className="mt-8">{children}</div>
        </main>
      </div>

      {/* 문서형 페이지는 길다. 다 읽고 위로 돌아갈 길을 둔다 */}
      <ScrollTop />
    </div>
  );
}

/**
 * 문서 안의 절. Matt Rothenberg 처럼 번호를 매긴다 — 이력서를 웹으로 옮긴
 * 느낌을 주고, 스크롤 위치를 말로 가리킬 수 있게 된다("03 대표 프로젝트").
 */
export function DocSection({
  no,
  title,
  action,
  children,
}: {
  no: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={`s-${no}`} className="scroll-mt-16 border-t py-8 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="flex items-baseline gap-3 text-lg font-semibold">
          <span className="text-muted-foreground text-sm tabular-nums">{no}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
