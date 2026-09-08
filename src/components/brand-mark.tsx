/**
 * 브랜드 마크와 히어로 아바타.
 *
 * 원작자의 메모지 이미지·영상을 지운 자리를 메운다. 사진을 넣기 전까지 화면이
 * 깨져 보이지 않게 **인라인 SVG** 로 그린다 — 파일에 의존하지 않으므로
 * public/ 이 비어 있어도 정상 렌더링된다.
 *
 * 색은 새로 만들지 않고 랜딩의 빠른 질문 버튼이 쓰는 다섯 색을 그대로 쓴다
 * (`src/app/page.tsx` 의 questionConfig). 원본 디자인 언어를 유지하기 위해서다.
 *
 * ## 실제 사진으로 바꿀 때
 *
 * `public/avatar.png` 를 넣고 HeroAvatar 의 `src` 를 주면 그 이미지가 쓰인다.
 * 주지 않으면 SVG 로 남는다 — 파일이 없을 때 next/image 가 터지는 것을 피하려고
 * **존재 여부를 런타임에 추측하지 않고 호출자가 명시**하게 했다.
 */
import Image from 'next/image';

/** 랜딩 빠른 질문 버튼과 같은 색 */
const BRAND_COLORS = ['#329696', '#3E9858', '#856ED9', '#B95F9D', '#C19433'] as const;

export function BrandMark({ className = 'w-6 md:w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="jangmini">
      <defs>
        <linearGradient id="jm-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BRAND_COLORS[2]} />
          <stop offset="55%" stopColor={BRAND_COLORS[0]} />
          <stop offset="100%" stopColor={BRAND_COLORS[4]} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="14" fill="url(#jm-mark)" />
      <text
        x="24"
        y="24"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize="20"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        장
      </text>
    </svg>
  );
}

/**
 * 히어로 자리. 원본 메모지와 같은 크기·위치를 차지한다.
 *
 * `src` 를 주면 사진, 없으면 SVG 아바타.
 */
export function HeroAvatar({ src, alt = '장민' }: { src?: string; alt?: string }) {
  if (src) {
    return (
      <div className="relative z-10 h-52 w-48 overflow-hidden sm:h-72 sm:w-72">
        <Image
          src={src}
          alt={alt}
          width={1024}
          height={1024}
          priority
          className="h-full w-full rounded-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className="relative z-10 flex h-52 w-48 items-center justify-center sm:h-72 sm:w-72">
      <svg
        viewBox="0 0 200 200"
        className="h-full w-full"
        role="img"
        aria-label={alt}
      >
        <defs>
          <linearGradient id="jm-hero" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={BRAND_COLORS[2]} stopOpacity="0.95" />
            <stop offset="50%" stopColor={BRAND_COLORS[0]} stopOpacity="0.95" />
            <stop offset="100%" stopColor={BRAND_COLORS[4]} stopOpacity="0.95" />
          </linearGradient>
          {/**
           * 원본 메모지가 부드러운 일러스트였으므로 딱딱한 원이 되지 않게
           * 바깥에 옅은 링을 한 겹 둔다.
           */}
          <radialGradient id="jm-halo" cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor={BRAND_COLORS[0]} stopOpacity="0" />
            <stop offset="100%" stopColor={BRAND_COLORS[0]} stopOpacity="0.14" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="98" fill="url(#jm-halo)" />
        <circle cx="100" cy="100" r="72" fill="url(#jm-hero)" />
        <text
          x="100"
          y="102"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize="56"
          fontWeight="700"
          letterSpacing="2"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          장민
        </text>
      </svg>
    </div>
  );
}
