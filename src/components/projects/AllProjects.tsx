'use client';

import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

/**
 * `getProjects` tool 이 DB 에서 읽어 온 목록을 그린다.
 * 원본은 `Data.tsx` 의 하드코딩 배열(496줄)을 읽었다.
 *
 * 본문은 담기지 않는다 — tool 반환값이 모델 컨텍스트로 들어가므로 요약만
 * 넘긴다. 자세한 내용은 `/projects/[slug]` 로 보낸다.
 */

export type ProjectSummary = {
  slug: string;
  title: string;
  summary: string | null;
  company: string | null;
  period: string | null;
  techStack: string[];
  contribution: number | null;
  featured: boolean;
  tier?: 'flagship' | 'personal' | 'timeline' | 'merged';
};

type ProjectsData =
  | { projects?: ProjectSummary[]; shown?: number; totalPublic?: number; note?: string }
  | undefined;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.19, 1, 0.22, 1] } },
};

/**
 * 목록 한 칸.
 *
 * **대표 프로젝트를 나머지와 다르게 조판한다.** 46건이 전부 같은 카드로
 * 나열되면 8건을 골라 둔 의미가 화면에 나타나지 않는다. 테두리를 하나 더
 * 두르는 대신 — 그러면 카드가 더 무거워질 뿐이다 — 라벨과 제목 크기로
 * 구분한다.
 */
export function ProjectCard({ p }: { p: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${p.slug}`}
      className={`hover:bg-accent/50 group block rounded-2xl border p-4 transition-[background-color,opacity,border-color] ${
        p.featured ? 'border-foreground/20' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            {p.period && <span>{p.period}</span>}
            {p.company && <span>· {p.company}</span>}
            {/* 기여도는 있을 때만. 없는 값을 0 으로 보이게 하지 않는다 */}
            {p.contribution != null && <span>· 기여도 {Math.round(p.contribution * 100)}%</span>}
          </div>
          {p.featured && (
            <p className="text-brand mt-1.5 text-[10.5px] font-semibold tracking-[0.12em] uppercase">
              대표
            </p>
          )}
          <h3
            className={`mt-1 truncate font-semibold group-hover:underline ${
              p.featured ? 'text-base' : 'text-[15px]'
            }`}
          >
            {p.title}
          </h3>
          {p.summary && (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">{p.summary}</p>
          )}
        </div>
        <ArrowUpRight className="text-muted-foreground h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      {p.techStack.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.techStack.map((t) => (
            <Badge key={t} variant="secondary" className="px-2 py-0.5 text-xs font-normal">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}

/**
 * 대표 한 건.
 *
 * 카드를 키우는 대신 **한 줄에 하나만** 둔다. 2단으로 깔면 대표도 결국
 * 목록이 되어 버린다. 요약을 두 줄까지 보여 주는 것이 대표와 나머지를
 * 가르는 실질적인 차이다 — 연표는 제목만 준다.
 */
export function FlagshipCard({ p }: { p: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${p.slug}`}
      className="hover:bg-accent/40 group block rounded-2xl border p-5 transition-[background-color,opacity,border-color] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            {p.period && <span>{p.period}</span>}
            {p.company && <span>· {p.company}</span>}
          </div>
          <h3 className="mt-1.5 text-lg font-bold tracking-[-0.02em] group-hover:underline sm:text-xl">
            {p.title}
          </h3>
          {p.summary && (
            <p className="text-muted-foreground mt-2 line-clamp-3 text-sm leading-relaxed">
              {p.summary}
            </p>
          )}
        </div>
        <ArrowUpRight className="text-muted-foreground mt-1 h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      {p.techStack.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {p.techStack.map((t) => (
            <Badge key={t} variant="secondary" className="px-2 py-0.5 text-xs font-normal">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}

/**
 * 연표 한 줄.
 *
 * 21건은 "무엇을 만들었나" 가 아니라 **"얼마나 오래, 얼마나 넓게" 를 보여주는
 * 배경**이다. 그래서 카드가 아니라 줄이다. 카드로 두면 대표와 같은 무게가
 * 되어 21건이 4건을 덮는다.
 */
export function TimelineRow({ p }: { p: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${p.slug}`}
      className="hover:bg-accent/40 group -mx-2 flex items-baseline gap-3 rounded-lg px-2 py-2 transition-colors"
    >
      <span className="text-muted-foreground w-[4.5rem] shrink-0 font-mono text-xs tabular-nums">
        {p.period?.slice(0, 7) ?? ''}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm group-hover:underline">{p.title}</span>
      {p.company && (
        <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">{p.company}</span>
      )}
    </Link>
  );
}

export default function AllProjects({ data }: { data?: ProjectsData }) {
  const projects = data?.projects ?? [];
  const total = data?.totalPublic;

  if (!projects.length) {
    return (
      <div className="text-muted-foreground px-1 py-6">
        조건에 맞는 프로젝트를 찾지 못했습니다.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
      className="mx-auto w-full max-w-5xl"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-primary text-3xl font-bold">프로젝트</h2>
        {total != null && total > projects.length && (
          <Link href="/projects" className="text-muted-foreground text-sm hover:underline">
            전체 {total}건 보기 →
          </Link>
        )}
      </div>

      <motion.div
        className="grid gap-3 sm:grid-cols-2"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {projects.map((p) => (
          <motion.div key={p.slug} variants={itemVariants}>
            <ProjectCard p={p} />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
