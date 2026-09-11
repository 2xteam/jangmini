'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 문서형 페이지의 좌측 내비.
 *
 * **지금 어디에 있는지**를 강조색으로 표시한다. 예전에는 네 항목이 모두
 * 같은 회색이라, 목록을 보고 있는지 이력서를 보고 있는지 내비만으로는
 * 알 수 없었다.
 *
 * 이 파일만 클라이언트 컴포넌트인 이유 — `usePathname` 이 필요하다.
 * DocShell 전체를 클라이언트로 만들면 본문까지 따라 내려간다.
 */

const NAV = [
  { href: '/resume', label: '이력서' },
  { href: '/projects', label: '프로젝트' },
  { href: '/faq', label: 'FAQ' },
  { href: '/chat', label: 'AI에게 묻기' },
];

export function DocNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="mt-6 flex gap-4 text-sm md:flex-col md:gap-2">
      {NAV.map((n) => {
        /** `/projects/fitlog` 도 "프로젝트" 가 현재 위치다 */
        const here = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={here ? 'page' : undefined}
            className={
              here
                ? 'text-brand-ink font-semibold'
                : 'text-muted-foreground hover:text-foreground transition-colors'
            }
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
