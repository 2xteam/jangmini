import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Analytics } from '@vercel/analytics/react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Load Inter font for non-Apple devices
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const SITE_URL = 'https://jangmini.myjane.co.kr';
const TITLE = 'jangmini — 장민 포트폴리오';
const DESCRIPTION =
  '14년차 풀스택 개발자 장민의 포트폴리오. 프로젝트와 이력을 문서로 보거나, AI에게 물어볼 수 있습니다.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    '장민',
    'jangmini',
    '포트폴리오',
    '풀스택 개발자',
    'Full Stack Developer',
    'Next.js',
    'React',
    'TypeScript',
    'ASP.NET',
    'AI',
  ],
  authors: [{ name: '장민', url: SITE_URL }],
  creator: '장민',
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'jangmini',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '장민 — Full Stack Developer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
  /**
   * icons 를 손으로 적지 않는다.
   *
   * Next 의 파일 컨벤션이 `src/app/icon.png` · `src/app/apple-icon.png` 를
   * 보고 <link rel="icon"> 태그를 **자동 생성**한다. 두 파일은
   * `pnpm icons` 가 public/avatar.png 에서 만든다.
   *
   * 손으로 적으면 두 곳이 어긋난다 — 원본은 여기에 없는
   * `/apple-touch-icon.svg` 를 적어 둬서 iOS 가 404 를 받고 있었다.
   */
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /**
     * 본문이 한국어이므로 ko 다. en 으로 두면 스크린 리더가 한국어를
     * 영어 발음으로 읽고, 브라우저 번역이 엉뚱하게 걸린다.
     */
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        {/*
         * ⚠️ 원작자의 서드파티 애널리틱스(datafa.st)를 제거했다.
         *
         * `data-website-id="68e067ba…"` · `data-domain="toukoum.fr"` 로 박혀
         * 있어서, 배포된 우리 사이트의 방문자 트래픽이 **원작자 계정으로**
         * 전송되고 있었다. 우리 방문자 데이터를 남에게 보내는 것이므로
         * 기능 문제가 아니라 프라이버시 문제다.
         *
         * 방문자 통계가 필요하면 @vercel/analytics 가 이미 아래에 있다.
         */}
      </head>
      <body
        className={cn(
          'bg-background min-h-screen font-sans antialiased',
          inter.variable
        )}
      >
        <main className="flex min-h-screen flex-col">{children}</main>
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
