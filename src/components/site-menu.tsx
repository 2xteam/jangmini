'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Menu, X, FileText, FolderOpen, HelpCircle, MessageCircle, Home } from 'lucide-react';

/**
 * 우상단 햄버거 메뉴.
 *
 * 원본 랜딩에는 **다른 페이지로 가는 진입점이 하나도 없었다.** 챗 전용
 * 한 화면 구조였기 때문인데, 우리는 문서 페이지가 생겼으므로 여기서 연다.
 *
 * 정적 링크 넷뿐이라 라이브러리를 더하지 않고 직접 만든다. 그 대신 접근성에
 * 필요한 것은 갖춘다 — Esc 로 닫기, 바깥 클릭으로 닫기, `aria-expanded`.
 */

const ITEMS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/chat', label: 'AI에게 묻기', icon: MessageCircle },
  { href: '/resume', label: '이력서', icon: FileText },
  { href: '/projects', label: '프로젝트', icon: FolderOpen },
  { href: '/faq', label: 'FAQ', icon: HelpCircle },
];

export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    /**
     * `click` 이 아니라 실질적으로 같지만, 여는 클릭이 바로 닫히지 않게
     * 다음 프레임부터 듣는다 — 버튼 클릭이 document 까지 올라오기 때문이다.
     */
    const id = window.setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      document.removeEventListener('click', onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
        className="hover:bg-white/60 flex h-auto w-auto cursor-pointer items-center justify-center rounded-2xl bg-white/30 p-3 shadow-lg backdrop-blur-lg transition-colors"
      >
        {open ? (
          <X className="text-accent-foreground h-6 w-6 md:h-8 md:w-8" />
        ) : (
          <Menu className="text-accent-foreground h-6 w-6 md:h-8 md:w-8" />
        )}
      </button>

      {open && (
        <nav
          /**
           * ⚠️ 등장 애니메이션을 두지 않는다. **가시성을 애니메이션에
           * 의존하게 만들면 안 된다.**
           *
           * 두 번 실패했다 —
           *  ① `AnimatePresence` + `motion.nav` 의 initial(opacity 0)
           *  ② tw-animate-css 의 `animate-in fade-in` (같은 방식으로 0 에서 시작)
           * 둘 다 시작 상태가 opacity 0 이고, 애니메이션이 끝까지 가지 않으면
           * **메뉴가 DOM 에는 있는데 화면에는 없다.** 접근성 트리에는 링크가
           * 다 보이므로 자동 점검으로도 놓치기 쉽다(실제로 놓쳤다).
           *
           * 링크 다섯 개짜리 메뉴에 등장 효과가 주는 값보다, 안 보일 위험이
           * 크다. 배경색 전환만 CSS transition 으로 둔다.
           *
           * 배경은 불투명하다. `/95` + backdrop-blur 로 뒀더니 랜딩의 큰
           * 헤드라인이 메뉴 글자와 겹쳐 읽혔다.
           */
          className="bg-background absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border shadow-2xl"
        >
          <ul className="p-1.5">
            {ITEMS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className="hover:bg-accent flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors"
                >
                  <Icon className="text-muted-foreground h-4 w-4" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
