'use client';

import { useEffect, useState } from 'react';

/**
 * 우하단에 뜨는 "맨 위로" 버튼.
 *
 * 문서형 페이지는 길다 — 프로젝트 상세는 본문 2500px 에 갤러리가 더 붙는다.
 * 다 읽고 나면 위로 돌아갈 방법이 휠뿐이다.
 *
 * ⚠️ **보이는 것을 애니메이션에 맡기지 않는다.** 스크롤 위치에 따라 아예
 * 붙였다 뗐다 한다(등장 효과 없음). 애니메이션이 시작 상태에서 멈춘 브라우저
 * 에서 투명한 버튼이 남는 일을 겪은 적이 있다.
 * → my-obsidian-vault / 30-Patterns/화면 확인의 함정.md
 *
 * 스크롤 이벤트는 `requestAnimationFrame` 으로 한 프레임에 한 번만 읽는다
 * — `ScrollProgress` 와 같은 이유다.
 */

/** 이만큼 내려가면 나타난다. 한 화면쯤 내려간 뒤가 자연스럽다 */
const SHOW_AFTER_PX = 600;

export function ScrollTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setShow(window.scrollY > SHOW_AFTER_PX);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  if (!show) return null;

  const toTop = () => {
    /** 움직임을 줄여 달라고 한 사람에게는 바로 올려 준다 */
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="맨 위로"
      title="맨 위로"
      className="bg-background hover:bg-accent fixed right-5 bottom-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition-colors md:right-8 md:bottom-8"
    >
      {/* 아이콘 하나에 라이브러리를 들이지 않는다 */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
  );
}
