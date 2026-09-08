'use client';

import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { BrandMark } from '@/components/brand-mark';
import Link from 'next/link';

/**
 * 본인 소개. `getPresentation` tool 이 DB(kind: 'profile')에서 읽어 온다.
 * 원본은 원작자의 나이·가족·학교가 이 파일에 하드코딩돼 있었다.
 */

type PresentationData =
  | {
      name?: string;
      headline?: string | null;
      about?: string | null;
      links?: { label: string; url: string }[];
      error?: string;
    }
  | undefined;

export function Presentation({ data }: { data?: PresentationData }) {
  if (!data || data.error) {
    return <div className="text-muted-foreground px-1 py-6">소개 정보를 불러오지 못했습니다.</div>;
  }

  /**
   * 프로필 본문은 Notion 루트 페이지에서 온 마크다운이다. 마크다운 렌더러를
   * 새로 끼우지 않고 **문단 단위로만** 나눠 보여준다 — 이 자리에 필요한 것은
   * 서식이 아니라 읽히는 문장이다. 헤딩·불릿은 걷어낸다.
   */
  const paragraphs = (data.about ?? '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim())
    .filter((p) => p && !p.startsWith('>') && !p.startsWith('!['));

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
      className="mx-auto w-full max-w-5xl"
    >
      <Card className="w-full border-none px-0 shadow-none">
        <CardContent className="space-y-4 px-0">
          <div className="flex items-center gap-3">
            <BrandMark className="w-10" />
            <div>
              <h2 className="text-primary text-3xl font-bold">{data.name}</h2>
              {data.headline && (
                <p className="text-muted-foreground text-sm">{data.headline}</p>
              )}
            </div>
          </div>

          <div className="space-y-3 text-sm leading-relaxed">
            {paragraphs.slice(0, 6).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            <Link href="/resume" className="underline underline-offset-4">
              이력서 문서로 보기 →
            </Link>
            <Link href="/projects" className="underline underline-offset-4">
              프로젝트 전체 보기 →
            </Link>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
