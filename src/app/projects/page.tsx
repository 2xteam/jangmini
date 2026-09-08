import type { Metadata } from 'next';
import Link from 'next/link';
import { DocShell } from '@/components/doc-shell';
import { ProjectCard } from '@/components/projects/AllProjects';
import { getProjectList, getTechFacets } from '@/lib/portfolio';

export const metadata: Metadata = {
  title: '프로젝트 — 장민',
  description: '2011년부터 지금까지의 프로젝트 45건. 기술 태그로 좁혀 볼 수 있습니다.',
};

export const revalidate = 3600;

/**
 * 프로젝트 아카이브. 45건 전부를 담는다.
 *
 * 필터를 **URL 쿼리(`?tech=`)로** 두고 서버에서 걸러 온다. 클라이언트 상태로
 * 두면 필터를 걸어 놓은 화면을 링크로 보낼 수 없고, 검색엔진도 필터된 목록을
 * 보지 못한다. 태그 32종은 손으로 관리하지 않고 DB 에서 집계한다.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tech?: string }>;
}) {
  const { tech } = await searchParams;
  const [projects, facets] = await Promise.all([
    getProjectList({ tech }),
    getTechFacets(),
  ]);

  return (
    <DocShell
      title="프로젝트"
      lead={
        tech
          ? `${tech} 를 쓴 프로젝트 ${projects.length}건`
          : `2011년부터 지금까지 ${projects.length}건. 기술 태그로 좁혀 볼 수 있습니다.`
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
      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          해당 태그의 프로젝트가 없습니다.{' '}
          <Link href="/projects" className="underline underline-offset-4">
            전체 보기
          </Link>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.slug} p={p} />
          ))}
        </div>
      )}
    </DocShell>
  );
}
