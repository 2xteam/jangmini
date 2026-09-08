import type { NextConfig } from 'next';

/**
 * R2 공개 URL 의 호스트만 허용한다.
 *
 * 원본에는 `images.domains` 에 unsplash · aceternity 가 있었다 — 원작자
 * 템플릿이 쓰던 것이고 우리 이미지는 전부 R2 에 있다. `domains` 는 Next 15
 * 에서 폐기 예정이라 `remotePatterns` 로 옮겼다.
 *
 * 호스트를 환경 변수에서 읽지 않고 **적어 둔다** — next.config 는 빌드 시점에
 * 평가되고, 여기서 env 를 읽으면 값이 없는 환경에서 조용히 빈 배열이 되어
 * 이미지가 전부 최적화 없이 깨진다.
 */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-b6ba1f5f07ef4f8c9be1a32f6beccf5c.r2.dev',
        pathname: '/**',
      },
    ],
  },
  eslint: {
    /** eslint 오류로 빌드를 막지 않는다 (원본 설정 유지) */
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
