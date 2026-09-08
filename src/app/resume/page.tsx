import type { Metadata } from 'next';
import Link from 'next/link';
import { DocShell, DocSection } from '@/components/doc-shell';
import { ProjectCard } from '@/components/projects/AllProjects';
import {
  getProfile,
  getByKind,
  getProjectList,
  getSkillGroups,
  getStackTimeline,
} from '@/lib/portfolio';

export const metadata: Metadata = {
  title: '이력서 — 장민',
  description: '장민의 경력·대표 프로젝트·기술 스택·학력을 한 장으로 정리한 문서입니다.',
};

/**
 * 문서형 이력서.
 *
 * **대표 프로젝트만 싣는다.** 45건을 한 스크롤에 넣으면 TracX AI Agent(2026)가
 * 게시판 플렛폼(2014) 옆에 묻힌다. 전체는 /projects 가 필터와 함께 담당한다.
 *
 * `revalidate` 를 두는 이유 — 내용이 하루에 몇 번 바뀌는 종류가 아니고,
 * 요청마다 Atlas 를 때릴 이유가 없다. 재수집 후 최대 1시간이면 반영된다.
 */
export const revalidate = 3600;

export default async function ResumePage() {
  const [profile, experiences, featured, skillGroups, education, certificates, activities, timeline] =
    await Promise.all([
      getProfile(),
      getByKind('experience'),
      getProjectList({ featuredOnly: true }),
      getSkillGroups(),
      getByKind('education'),
      getByKind('certificate'),
      getByKind('activity'),
      getStackTimeline(5),
    ]);

  const about = (profile?.body ?? '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim())
    .filter((p) => p && !p.startsWith('>') && !p.startsWith('!['));

  return (
    <DocShell
      title="이력서"
      lead="14년차 풀스택 개발자. 경력과 대표 프로젝트를 한 장으로 정리했습니다."
      aside={
        <div className="text-muted-foreground space-y-1.5 text-sm">
          {(profile?.links ?? []).map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground block truncate transition-colors"
            >
              {l.label}
            </a>
          ))}
        </div>
      }
    >
      <DocSection no="01" title="소개">
        <div className="space-y-3 text-sm leading-relaxed">
          {about.slice(0, 4).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </DocSection>

      <DocSection no="02" title="경력">
        <ol className="space-y-5 border-l pl-5">
          {experiences.map((e) => (
            <li key={e.slug} className="relative">
              <span className="bg-primary absolute -left-[1.4rem] top-2 h-2 w-2 rounded-full" />
              <div className="text-muted-foreground text-xs tabular-nums">
                {e.period?.label}
              </div>
              <h3 className="mt-0.5 font-semibold">{e.title}</h3>
              {(e.highlights ?? []).length > 0 && (
                <ul className="text-muted-foreground mt-1.5 list-disc space-y-0.5 pl-4 text-sm">
                  {e.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </DocSection>

      <DocSection
        no="03"
        title="대표 프로젝트"
        action={
          <Link href="/projects" className="text-muted-foreground text-sm hover:underline">
            전체 45건 →
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {featured.map((p) => (
            <ProjectCard key={p.slug} p={p} />
          ))}
        </div>
      </DocSection>

      <DocSection no="04" title="기술 스택">
        {/*
         * 연대기를 먼저 둔다. "2012~2022 ASP.NET 풀스택 → 2023 프론트엔드
         * 전환 → 2026 AI·Next.js" 라는 14년 서사가 목록보다 먼저 읽혀야 한다.
         * 45건 전부에 기간과 태그가 있어서 만들 수 있는 표다.
         */}
        <div className="mb-6 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <tbody>
              {timeline.map((t) => (
                <tr key={t.year} className="border-b last:border-b-0">
                  <td className="text-muted-foreground w-14 py-1.5 tabular-nums">{t.year}</td>
                  <td className="text-muted-foreground w-12 py-1.5 text-xs tabular-nums">
                    {t.projectCount}건
                  </td>
                  <td className="py-1.5">{t.top.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          {skillGroups.map((g) => (
            <div key={g.category} className="text-sm">
              <span className="text-muted-foreground mr-2 inline-block min-w-[11rem] align-top">
                {g.category}
              </span>
              <span>{g.items.map((i) => i.name).join(' · ')}</span>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection no="05" title="학력 · 자격 · 활동">
        <div className="space-y-5 text-sm">
          {[
            { label: '학력', items: education },
            { label: '자격증', items: certificates },
            { label: '교육 및 대외활동', items: activities },
          ].map(({ label, items }) =>
            items.length ? (
              <div key={label}>
                <h3 className="mb-1.5 font-semibold">{label}</h3>
                <ul className="space-y-1">
                  {items.map((e) => (
                    <li key={e.slug}>
                      <span className="text-muted-foreground mr-2 inline-block min-w-[9.5rem] tabular-nums">
                        {e.summary ?? '—'}
                      </span>
                      <span>{e.title}</span>
                      {e.company && <span className="text-muted-foreground"> · {e.company}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      </DocSection>
    </DocShell>
  );
}
