import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocShell } from '@/components/doc-shell';
import { Badge } from '@/components/ui/badge';
import { getProject, getProjectList } from '@/lib/portfolio';

export const revalidate = 3600;

/** 45건을 미리 만들어 둔다. 요청마다 Atlas 를 때릴 이유가 없다 */
export async function generateStaticParams() {
  const projects = await getProjectList({});
  return projects.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProject(slug);
  if (!p) return { title: '프로젝트를 찾을 수 없습니다 — 장민' };
  return {
    title: `${p.title} — 장민`,
    description: p.summary ?? undefined,
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProject(slug);
  if (!p) notFound();

  const imageCount = (p.source as { imageCount?: number })?.imageCount ?? 0;

  return (
    <DocShell
      title={p.title}
      lead={p.summary ?? undefined}
      aside={
        <div className="space-y-4 text-sm">
          <dl className="space-y-2">
            {[
              ['기간', p.period?.label],
              ['소속', p.company],
              ['역할', p.role],
              ['팀 구성', p.teamSize],
              ['기여도', p.contribution != null ? `${Math.round(p.contribution * 100)}%` : null],
            ].map(([label, value]) =>
              value ? (
                <div key={label as string}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="mt-0.5">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>

          {p.techStack.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1.5 text-xs">기술</div>
              <div className="flex flex-wrap gap-1.5">
                {p.techStack.map((t) => (
                  <Link key={t} href={`/projects?tech=${encodeURIComponent(t)}`}>
                    <Badge variant="secondary" className="px-2 py-0.5 text-xs font-normal">
                      {t}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {p.links.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1.5 text-xs">링크</div>
              <ul className="space-y-1">
                {p.links.map((l) => (
                  <li key={l.url}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground block truncate underline underline-offset-4 transition-colors"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link href="/projects" className="text-muted-foreground block hover:underline">
            ← 프로젝트 전체
          </Link>
        </div>
      }
    >
      {/*
       * 본문은 Notion 에서 온 마크다운이고 개요/역할/성과/회고 4단이 그대로
       * 살아 있다 — 47/47 이 같은 구조라서 여기서 따로 조판할 것이 없다.
       * 회고는 접지 않고 펼쳐 둔다. "무엇을 만들었다" 보다 "무엇을 배웠다" 가
       * 판단력을 보여주는데, 대부분의 포트폴리오에는 없는 부분이다.
       */}
      <article className="prose-headings:font-semibold max-w-none text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:border-t [&_h2]:pt-6 [&_h2]:text-lg [&_h2:first-child]:mt-0 [&_h2:first-child]:border-t-0 [&_h2:first-child]:pt-0 [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
        <Markdown remarkPlugins={[remarkGfm]}>{p.body ?? ''}</Markdown>
      </article>

      {imageCount > 0 && (
        /**
         * 이미지는 아직 R2 로 옮기지 않았다. Notion 이 주는 URL 은 presigned
         * 이고 한 시간 뒤 깨지므로 저장하지 않았고, 몇 장이 있었는지만 기록해
         * 두었다. 옮기면 이 자리에 그린다.
         */
        <p className="text-muted-foreground mt-8 border-t pt-6 text-xs">
          이 프로젝트에는 이미지 {imageCount}장이 있습니다. 이관 중입니다.
        </p>
      )}
    </DocShell>
  );
}
