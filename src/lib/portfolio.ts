import { connectDb } from '@/lib/db';
import { Portfolio, type PortfolioDoc, type PortfolioKind } from '@/models/Portfolio';
import { applyOverrides, type WithOverrides } from '@/lib/overrides';

/**
 * portfolio 컬렉션 조회를 한곳에 모은다.
 *
 * **모든 조회는 `visibility: 'public'` 을 건다.** 비공개 항목을 프롬프트로만
 * 막으면 언젠가 새 나가므로, 쿼리 단계에서 아예 집지 않는다.
 * → my-obsidian-vault / 10-Projects/jangmini.md
 *
 * 목록용 요약(`ProjectSummary`)과 상세(`PortfolioDoc`)를 나눈 이유 — tool 이
 * 반환한 값은 그대로 모델의 컨텍스트로 들어간다. 45건의 본문 전체를 넘기면
 * 요청 한 번의 입력 토큰이 수만 개가 된다. 목록에는 본문을 담지 않는다.
 */

const PUBLIC = { visibility: 'public' as const };

/**
 * admin 에서 고친 값을 원본 위에 얹는다.
 *
 * ⚠️ **이 파일에서 문서를 내보내는 모든 자리를 거쳐야 한다.** 한 군데라도
 * 빠뜨리면 그 화면만 옛 값을 보여준다. → lib/overrides.ts
 */
const merge = <T extends WithOverrides | null>(d: T) => applyOverrides(d);

export type ProjectSummary = {
  slug: string;
  title: string;
  summary: string | null;
  company: string | null;
  period: string | null;
  techStack: string[];
  contribution: number | null;
  featured: boolean;
  imageCount: number;
};

const toSummary = (d: PortfolioDoc & { featured?: boolean }): ProjectSummary => ({
  slug: d.slug,
  title: d.title,
  summary: d.summary ?? null,
  company: d.company ?? null,
  period: d.period?.label ?? null,
  techStack: d.techStack ?? [],
  contribution: d.contribution ?? null,
  featured: Boolean(d.featured),
  imageCount: (d.source as { imageCount?: number })?.imageCount ?? 0,
});

/** 목록에서 본문을 제외한다 */
const LIST_FIELDS =
  'slug title summary company role teamSize period techStack contribution featured category level order source.imageCount overrides';

export async function getProjectList(opts: {
  featuredOnly?: boolean;
  tech?: string;
  company?: string;
  limit?: number;
} = {}): Promise<ProjectSummary[]> {
  await connectDb();
  const q: Record<string, unknown> = { ...PUBLIC, kind: 'project' };
  if (opts.featuredOnly) q.featured = true;
  /** 태그는 대소문자가 섞여 있다 (NEXT.JS · typescript · React-Native) */
  if (opts.tech) q.techStack = { $regex: `^${escapeRegex(opts.tech)}$`, $options: 'i' };
  if (opts.company) q.company = { $regex: escapeRegex(opts.company), $options: 'i' };

  const docs = await Portfolio.find(q)
    .select(LIST_FIELDS)
    .sort({ order: 1 })
    .limit(opts.limit ?? 100)
    .lean<(PortfolioDoc & { featured?: boolean })[]>();
  return docs.map((d) => toSummary(merge(d)));
}

export async function getProject(slug: string) {
  await connectDb();
  return merge(await Portfolio.findOne({ ...PUBLIC, kind: 'project', slug }).lean<WithOverrides>());
}

export async function getByKind(kind: PortfolioKind, limit = 200) {
  await connectDb();
  const docs = await Portfolio.find({ ...PUBLIC, kind })
    .sort({ order: 1 })
    .limit(limit)
    .lean<WithOverrides[]>();
  return docs.map(merge);
}

export async function getProfile() {
  await connectDb();
  return merge(await Portfolio.findOne({ ...PUBLIC, kind: 'profile' }).lean<WithOverrides>());
}

/** 스킬을 분류별로 묶는다. 노션에서 온 것만 숙련도가 있다 */
export async function getSkillGroups() {
  const skills = await getByKind('skill');
  const groups = new Map<string, { name: string; level: number | null }[]>();
  for (const s of skills) {
    const key = s.category ?? '기타';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ name: s.title, level: s.level ?? null });
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

/**
 * 태그별 프로젝트 수. `/projects` 의 필터 옵션이 된다.
 * 태그 32종이 그대로 패싯이 되므로 목록을 손으로 관리하지 않는다.
 */
export async function getTechFacets(): Promise<{ tech: string; count: number }[]> {
  await connectDb();
  const rows = await Portfolio.aggregate<{ _id: string; count: number }>([
    { $match: { ...PUBLIC, kind: 'project' } },
    { $unwind: '$techStack' },
    { $group: { _id: '$techStack', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  return rows.map((r) => ({ tech: r._id, count: r.count }));
}

/**
 * 연도별 대표 태그. 45건 전부에 기간과 태그가 있어서 만들 수 있다.
 * "2012~2022 ASP.NET 풀스택 → 2023 프론트엔드 전환 → 2026 AI·Next.js" 라는
 * 14년 서사가 문장 없이 보인다.
 */
export async function getStackTimeline(topN = 6) {
  const projects = await getByKind('project');
  const byYear = new Map<number, Map<string, number>>();
  for (const d of projects) {
    if (!d.period?.start) continue;
    const year = new Date(d.period.start).getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, new Map());
    const bucket = byYear.get(year)!;
    for (const t of d.techStack ?? []) bucket.set(t, (bucket.get(t) ?? 0) + 1);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, counts]) => ({
      year,
      projectCount: projects.filter(
        (d) => d.period?.start && new Date(d.period.start).getUTCFullYear() === year,
      ).length,
      top: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, topN)
        .map(([tech]) => tech),
    }));
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
