/**
 * 브랜드 마크와 히어로 아바타.
 *
 * 둘 다 사용자가 준 메모지를 쓴다 (2026-09-09 지시 — 그전에는 작은 자리에
 * 그라디언트 "장" 마크를 썼다).
 *
 *   public/avatar.png        눈 뜬 표정 — 히어로
 *   public/avatar-wink.png   윙크 — 작은 마크, 챗에서 답변 중일 때
 *
 * 파비콘·애플 아이콘·OG 도 같은 이미지에서 만든다 → `pnpm icons`
 */
import Image from 'next/image';

export const AVATAR_SRC = '/avatar.png';
export const AVATAR_WINK_SRC = '/avatar-wink.png';

/**
 * 작은 브랜드 마크. 헤더·문서 사이드바처럼 24~40px 로 쓰인다.
 *
 * 이 크기에서 얼굴은 또렷하지 않지만, 브랜드가 사람이면 얼굴이 알아보기
 * 쉬운 표식이다. 파비콘도 같은 이미지라 탭·문서·챗이 한 얼굴로 이어진다.
 *
 * `next/image` 대신 `<img>` 를 쓴다 — 24px 짜리에 최적화 요청을 보내면
 * 요청만 늘고 얻는 것이 없다. `public/` 의 정적 파일이라 그대로 서빙된다.
 */
export function BrandMark({ className = 'w-6 md:w-8' }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={AVATAR_WINK_SRC}
      alt="jangmini"
      className={`${className} aspect-square object-contain`}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * 히어로 자리.
 *
 * `src` 를 주면 그것을 쓴다. 기본값은 눈 뜬 표정이다.
 */
export function HeroAvatar({ src = AVATAR_SRC, alt = '장민' }: { src?: string; alt?: string }) {
  return (
    <div className="relative z-10 h-52 w-48 overflow-hidden sm:h-72 sm:w-72">
      {/*
       * 메모지는 사방에 투명 여백이 있고 배경도 투명하다. rounded-full +
       * object-cover 로 두면 얼굴 옆머리가 잘리므로 contain 으로 담는다.
       */}
      <Image
        src={src}
        alt={alt}
        width={480}
        height={480}
        priority
        className="h-full w-full object-contain"
      />
    </div>
  );
}
