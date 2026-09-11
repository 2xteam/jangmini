import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Image from 'next/image';
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

  /**
   * 이관 후에는 `images` 배열이 진실이다. `source.imageCount` 는 수집 시점의
   * 힌트일 뿐이고 빈 이미지 블록 때문에 실제와 어긋난다.
   */
  const images = p.images ?? [];

  return (
    <DocShell
      title={p.title}
      lead={p.summary ?? undefined}
      backTo={{ href: '/projects', label: '프로젝트 전체' }}
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
                  <dt className="text-muted-foreground text-[11px] tracking-[0.08em] uppercase">
                    {label}
                  </dt>
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
        </div>
      }
    >
      {/*
       * 본문은 Notion 에서 온 마크다운이고 개요/역할/성과/회고 4단이 그대로
       * 살아 있다 — 47/47 이 같은 구조라서 여기서 따로 조판할 것이 없다.
       * 회고는 접지 않고 펼쳐 둔다. "무엇을 만들었다" 보다 "무엇을 배웠다" 가
       * 판단력을 보여주는데, 대부분의 포트폴리오에는 없는 부분이다.
       */}
      {/*
        본문 폭을 46rem 으로 묶는다. 화면 폭을 다 쓰면 한글 한 줄이 60자를
        넘어가서, 줄을 바꿀 때마다 눈이 처음을 놓친다.

        절 제목(h2)을 본문보다 확실히 키운다 — 예전에는 18px 대 14px 이라
        개요/역할/성과/회고 네 덩어리가 한 덩어리로 보였다.
      */}
      <article className="max-w-[46rem] text-[15px] leading-[1.85] [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:border-t [&_h2]:pt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-[-0.02em] [&_h2:first-child]:mt-0 [&_h2:first-child]:border-t-0 [&_h2:first-child]:pt-0 [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
        <Markdown remarkPlugins={[remarkGfm]}>{p.body ?? ''}</Markdown>
      </article>

      {images.length > 0 && (
        <section className="mt-8 border-t pt-6">
          <h2 className="mb-3 text-lg font-semibold">화면</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {images.map((img, i) => (
              <a
                key={img.url}
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-accent/50 block overflow-hidden rounded-xl border transition-colors"
              >
                {/*
                 * 원본 크기를 모른다(Notion 이 주지 않는다). 그래서 고정 비율
                 * 컨테이너에 `object-contain` 으로 담는다 — `cover` 로 두면
                 * 스크린샷의 위아래가 잘려 정작 봐야 할 UI 가 사라진다.
                 */}
                <Image
                  src={img.url}
                  alt={img.alt ?? `${p.title} 이미지 ${i + 1}`}
                  width={1600}
                  height={900}
                  sizes="(min-width: 640px) 50vw, 100vw"
                  className="h-auto w-full bg-white object-contain"
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </DocShell>
  );
}
