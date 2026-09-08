import type { Metadata } from 'next';
import Link from 'next/link';
import { DocShell, DocSection } from '@/components/doc-shell';
import { SUGGESTIONS_BY_CATEGORY } from '@/lib/suggestions';
import { getProjectList, getByKind, getSkillGroups } from '@/lib/portfolio';

export const metadata: Metadata = {
  title: 'FAQ — 장민',
  description: '자주 묻는 것들. AI에게 물어보거나, 같은 내용을 문서로 바로 볼 수 있습니다.',
};

export const revalidate = 3600;

/**
 * FAQ.
 *
 * 질문 문장은 `lib/suggestions.ts` 가 원본이고, 랜딩 버튼·헬퍼 드로어와 **같은
 * 목록**이다. Phase 5 에서 이 `key` 로 답변을 미리 구워 캐시하면, 여기서 누른
 * 질문은 OpenAI 호출 없이 즉시 답한다.
 *
 * 상단에 문서 경로를 함께 둔 이유 — 채팅 답변은 훑을 수도, Ctrl-F 할 수도,
 * 검색엔진이 색인할 수도 없다. 그리고 일일 예산 캡에 걸렸을 때 "죄송합니다"로
 * 끝내지 않고 보낼 곳이 있어야 한다.
 */
export default async function FaqPage() {
  const [projects, experiences, skillGroups] = await Promise.all([
    getProjectList({}),
    getByKind('experience'),
    getSkillGroups(),
  ]);
  const skillCount = skillGroups.reduce((a, g) => a + g.items.length, 0);

  return (
    <DocShell
      title="FAQ"
      lead="AI에게 물어보시거나, 같은 내용을 문서로 바로 보실 수 있습니다."
    >
      {/* ── 요청하신 "문서처럼 보는 페이지" 진입점 ────────── */}
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          { href: '/resume', label: '이력서 문서', desc: `경력 ${experiences.length}곳 · 대표 프로젝트` },
          { href: '/projects', label: '프로젝트 목록', desc: `${projects.length}건 · 태그로 좁히기` },
          { href: '/', label: 'AI에게 묻기', desc: '대화로 찾아보기' },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="hover:bg-accent/50 rounded-2xl border p-4 transition-colors"
          >
            <div className="font-semibold">{c.label}</div>
            <div className="text-muted-foreground mt-0.5 text-xs">{c.desc}</div>
          </Link>
        ))}
      </div>

      {SUGGESTIONS_BY_CATEGORY.map((cat, i) => (
        <DocSection key={cat.category} no={String(i + 1).padStart(2, '0')} title={cat.label}>
          <ul className="space-y-2">
            {cat.items.map((s) => (
              <li key={s.key}>
                {/*
                 * 질문을 누르면 랜딩의 챗으로 넘긴다. 지금은 텍스트를 쿼리로
                 * 보내고, Phase 5 에서 `?q=<key>` 로 바꿔 캐시를 맞힌다 —
                 * 자유 입력이 아니라 고정 key 로 조회해야 캐시가 맞는다.
                 */}
                <Link
                  href={`/?query=${encodeURIComponent(s.question)}`}
                  className="hover:bg-accent/50 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm transition-colors"
                >
                  <span>{s.question}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">묻기 →</span>
                </Link>
              </li>
            ))}
          </ul>
        </DocSection>
      ))}

      <DocSection no="06" title="한 줄 요약">
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>경력 {experiences.length}곳 · 프로젝트 {projects.length}건 · 기술 {skillCount}개를 기록해 두었습니다.</li>
          <li>급여·개인 연락처·재직 중 회사의 내부 정보는 답하지 않습니다.</li>
          <li>이력서에 없는 내용은 지어내지 않고 &quot;기록에 없다&quot;고 답합니다.</li>
        </ul>
      </DocSection>
    </DocShell>
  );
}
