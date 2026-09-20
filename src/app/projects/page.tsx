import type { Metadata } from 'next';
import Link from 'next/link';
import { DocShell } from '@/components/doc-shell';
import { FlagshipCard, ProjectCard, TimelineRow } from '@/components/projects/AllProjects';
import { getProjectsByTier, getTechFacets } from '@/lib/portfolio';

export const metadata: Metadata = {
  title: '프로젝트 — 장민',
  description: '대표 프로젝트와 2011년부터의 작업 연표. 기술 태그로 좁혀 볼 수 있습니다.',
};

export const revalidate = 3600;

/**
 * 프로젝트 아카이브.
 *
 * **세는 목록이 아니라 고르는 목록이다.** 예전에는 46건이 같은 카드로 균일하게
 * 깔려 있었다. 그러면 12년치 작업 단위가 대표작과 같은 무게로 보여서, 무엇을
 * 봐야 하는지가 화면에 없다. 지금은 Notion 의 `구분` 을 따라 셋으로 나눈다 —
 * 대표는 한 줄에 하나씩 요약까지, 개인은 카드로, 연표는 한 줄씩.
 *
 * 대표 안으로 합쳐진 원본 22건은 목록에서 빠진다. 문서는 남아 있어서
 * `/projects/<slug>` 로는 계속 열린다 → lib/portfolio.ts
 *
 * 필터는 **URL 쿼리(`?tech=`)** 다. 클라이언트 상태로 두면 필터를 걸어 놓은
 * 화면을 링크로 보낼 수 없고, 검색엔진도 필터된 목록을 보지 못한다.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tech?: string }>;
}) {
  const { tech } = await searchParams;
  const [{ flagship, personal, timeline, total }, facets] = await Promise.all([
    getProjectsByTier(tech),
    getTechFacets(),
  ]);

  return (
    <DocShell
      title="프로젝트"
      lead={
        tech
          ? `${tech} 를 쓴 프로젝트 ${total}건`
          : `대표 ${flagship.length}건과 개인 프로젝트 ${personal.length}건, 그리고 2011년부터의 작업 ${timeline.length}건.`
      }
      aside={
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-medium">기술 태그</div>
          <div className="flex flex-wrap gap-1.5">
            <Link
              href="/projects"
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                tech ? 'text-muted-foreground hover:bg-accent/50' : 'bg-foreground text-background'
              }`}
            >
              전체
            </Link>
            {facets.map((f) => (
              <Link
                key={f.tech}
                href={`/projects?tech=${encodeURIComponent(f.tech)}`}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  tech === f.tech
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
              >
                {f.tech} <span className="opacity-60">{f.count}</span>
              </Link>
            ))}
          </div>
        </div>
      }
    >
      {total === 0 ? (
        <p className="text-muted-foreground text-sm">
          해당 태그의 프로젝트가 없습니다.{' '}
          <Link href="/projects" className="underline underline-offset-4">
            전체 보기
          </Link>
        </p>
      ) : (
        <div className="space-y-12">
          {/*
            호버한 칸만 남기고 나머지를 흐리게 — laplaya.studio 에서 가져왔다.
            포인터를 올린 자리에 초점이 생긴다. 터치 화면에는 호버가 없으니
            아무 일도 일어나지 않는다.
          */}
          {flagship.length > 0 && (
            <Section title="대표" note="여러 작업을 묶어 한 건으로 정리했습니다">
              <div className="grid gap-3 [&:hover>a:not(:hover)]:opacity-50">
                {flagship.map((p) => (
                  <FlagshipCard key={p.slug} p={p} />
                ))}
              </div>
            </Section>
          )}

          {personal.length > 0 && (
            <Section title="개인 프로젝트" note="업무 밖에서 직접 만든 것들">
              <div className="grid gap-3 [&:hover>a:not(:hover)]:opacity-50 sm:grid-cols-2">
                {personal.map((p) => (
                  <ProjectCard key={p.slug} p={p} />
                ))}
              </div>
            </Section>
          )}

          {timeline.length > 0 && (
            <Section title="연표" note={`2011년부터의 작업 ${timeline.length}건`}>
              <div className="divide-y [&:hover>a:not(:hover)]:opacity-50">
                {timeline.map((p) => (
                  <TimelineRow key={p.slug} p={p} />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </DocShell>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3 border-b pb-2">
        <h2 className="text-lg font-bold tracking-[-0.02em]">{title}</h2>
        <p className="text-muted-foreground text-xs">{note}</p>
      </div>
      {children}
    </section>
  );
}
