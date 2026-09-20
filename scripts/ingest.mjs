/**
 * tmp-ingest/ 스냅샷 → jangmini.portfolio
 *
 *   pnpm ingest            정규화 결과만 보여준다 (dry-run, 기본)
 *   pnpm ingest -- --write 실제로 적재한다
 *   pnpm ingest -- --show=project   특정 kind 의 첫 문서를 전문으로 본다
 *
 * **재수집 멱등성** — (source.type, source.id) 로 upsert 한다. 몇 번 돌려도
 * 중복이 생기지 않는다. slug 는 사람이 고칠 수 있으므로 이미 있는 문서의
 * slug 는 덮지 않는다(--reslug 를 주면 덮는다).
 *
 * 원본이 둘이고 역할이 다르다 —
 *   Notion : 프로젝트 본문·스킬 숙련도 (구조가 일정하고 최신이다)
 *   이력서 : 학력·자격증·대외활동·병역·자기소개 (Notion 에 없다)
 * → my-obsidian-vault / 10-Projects/jangmini.md
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { slugify, uniqueSlug } from './lib/romanize.mjs';
import {
  extractImages,
  extractLinks,
  cleanMarkdown,
  splitSections,
  bulletsUnder,
  firstParagraph,
  pickSummary,
  cleanInline,
} from './lib/notion-md.mjs';

const DB_NAME = 'jangmini';
const IN = 'tmp-ingest';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const RESLUG = argv.includes('--reslug');
const SHOW = (argv.find((a) => a.startsWith('--show=')) ?? '').split('=')[1] ?? '';

/** 회사 재직 구간. 프로젝트의 기간으로 소속을 추정한다 */
const COMPANIES = [
  { name: '엑스오비스', from: '2011-11-01', to: '2012-04-30' },
  { name: '큐텐테크놀로지', from: '2012-05-01', to: '2024-10-31' },
  { name: '설로인', from: '2024-11-01', to: '2025-06-30' },
  { name: '트랙스로지스', from: '2025-09-01', to: null },
];

/**
 * 개인 프로젝트. 기간이 재직 기간과 겹치므로 날짜로는 가려낼 수 없다 —
 * 제목으로 판별한다.
 */
const SIDE_PROJECT_KEYS = ['Ignite Architecture', 'SnapApps', '함히보까', '우리아이 칭찬앱'];

/**
 * 대표 프로젝트. `/resume` 에 이것만 싣는다.
 *
 * **기여도로는 고를 수 없다.** 「기여도 ≥ 0.9 또는 2024년 이후」로 뽑으면 28건이
 * 나오고 2011~2012 박물관 프로젝트가 전부 1.0 으로 들어온다 — 1인 작업이라
 * 당연히 1.0 이다. 기여도는 "혼자 했는가"를 재는 값이고 "대표작인가"를 재지
 * 않는다. 그래서 사람이 고른 목록을 둔다 (2026-09-08 사용자 선정).
 *
 * 선정 기준 — 전환기 이후의 작업 + 지금 시장에서 강점이 되는 것.
 *
 * 지금은 이 목록이 원본이다. Admin 에서 토글하게 되면 그때 DB 로 원본을
 * 옮긴다 (그전까지 재수집이 DB 값을 덮으므로 두 곳에 두지 않는다).
 */
/**
 * 대표 프로젝트와 고정 슬러그.
 *
 * ⚠️ **제목이 아니라 Notion 페이지 id 로 건다.**
 *
 * 예전에는 제목 부분일치였다. 그러면 Notion 에서 제목을 다듬는 순간
 * 슬러그(= 공개 URL)와 대표 여부가 **함께 바뀐다.** 밖으로 나간 링크가
 * 깨지고, 대표 목록에서 조용히 빠진다. 페이지 id 는 제목을 바꿔도 그대로다.
 *
 * 그래서 이력서 문장을 고치려고 제목을 손봐도 안전하다. 새 프로젝트를
 * 대표로 올리려면 여기에 id 한 줄을 더한다 — id 는 admin 콘텐츠 탭이나
 * Notion 페이지 URL 끝에서 볼 수 있다.
 */
/**
 * Notion `구분` → 사이트의 계층.
 *
 * 2026-09 재구성에서 46건을 셋으로 나눴다. 46건이 한 줄씩 깔려 있으면 무엇을
 * 봐야 하는지가 화면에 없다 — 세는 목록이 아니라 고르는 목록이어야 한다.
 *
 *   대표   합본 4건. 크게 조판한다
 *   개인   사이드 3건. 따로 묶는다
 *   연표   한 줄씩. 12년치 작업 단위다
 *   합쳐짐 대표 안으로 들어간 원본. **목록에서 빼되 지우지 않는다** —
 *          밖으로 나간 링크가 있고, 원본 기록 자체는 남겨야 한다.
 *          `/projects/<slug>` 로는 계속 열린다.
 *
 * 구분이 비어 있으면 연표로 둔다. 새 글을 썼을 때 조용히 사라지는 것보다
 * 목록 맨 아래에 나타나는 편이 알아차리기 쉽다.
 */
const TIERS = { 대표: 'flagship', 개인: 'personal', 연표: 'timeline', 합쳐짐: 'merged' };
const tierOf = (row) => TIERS[row.properties?.['구분']?.select?.name] ?? 'timeline';

/**
 * 어느 원본이 어느 대표 안으로 들어갔는가.
 *
 * `구분 = 합쳐짐` 은 "목록에서 뺀다" 까지만 말해 준다. 어디로 들어갔는지는
 * Notion 에 적혀 있지 않아서 여기에 둔다 — 그래야 대표 페이지에서 원본으로
 * 내려갈 수 있고, **원본의 화면 이미지를 대표가 물려받을 수 있다.**
 * (합본 페이지에는 이미지가 없다. 본문만 새로 썼다.)
 *
 * Notion 페이지 id 로 건다. 제목으로 걸면 제목을 다듬는 순간 끊긴다 —
 * 실제로 제목 4건에 U+00A0 이 섞여 있어서 한 번 조용히 어긋났다.
 */
const ABSORBS = {
  'legacy-modernization': [
    'd13dca69-72b8-8278-bb01-8117934855ea', // ASP.NET FE & BE 분리
    '1aedca69-72b8-8352-9f2e-81bd7b046209', // Common Script 빌드 개선
    'd99dca69-72b8-8244-9591-81b2eba37ad0', // MultiRepo > MonoRepo
    '97adca69-72b8-8306-b6d0-817078e6e550', // Vanila Js React 전환
    'bdbdca69-72b8-83a4-a859-81c039010129', // NEXT.JS 리펙토링
  ],
  'logistics-wms-oms': [
    '065dca69-72b8-82c6-8914-81529dfaea38', // WMS UI
    '33fdca69-72b8-833f-8ad6-01dc78e2ff4a', // OMS 기업 주문·주소록
    '5efdca69-72b8-83aa-a93c-8145f29f4385', // 배포 프로세스 개선
    '4bfdca69-72b8-83a3-967b-81da4cef2e28', // 배포 접근성
    'f98dca69-72b8-82e4-9e76-01de19e83395', // FE 로컬 도메인 분리
  ],
  'ai-agent-admin': [
    '00cdca69-72b8-820d-b630-81fc0aa002dc', // TracX AI Agent
    '1b9dca69-72b8-8344-8c92-01c38dc7f85b', // 배송비 Admin UX
    'c74dca69-72b8-826c-8862-01f6e9c9f7f6', // 배송비 Next.js 리펙토링
  ],
  'commerce-platform-modules': [
    '946dca69-72b8-8352-97b1-81839336d458', // 공통 공유 레이어
    '62fdca69-72b8-83f6-8e51-0149e43ccc36', // Item Picker
    'b01dca69-72b8-83cc-91e0-01fd9e0412fa', // Admin Grid
    'b86dca69-72b8-8231-9707-81146f201a75', // Dynamic Proxy API
    'bd9dca69-72b8-8325-8577-810fa7c83a67', // Profiler
    '25adca69-72b8-82a3-a1e5-01c8fe6da76a', // 게시판
    '6f1dca69-72b8-83d6-b78e-814216b32269', // 룰렛
    '0dadca69-72b8-8355-8b91-81c4bd33973e', // 설문조사
    '299dca69-72b8-823f-a8d4-01cbf1c02756', // 판매자 커스텀 페이지
  ],
};

/** Notion 페이지 id → 그것을 흡수한 대표의 슬러그 */
const ABSORBED_BY = Object.fromEntries(
  Object.entries(ABSORBS).flatMap(([slug, ids]) => ids.map((id) => [id, slug])),
);

const PINNED = [
  /**
   * 대표 4건(합본). **슬러그를 반드시 고정한다** — 제목이 길고 한글이라
   * 자동 변환하면 `regeosi-hyeondaehwa-asp-net-eseo-react` 같은 URL 이 된다.
   * 읽을 수 없고, 제목을 다듬으면 또 바뀐다.
   *
   * `featured` 는 여기서 정하지 않는다. Notion 의 `구분` 이 원본이다.
   */
  { id: '3dcdca69-72b8-811b-9ac5-ebda68d3e7f2', slug: 'legacy-modernization' },
  { id: '3dcdca69-72b8-8107-9d51-ffb41e026f02', slug: 'logistics-wms-oms' },
  { id: '3dcdca69-72b8-8116-84c9-d9f1208ab00b', slug: 'ai-agent-admin' },
  { id: '3dcdca69-72b8-8119-ba9d-cb1e05c6f601', slug: 'commerce-platform-modules' },

  { id: '9dedca69-72b8-8216-8820-81ad99c6c6d1', slug: 'ignite-architecture', featured: true, why: '사이드 · 건축사무소 브랜딩. 기획~납품 전 과정' },
  { id: '00cdca69-72b8-820d-b630-81fc0aa002dc', slug: 'tracx-ai-agent', featured: true, why: '트랙스로지스 AI · RAG + Tool Calling' },
  { id: '28bdca69-72b8-82c5-a2d4-81335bdf946f', slug: 'snapapps', featured: true, why: '사이드 · SnapWord/SnapNote 시리즈' },
  { id: '065dca69-72b8-82c6-8914-81529dfaea38', slug: 'wms-pda-scanner', featured: true, why: 'React Native PDA 스캐너 · 현장 검증' },
  { id: '33fdca69-72b8-833f-8ad6-01dc78e2ff4a', slug: 'sirloin-oms', featured: true, why: '설로인 OMS · 불필요 조회 제거와 진행 표시' },
  { id: 'd13dca69-72b8-8278-bb01-8117934855ea', slug: 'aspnet-fe-be-split', featured: true, why: '.NET → React 전환' },
  /**
   * AI 작업으로 소개하지 않는다. 이력서 기술스택에 OpenAI 가 적혀 있지만
   * 노션 본문의 실제 작업은 레거시 구조 정리·용어 통일·팀 자동배정이다
   * (2026-09-08 사용자 확인).
   */
  { id: 'd95dca69-72b8-8210-a135-81f8b679d19a', slug: 'inquiry-ticket-admin', featured: true, why: '트랙스로지스 · 고객응대(Ticket) 서비스 개발' },

  /* 슬러그만 고정한다 — 대표는 아니다 */
  { id: '98bdca69-72b8-83b9-bf0b-812d718ab636', slug: 'hamhibokka', featured: false },
  { id: '1b9dca69-72b8-8344-8c92-01c38dc7f85b', slug: 'shipping-fee-admin-ux', featured: false },
  { id: 'c74dca69-72b8-826c-8862-01f6e9c9f7f6', slug: 'shipping-fee-nextjs', featured: false },
];

const pinnedOf = (pageId) => PINNED.find((p) => p.id === pageId) ?? null;

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(path.join(process.cwd(), file), 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
      }
    } catch {
      /* 없으면 넘어간다 */
    }
  }
}
loadEnv();

function read(name) {
  const p = path.join(IN, name);
  if (!existsSync(p)) {
    console.error(`✗ ${p} 이 없습니다. 먼저 수집해 주세요:\n    pnpm fetch:notion\n    pnpm fetch:resume`);
    process.exit(1);
  }
  return p.endsWith('.json') ? JSON.parse(readFileSync(p, 'utf8')) : readFileSync(p, 'utf8');
}

const titleOf = (page) => {
  for (const v of Object.values(page.properties ?? {})) {
    if (v?.type === 'title') return (v.title ?? []).map((t) => t.plain_text).join('');
  }
  return '';
};

const inRange = (dateStr, from, to) => {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (d < from) return false;
  if (to && d > to) return false;
  return true;
};

function inferCompany(title, start) {
  if (SIDE_PROJECT_KEYS.some((k) => title.includes(k))) return '개인 프로젝트';
  const hit = COMPANIES.find((c) => inRange(start, c.from, c.to));
  return hit?.name ?? null;
}

const docs = [];
const usedSlugs = new Set();
const warnings = [];

function push(doc) {
  docs.push(doc);
}

/* ══════════════ 1. 프로젝트 ══════════════════════════════════ */

/**
 * 채움 자리를 걷어낸다.
 *
 * 줄 전체가 채움 자리인 불릿은 줄째로 지운다 — 빈 불릿(`-`)이 남으면 그게 더
 * 이상하다. 문장 중간에 끼어 있으면 그 조각만 뺀다.
 */
/**
 * 채움 자리가 든 줄을 걷어낸다.
 *
 * **조각만 빼지 않고 줄째로 뺀다.** 문장 한가운데 있는 것을 지우면
 * "관리 포인트를  로 줄였습니다" 같은 깨진 문장이 남는다. 채움 자리가
 * 있다는 것은 그 줄이 아직 끝나지 않았다는 뜻이므로, 내보내지 않는 것이 맞다.
 *
 * Notion 은 대괄호를 `\\[` 로 이스케이프해 내려준다 — 그래서 앞뒤의
 * 역슬래시까지 함께 집는다. 안 그러면 줄에 `\\` 하나가 남는다.
 */
const PLACEHOLDER = /\\?\[(?:숫자|한계|이유|결정)[^\]]*\\?\]/;
function stripPlaceholders(md) {
  return md
    .split('\n')
    .filter((line) => !PLACEHOLDER.test(line))
    .join('\n');
}

const rows = read('rows-history.json');
const bodies = read('bodies.json');
const bodyById = Object.fromEntries(bodies.map((b) => [b.id, b]));

/**
 * Notion 템플릿을 그대로 둔 문서를 제외한다. 두 건 있다 —
 * "우리아이 칭찬앱 개발" 과 제목 없는 행. 본문이 전부 안내 문구다.
 */
const isTemplate = (md) => /기술해 주세요/.test(md);

const projectRows = rows
  .map((r) => ({ row: r, body: bodyById[r.id] }))
  .filter(({ row, body }) => {
    const t = titleOf(row);
    if (!t) {
      warnings.push(`제목이 없어 제외: ${row.id}`);
      return false;
    }
    if (!body || isTemplate(body.markdown)) {
      warnings.push(`템플릿 미작성으로 제외: ${t}`);
      return false;
    }
    return true;
  })
  /** 최신순 */
  .sort((a, b) => {
    const sa = a.row.properties['기간']?.date?.start ?? '';
    const sb = b.row.properties['기간']?.date?.start ?? '';
    return sb.localeCompare(sa);
  });

projectRows.forEach(({ row, body }, i) => {
  const title = titleOf(row).trim();
  const props = row.properties;
  const tier = tierOf(row);
  const date = props['기간']?.date ?? {};

  const { body: noImages, images } = extractImages(body.markdown);
  /**
   * `[숫자: …]` 같은 채움 자리를 사이트에 내보내지 않는다.
   *
   * Notion 에서는 이게 **필요한 표시다** — 지어낸 숫자를 넣는 대신 사람이
   * 채우라고 남겨 둔 자리다. 그런데 그대로 공개되면 "아직 안 쓴 이력서" 로
   * 읽힌다. 그래서 원본은 그대로 두고 **내보낼 때만** 걷어낸다.
   * 무엇이 남았는지는 아래 경고로 알려 준다.
   */
  const placeholders = noImages.split(/\r?\n/).filter((l) => PLACEHOLDER.test(l));
  const cleaned = cleanMarkdown(stripPlaceholders(noImages));
  const links = extractLinks(noImages);
  const sections = splitSections(cleaned);

  /**
   * 양식이 둘이다. 합본 4건은 새 양식(개요/문제/나의 역할과 결정/결과/회고),
   * 나머지는 옛 양식(개요/나의 역할/성과 및 결과/회고)을 쓴다. 옛 문서를
   * 전부 새 양식으로 옮길 이유가 없어서 **둘 다 읽는다.**
   */
  const overview = sections['개요'] ?? '';
  const roleSec = sections['나의 역할과 결정'] ?? sections['나의 역할'] ?? '';
  const resultSec = sections['결과'] ?? sections['성과 및 결과'] ?? '';
  const problem = sections['문제'] ?? '';
  const retro = sections['회고'] ?? '';

  const role = bulletsUnder(roleSec, '직위 및 역할')[0] ?? null;
  const teamSize = bulletsUnder(roleSec, '팀 구성')[0] ?? null;

  /**
   * 45/47 은 `### -결과 요약` 아래에 불릿이 있는데 두 건은 `## 성과 및 결과`
   * 바로 아래에 쓰여 있다 (Shopping SNS · 담당 페이지 유지보수).
   * 소제목이 없으면 섹션 전체의 불릿을 쓴다 — 성과를 비워 두지 않기 위해서다.
   */
  let highlights = bulletsUnder(resultSec, '결과 요약');
  if (!highlights.length && resultSec) {
    highlights = resultSec
      .split('\n')
      .map((l) => /^\s*[-*]\s+(.+)$/.exec(l)?.[1])
      .filter(Boolean)
      .map((s) => s.replace(/\*\*/g, '').trim());
  }

  /**
   * 개요가 없는 한 건(창원/담금질과 매질)은 도입부를, 개요를 불릿으로 쓴
   * 7건은 그 불릿을 요약으로 쓴다 → pickSummary
   */
  const summary = pickSummary(overview, sections['__intro__']) || null;

  if (placeholders.length) {
    warnings.push(`채움 자리 ${placeholders.length}곳을 사이트에서 감췄습니다 (Notion 에서 채우세요): ${title}`);
  }
  if (!overview) warnings.push(`개요 섹션 없음(도입부로 대체): ${title}`);
  if (!highlights.length) warnings.push(`성과 불릿 없음: ${title}`);
  if (tier === 'flagship' && !problem) warnings.push(`대표인데 문제 절이 없음: ${title}`);

  push({
    kind: 'project',
    slug: uniqueSlug(pinnedOf(row.id)?.slug ?? slugify(title), usedSlugs, `project-${i + 1}`),
    title,
    summary,
    body: cleaned,
    company: inferCompany(title, date.start),
    role,
    teamSize,
    contribution: props['기여도']?.number ?? null,
    period: {
      start: date.start ? new Date(date.start) : null,
      end: date.end ? new Date(date.end) : null,
      label: [date.start?.slice(0, 7), date.end?.slice(0, 7)].filter(Boolean).join(' ~ '),
    },
    techStack: (props['기술스택']?.multi_select ?? []).map((o) => o.name),
    highlights,
    links,
    /** 이미지는 R2 재호스팅 단계에서 채운다. 만료 URL 을 저장하지 않는다 */
    images: [],
    order: i,
    tier,
    /** 합쳐짐이면 어느 대표로 들어갔는지. 대표 페이지가 이걸로 원본을 모은다 */
    mergedInto: ABSORBED_BY[row.id] ?? null,
    /**
     * 대표 여부의 원본은 이제 Notion 의 `구분` 이다. 예전에는 PINNED 목록이
     * 원본이었는데, 그러면 Notion 에서 대표를 바꿔도 코드를 고쳐야 했다.
     * PINNED 는 슬러그 고정 용도로만 남는다.
     */
    featured: tier === 'flagship',
    visibility: 'public',
    source: {
      type: 'notion',
      id: row.id,
      lastEditedAt: row.last_edited_time ? new Date(row.last_edited_time) : null,
      imageCount: images.length,
      notionUrl: row.url ?? null,
      publicUrl: row.public_url ?? null,
      retro: retro ? true : false,
    },
  });
});

/* ══════════════ 2. 스킬 (Notion ∪ 이력서) ═══════════════════ */

const resourceRows = read('rows-resource.json');
const resume = read('resume.txt');

/** 노션 스킬 — 숙련도가 있다 */
const notionSkills = new Map();
for (const r of resourceRows) {
  const name = titleOf(r).trim();
  if (!name) {
    warnings.push(`스킬 제목 없어 제외: ${r.id}`);
    continue;
  }
  notionSkills.set(name.toLowerCase(), {
    name,
    category: r.properties['분류']?.select?.name ?? null,
    level: r.properties['80%']?.number ?? null,
    id: r.id,
    lastEditedAt: r.last_edited_time,
  });
}

/**
 * 이력서 스킬셋 표. 노션 리소스 DB 가 이력서보다 오래돼서, 합치지 않으면
 * 스킬이 실제보다 적게 보인다 (노션 18개 vs 이력서에 AWS·R2·Vite·GraphQL 등 추가).
 */
function resumeSkillGroups(text) {
  const groups = [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /스택 \/ Skill Set/.test(l));
  if (start < 0) {
    warnings.push('이력서에서 Skill Set 표를 찾지 못했습니다');
    return groups;
  }
  const LABELS = [
    'Programming Languages',
    'Framework / Library',
    'Cloud / Infrastructure',
    'Tooling / DevOps',
    'Environment',
    'DB',
    'Etc',
  ];
  for (let i = start; i < Math.min(start + 40, lines.length); i++) {
    const label = lines[i].trim();
    if (!LABELS.includes(label)) continue;
    const value = (lines[i + 1] ?? '').trim();
    if (!value) continue;
    groups.push({
      label,
      items: value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return groups;
}

const groups = resumeSkillGroups(resume);
const resumeOnly = [];
for (const g of groups) {
  for (const item of g.items) {
    if (notionSkills.has(item.toLowerCase())) continue;
    resumeOnly.push({ name: item, category: g.label });
  }
}

let skillOrder = 0;
for (const s of notionSkills.values()) {
  push({
    kind: 'skill',
    slug: uniqueSlug(`skill-${slugify(s.name)}`, usedSlugs, `skill-${skillOrder + 1}`),
    title: s.name,
    summary: null,
    category: s.category,
    level: s.level,
    techStack: [],
    highlights: [],
    links: [],
    images: [],
    order: skillOrder++,
    visibility: 'public',
    source: { type: 'notion', id: s.id, lastEditedAt: s.lastEditedAt ? new Date(s.lastEditedAt) : null },
  });
}
for (const s of resumeOnly) {
  push({
    kind: 'skill',
    slug: uniqueSlug(`skill-${slugify(s.name)}`, usedSlugs, `skill-${skillOrder + 1}`),
    title: s.name,
    summary: null,
    category: s.category,
    /** 이력서에는 숙련도가 없다. 없는 것을 지어내지 않는다 */
    level: null,
    techStack: [],
    highlights: [],
    links: [],
    images: [],
    order: skillOrder++,
    visibility: 'public',
    source: { type: 'docx', id: `skill:${s.name.toLowerCase()}` },
  });
}

/* ══════════════ 3. 프로필 · 경력 (Notion 루트) ═══════════════ */

const root = read('root.json');
/**
 * 원본은 Notion 의 이력서 한 장('신규')이다. 조판용 표시가 섞여 오므로 걷어낸다.
 *
 *   <callout>    "채울 곳이 남아 있습니다" — 나에게 남긴 메모다. 공개면 안 된다
 *   <columns>    좌우 2단. 웹에서는 한 줄로 흐르면 된다
 *   휴대폰 번호   ⚠️ **절대 내보내지 않는다.** Notion 문서에는 적혀 있다 —
 *                인사담당자에게 직접 건네는 PDF 니까. 공개 사이트는 다르다.
 *                연락은 이메일로 받고, 번호가 필요하면 그때 주면 된다.
 */
const stripNotionChrome = (md) =>
  md
    .replace(/\<callout[^\>]*\>[\s\S]*?\<\/callout\>/g, '')
    /**
     * 사진이 든 칼럼은 통째로 버린다.
     *
     * 좌우 2단 중 오른쪽은 사진·이름·한 줄 소개·연락처를 모아 둔 **명함**이다.
     * PDF 로 뽑을 때는 필요하지만 사이트에는 이미 머리말과 링크로 있다.
     * 이미지 표시가 살아 있는 지금 걸러야 한다 — extractImages 가 지우고 나면
     * 어느 칼럼이 명함이었는지 알 수 없다.
     */
    .replace(/\<column\>(?:(?!\<\/column\>)[\s\S])*!\[(?:(?!\<\/column\>)[\s\S])*\<\/column\>/g, '')
    .replace(/\<\/?(?:columns|column)\>/g, '')
    .replace(/0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/g, '')
    .replace(/^\s*>\s*\*\*장민\*\*[^\n]*$/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, '');

const rootMd = cleanMarkdown(extractImages(stripNotionChrome(root.markdown)).body);

/**
 * 프로필 본문 — 루트 페이지에서 `## 경력` 앞까지다.
 *
 * ⚠️ 처음에 `rootMd.split(/^##\s/m)[0]` 로 잘랐더니 **빈 문자열**이 나왔다.
 * 다단 들여쓰기를 없앤 뒤로 루트 페이지가 `## 반갑습니다!` 로 시작하게 되어,
 * 첫 조각이 헤딩 앞의 빈 부분이 됐다. `/resume` 의 "01 소개" 가 통째로 비었고
 * 오류는 나지 않았다.
 *
 * 그래서 **경력 헤딩을 기준으로** 자른다. 소개 문장은 이력서 docx 쪽이 더
 * 온전하므로 아래에서 그걸 앞에 붙인다.
 */
/**
 * 병역 한 줄.
 *
 * Notion 에서는 '학력 · 자격 · 병역' 묶음 안에 있는데, 사이트는 학력과
 * 자격을 이력서 docx 에서 따로 읽는다. 병역만 갈 곳이 없어서 소개 본문 끝에
 * `### 병역` 으로 붙여 둔다 — `/resume` 의 05 절이 거기서 꺼내 쓴다.
 * 기본 사항이라 빼지 않는다 (2026-09-15 사용자 확인).
 */
const militaryLine =
  rootMd.split(/\r?\n/).find((l) => /^\s*[-*]\s+.*(?:제대|병역|복무|면제)/.test(l)) ?? '';
const militarySection = militaryLine ? `### 병역\n${militaryLine.trim()}` : '';

const rootIntro = rootMd
  .split(/^##\s*경력/m)[0]
  /** `## 소개` 는 줄째로 없앤다 — 접두사만 지우면 '소개' 한 낱말이 본문에 남는다 */
  .replace(/^##\s*[^\n]*$/gm, '')
  /** Notion 이 줄바꿈을 `<br>` 로 준다 */
  .replace(/<br\s*\/?>/gi, ' ')
  /**
   * 다단 안의 내용이 탭으로 들여써서 온다. 헤딩만 앞서 처리했으므로 여기서
   * 본문 줄의 들여쓰기를 없앤다 — 안 하면 `\t\tBirth : 1986.05.04` 가
   * 그대로 저장돼 화면에 탭이 보인다.
   */
  .split('\n')
  .map((l) => l.replace(/^[\t ]+/, ''))
  /**
   * 링크만 있는 줄은 버린다 — Notion 의 SNS 콜아웃(Instagram · Blog · Github)
   * 이고, 같은 값이 이미 `links` 에 구조화돼 들어간다. 소개문에 두면
   * "> [Github](…)" 가 문단으로 읽힌다.
   */
  .filter((l) => !/^>?\s*\[[^\]]*\]\([^)]*\)\s*$/.test(l))
  /** 위에서 링크를 지우고 남은 빈 인용 껍데기(`>` 한 글자) */
  .filter((l) => l.trim() !== '>')
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * 이력서의 "소개 / About Me" 문단 — Notion 루트에는 이만큼 긴 소개가 없다.
 *
 * ⚠️ 처음에 5줄을 잘랐더니 바로 뒤의 Skill Set 표까지 먹어서
 * "기술48895257810스택 / Skill Set / 구분 / Skill" 이 소개문에 붙었다.
 * 소개는 **한 문단짜리 한 줄**이므로 첫 비어 있지 않은 줄만 쓴다.
 */
const aboutFromResume = (() => {
  const lines = read('resume.txt').split(/\r?\n/);
  const i = lines.findIndex((l) => /About Me/.test(l));
  if (i < 0) {
    warnings.push('이력서에서 About Me 를 찾지 못했습니다');
    return '';
  }
  const first = lines.slice(i + 1, i + 4).find((l) => l.trim().length > 80);
  if (!first) warnings.push('About Me 다음의 소개 문단을 찾지 못했습니다');
  return (first ?? '').trim();
})();

/** 이력서 첫 줄의 `Contact : … / …` 에서 이메일을 뽑는다 */
const contactFromResume = (() => {
  const text = read('resume.txt');
  const m = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(text);
  if (!m) {
    warnings.push('이력서에서 이메일을 찾지 못했습니다');
    return [];
  }
  return [{ label: `Email · ${m[1]}`, url: `mailto:${m[1]}` }];
})();

/**
 * 소개의 본문·소셜 링크를 손으로 덮어쓴다 — `content/profile-manual.json`.
 *
 * Notion 루트 문서는 **페이지 머리말**로 쓰인 글이라 포트폴리오의 소개
 * 자리에는 맞지 않는다("반갑습니다! …" 와 인용 나열). 인스타그램도 계정이
 * 세 개로 갈라져서 루트에서 뽑은 링크 하나로는 맞출 수 없다.
 *
 * 파일이 없으면 예전대로 Notion 에서 만든 것을 쓴다 — 없어도 깨지지 않는다.
 */
const profileManual = (() => {
  try {
    return JSON.parse(readFileSync('content/profile-manual.json', 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      warnings.push(`content/profile-manual.json 을 읽지 못했습니다: ${err.message}`);
    }
    return {};
  }
})();

push({
  kind: 'profile',
  slug: uniqueSlug('profile', usedSlugs),
  title: '장민',
  summary: 'Full Stack Developer',
  /**
   * 소개의 원본은 **Notion '신규' 페이지 하나**다.
   *
   * 예전에는 이력서 docx 의 자기소개를 앞에 붙였다. 그 글이 "저는 10년간
   * ASP.NET…" 으로 시작해서 2026년에 읽으면 낡아 보였고, Notion 을 다시 쓴
   * 뒤로는 같은 이야기가 두 번 나왔다. 이제 Notion 쪽만 쓴다.
   * (`content/profile-manual.json` 의 body 도 같은 이유로 걷어냈다 —
   * 두 곳에 두면 Notion 을 고쳐도 사이트가 안 바뀐다.)
   */
  body: profileManual.body ?? [rootIntro, militarySection].filter(Boolean).join('\n\n'),
  techStack: [],
  highlights: [],
  /**
   * 프로필 링크는 **본인 것만** 둔다. 루트 페이지의 링크를 전부 담으면
   * MBTI 검사 사이트(16personalities)와 전 직장 사이트(qoo10 · xorbis,
   * 회사 로고 이미지의 캡션에서 온 것)까지 "장민의 링크" 로 나온다.
   */
  links: [
    /**
     * 이메일을 **맨 앞에** 둔다. 채용 담당자가 실제로 쓰는 연락 수단이고,
     * 이게 없으면 챗봇이 "이력서에 기재된 이메일로 연락 주세요" 처럼
     * 정작 주소를 못 주는 답을 한다(실제로 그랬다).
     *
     * 휴대폰 번호는 넣지 않는다 — 2026-09-08 "모두 공개" 지시가 있었지만,
     * 공개 데이터로 두는 것과 **챗봇이 먼저 읊는 것**은 다르다. 번호가
     * 필요하면 이메일로 물어보는 흐름이 맞다. 프롬프트에도 같은 규칙이 있다.
     */
    ...contactFromResume,
    /*
      소셜 링크만 손등록으로 갈아낄 수 있다. **이메일은 갈아끼지 않는다** —
      이력서 첫 줄에서 뽑는 것이 한 곳에서만 관리되는 값이다.
    */
    ...(profileManual.socialLinks ??
      extractLinks(root.markdown).filter(
        (l) =>
          !/notion\.(so|com)/.test(l.url) &&
          !/16personalities|qoo10|xorbis|tmon/.test(l.url),
      )),
  ],
  images: [],
  order: 0,
  visibility: 'public',
  source: { type: 'notion', id: root.id },
});

/**
 * `### 회사명 / 기간` + 아래 불릿.
 *
 * ⚠️ `/` 뒤의 `**` 를 허용해야 한다. 원본이
 *   `### **트랙스로지스 테크팀  /** <span color="gray">2025.09 ~</span>`
 * 처럼 강조가 슬래시를 감싸고 닫혀서, `\/\s*[0-9]` 로는 하나도 안 걸렸다
 * (경력 0건이 됐고 오류는 나지 않았다).
 */
const companyPat = /^###\s+(.+?)\s*\/\**\s*([0-9]{4}[.\-][0-9]{2}[^\n]*)$/gm;
let expOrder = 0;
for (const m of rootMd.matchAll(companyPat)) {
  const name = m[1].replace(/\*/g, '').trim();
  const periodLabel = m[2].replace(/\*/g, '').trim();
  const after = rootMd.slice(m.index + m[0].length);
  const bullets = [];
  for (const line of after.split('\n')) {
    if (/^#{2,3}\s/.test(line)) break;
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (b) {
      bullets.push(cleanInline(b[1]));
      continue;
    }
    /**
     * 엑스오비스만 불릿이 아니라 `개발환경 : …` / `담당업무 : …` 평문이다.
     * 불릿만 모으면 그 회사의 담당 업무가 통째로 비었다(highlights=0).
     */
    const kv = /^\s*([^:\n]{2,12})\s*:\s*(.+)$/.exec(line);
    if (kv) bullets.push(`${kv[1].trim()}: ${cleanInline(kv[2])}`);
  }
  const company = COMPANIES.find((c) => name.includes(c.name.slice(0, 3)));
  push({
    kind: 'experience',
    slug: uniqueSlug(slugify(name), usedSlugs, `experience-${expOrder + 1}`),
    title: name,
    summary: periodLabel,
    body: bullets.map((b) => `- ${b}`).join('\n'),
    company: company?.name ?? name,
    period: {
      start: company ? new Date(company.from) : null,
      end: company?.to ? new Date(company.to) : null,
      label: periodLabel,
    },
    techStack: [],
    highlights: bullets,
    links: [],
    images: [],
    order: expOrder++,
    visibility: 'public',
    source: { type: 'notion', id: `${root.id}:exp:${name}` },
  });
}
if (expOrder === 0) warnings.push('루트 페이지에서 경력 블록을 찾지 못했습니다');

/* ══════════════ 3-b. 손으로 등록한 프로젝트 ═══════════════════
 *
 * Notion 에 없는 프로젝트를 `content/projects-manual.json` 에서 읽는다.
 * `source.type: 'manual'` 이므로 Notion 재수집이 이 항목을 건드리지 않는다
 * (upsert 키가 `(source.type, source.id)` 다).
 *
 * 본문은 Notion 45건과 같은 4단 구조(개요/나의 역할/성과 및 결과/회고)를
 * 지킨다 — 상세 화면이 그 구조를 전제로 조판한다.
 */
{
  let manual = { projects: [] };
  try {
    manual = JSON.parse(readFileSync('content/projects-manual.json', 'utf8'));
  } catch (err) {
    warnings.push(`content/projects-manual.json 을 읽지 못했습니다: ${err.message}`);
  }

  for (const [i, m] of (manual.projects ?? []).entries()) {
    if (!m.slug || !m.title) {
      warnings.push(`손등록 프로젝트에 slug/title 이 없습니다 (${i}번째)`);
      continue;
    }
    /**
     * ⚠️ order 를 Notion 프로젝트와 같은 축에 둔다. 최신순 정렬이므로
     * 기간이 겹치면 목록에서 뒤섞이는데, 그게 의도다 — 소속이 다를 뿐
     * 시간순으로는 같은 줄에 있다.
     */
    const start = m.period?.start ? new Date(m.period.start) : null;
    push({
      kind: 'project',
      slug: uniqueSlug(m.slug, usedSlugs, `manual-${i + 1}`),
      title: m.title,
      summary: m.summary ?? null,
      body: m.body ?? null,
      company: m.company ?? null,
      role: m.role ?? null,
      teamSize: m.teamSize ?? null,
      contribution: m.contribution ?? null,
      period: {
        start,
        end: m.period?.end ? new Date(m.period.end) : null,
        label: m.period?.label ?? null,
      },
      techStack: m.techStack ?? [],
      highlights: m.highlights ?? [],
      links: m.links ?? [],
      /** 이미 R2 에 올린 URL 이다 → pnpm shots:upload */
      images: m.images ?? [],
      /**
       * 손등록은 Notion 의 `구분` 이 없다. 여기 들어오는 것은 업무 밖에서
       * 만든 것뿐이라 개인으로 둔다 — 파일에서 덮을 수 있다.
       */
      tier: m.tier ?? 'personal',
      featured: Boolean(m.featured),
      /**
       * order 는 아래 정렬 단계에서 다시 매긴다. Notion 것과 섞어 최신순으로
       * 세워야 하므로 여기서 확정하지 않는다.
       */
      order: 0,
      visibility: 'public',
      source: { type: 'manual', id: `project:${m.slug}` },
    });
  }
  const n = (manual.projects ?? []).length;
  if (n) console.log(`손등록 프로젝트 ${n}건 (content/projects-manual.json)\n`);
}

/**
 * 프로젝트 `order` 를 **전체 최신순으로 다시 매긴다.**
 * Notion 것만 정렬해 두면 손등록 프로젝트가 목록 끝에 붙는다.
 */
{
  const projects = docs.filter((d) => d.kind === 'project');
  projects.sort((a, b) => {
    const sa = a.period?.start ? new Date(a.period.start).getTime() : 0;
    const sb = b.period?.start ? new Date(b.period.start).getTime() : 0;
    return sb - sa;
  });
  projects.forEach((d, i) => {
    d.order = i;
  });
}

/* ══════════════ 4. 이력서 — 학력·자격증·활동·병역·에세이 ═════ */

const rLines = resume.split(/\r?\n/).map((l) => l.trim());
const idxOf = (re) => rLines.findIndex((l) => re.test(l));

/** 학력 — "2005.03 ~ 2012 02전주대학교 정보시스템학과  졸업" */
{
  const s = idxOf(/^학력$/);
  let n = 0;
  if (s >= 0) {
    for (let i = s + 1; i < s + 8 && i < rLines.length; i++) {
      const l = rLines[i];
      if (!l || /^자격증$/.test(l)) break;
      const m = /^([0-9]{4}[.\-][0-9]{2})\s*~\s*([0-9]{4}[.\s\-][0-9]{2})\s*(.+)$/.exec(l);
      if (!m) continue;
      const name = m[3].replace(/\s+/g, ' ').trim();
      push({
        kind: 'education',
        slug: uniqueSlug(slugify(name), usedSlugs, `education-${n + 1}`),
        title: name,
        summary: `${m[1]} ~ ${m[2].replace(/\s/g, '.')}`,
        techStack: [],
        highlights: [],
        links: [],
        images: [],
        order: n++,
        visibility: 'public',
        source: { type: 'docx', id: `education:${name}` },
      });
    }
  }
  if (!n) warnings.push('학력을 파싱하지 못했습니다');
}

/** 자격증 — "코딩지도사 1급 (2021. 06 취득)" */
{
  const s = idxOf(/^자격증$/);
  let n = 0;
  if (s >= 0) {
    for (let i = s + 1; i < s + 10 && i < rLines.length; i++) {
      const l = rLines[i];
      if (!l || /^교육 및 대외활동$/.test(l)) break;
      const m = /^(.+?)\s*\(\s*([0-9]{4})\.\s*([0-9]{1,2})\s*취득\s*\)$/.exec(l);
      if (!m) continue;
      const name = m[1].trim();
      push({
        kind: 'certificate',
        slug: uniqueSlug(slugify(name), usedSlugs, `certificate-${n + 1}`),
        title: name,
        summary: `${m[2]}.${m[3].padStart(2, '0')} 취득`,
        period: { start: new Date(`${m[2]}-${m[3].padStart(2, '0')}-01`), end: null, label: `${m[2]}.${m[3].padStart(2, '0')}` },
        techStack: [],
        highlights: [],
        links: [],
        images: [],
        order: n++,
        visibility: 'public',
        source: { type: 'docx', id: `certificate:${name}` },
      });
    }
  }
  if (!n) warnings.push('자격증을 파싱하지 못했습니다');
}

/** 대외활동 — "2011.09 ~ 2011.12 어린이영어도서관 티칭코치 (봉사활동) / 전주대학교" + 다음 줄 설명 */
{
  const s = idxOf(/^교육 및 대외활동$/);
  const end = idxOf(/^병역$/);
  let n = 0;
  if (s >= 0) {
    const stop = end > s ? end : rLines.length;
    for (let i = s + 1; i < stop; i++) {
      const m = /^([0-9]{4}\.[0-9]{2})(?:\s*~\s*([0-9]{4}\.[0-9]{2}))?\s+(.+?)\s*(?:\(([^)]+)\))?\s*(?:\/\s*(.+))?$/.exec(
        rLines[i],
      );
      if (!m) continue;
      const name = m[3].trim();
      if (!name) continue;
      const desc = [];
      for (let j = i + 1; j < stop; j++) {
        if (/^[0-9]{4}\.[0-9]{2}/.test(rLines[j])) break;
        if (rLines[j]) desc.push(rLines[j]);
      }
      push({
        kind: 'activity',
        slug: uniqueSlug(slugify(name), usedSlugs, `activity-${n + 1}`),
        title: name,
        summary: [m[1], m[2]].filter(Boolean).join(' ~ '),
        body: desc.join('\n') || null,
        category: m[4]?.trim() ?? null,
        company: m[5]?.trim() ?? null,
        period: {
          start: new Date(m[1].replace('.', '-') + '-01'),
          end: m[2] ? new Date(m[2].replace('.', '-') + '-01') : null,
          label: [m[1], m[2]].filter(Boolean).join(' ~ '),
        },
        techStack: [],
        highlights: [],
        links: [],
        images: [],
        order: n++,
        visibility: 'public',
        source: { type: 'docx', id: `activity:${name}` },
      });
    }
  }
  if (!n) warnings.push('대외활동을 파싱하지 못했습니다');
}

/*
  ══════════════ 자기소개서는 만들지 않는다 ══════════════

  이력서 .docx 에 "자기 소개 / 가족 / 학창 시절 및 활동 / 지원 동기" 네 절이
  있고 예전에는 kind: 'essay' 로 담았다. 2026-09-15 에 걷어냈다.

  ① **어디에도 쓰이지 않았다.** 화면 넷 중 어느 것도 그리지 않고, 챗 tool
     여섯 개 중 어느 것도 읽지 않으며, 답변 사실 블록에도 없다. DB 에 들어와
     앉아만 있었다.
  ② **가족 항목은 배우자·딸 이야기다.** 직무와 무관한 개인정보이고, 공공기관·
     공기업·대기업은 아예 묻지 않는다. 공개 사이트에 둘 값이 아니다.
  ③ **학창 시절은 14년차 문서에 연차를 깎는다.** 초등 육상부·중학 농구가
     경력 옆에 놓이면 신입 자소서 양식으로 읽힌다.
  ④ **지원 동기는 회사마다 다시 써야** 힘이 있다. 일반론으로 박아 두면
     담당자가 읽지 않는다.

  운동·체력 관리처럼 살릴 값이 있는 한 줄은 소개문에 넣었다
  → content/profile-manual.json
*/

/* ══════════════ 리포트 ══════════════════════════════════════ */

const byKind = {};
for (const d of docs) (byKind[d.kind] ??= []).push(d);

console.log('─── 정규화 결과 ───');
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`  ${kind.padEnd(12)} ${String(list.length).padStart(3)}건`);
}
console.log(`  ${'합계'.padEnd(11)} ${String(docs.length).padStart(3)}건`);

const totalImages = docs.reduce((a, d) => a + (d.source?.imageCount ?? 0), 0);
console.log(`\n  이미지(R2 이관 대기) ${totalImages}장`);
console.log(`  외부 링크           ${docs.reduce((a, d) => a + d.links.length, 0)}개`);

/** 선택 필드의 채움률. 비어 있는 것을 지어내지 않으므로, 어디가 빈지 보여 준다 */
const P = byKind.project ?? [];
const pct = (n) => `${n}/${P.length}`;
console.log('\n  프로젝트 선택 필드 채움률');
console.log(`    summary     ${pct(P.filter((d) => d.summary).length)}`);
console.log(`    highlights  ${pct(P.filter((d) => d.highlights.length).length)}`);
console.log(`    role        ${pct(P.filter((d) => d.role).length)}`);
console.log(`    teamSize    ${pct(P.filter((d) => d.teamSize).length)}`);
console.log(`    contribution ${pct(P.filter((d) => d.contribution != null).length)}`);
console.log(`    techStack   ${pct(P.filter((d) => d.techStack.length).length)}`);
console.log(`    links       ${pct(P.filter((d) => d.links.length).length)}`);
console.log(`    company     ${pct(P.filter((d) => d.company).length)}`);
/** 헤딩에 강조 기호가 남았는지 — 정리 규칙이 새면 화면에 별표가 보인다 */
const dirty = docs.filter((d) => d.body && /^#{1,6}[^\n]*\*/m.test(d.body));
console.log(`\n  본문 헤딩에 남은 * 기호  ${dirty.length}건${dirty.length ? ' ← 정리 규칙 확인 필요' : ' ✓'}`);
if (dirty.length) for (const d of dirty.slice(0, 5)) console.log(`    ${d.title.slice(0, 30)}`);

/**
 * 리포트도 `order` 로 정렬한다. 삽입 순서로 찍으면 손등록 프로젝트가 목록
 * 끝에 붙어 **DB 순서와 다르게 보인다** — 실제로 오해했다.
 */
const projectsInOrder = [...(byKind.project ?? [])].sort((a, b) => a.order - b.order);
const featuredDocs = projectsInOrder.filter((d) => d.featured);
console.log(`\n─── 대표 프로젝트 ${featuredDocs.length}건 (/resume 에 싣는 것) ───`);
for (const d of featuredDocs) {
  const why =
    pinnedOf(d.source.id)?.why ??
    (d.source.type === 'manual' ? '손등록 (content/projects-manual.json)' : '');
  console.log(`  ${(d.period.label || '-').padEnd(19)} ${d.slug.padEnd(22)} ${why}`);
}
/*
  PINNED 에 적었는데 Notion 에서 사라진 id 를 알려준다. 예전에는 제목으로
  맞췄기 때문에 제목만 다듬어도 여기 걸렸다 — 이제는 **정말 없어졌을 때만**
  걸린다.
*/
const notFound = PINNED.filter((p) => !(byKind.project ?? []).some((d) => d.source.id === p.id));
if (notFound.length) {
  console.log(`  ! PINNED 에 있으나 Notion 에 없는 id: ${notFound.map((m) => m.slug).join(', ')}`);
}

console.log('\n─── 프로젝트 슬러그 (최신순 · ★ 는 대표) ───');
for (const d of byKind.project ?? []) {
  console.log(
    `  ${d.featured ? '★' : ' '} ${(d.period.label || '-').padEnd(19)} ${(d.company ?? '-').padEnd(9)} ` +
      `${d.slug.slice(0, 42).padEnd(44)} ${d.title.slice(0, 26)}`,
  );
}

console.log('\n─── 스킬 ───');
for (const d of byKind.skill ?? []) {
  console.log(
    `  ${d.title.padEnd(16)} ${(d.category ?? '-').padEnd(22)} ` +
      `${d.level == null ? '숙련도 없음' : '숙련도 ' + d.level}  (${d.source.type})`,
  );
}

for (const kind of ['experience', 'education', 'certificate', 'activity']) {
  const list = byKind[kind];
  if (!list) continue;
  console.log(`\n─── ${kind} ───`);
  for (const d of list) {
    console.log(`  ${(d.summary ?? '').slice(0, 40).padEnd(42)} ${d.title}`);
  }
}

if (warnings.length) {
  console.log(`\n─── 경고 ${warnings.length}건 ───`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (SHOW) {
  const d = (byKind[SHOW] ?? [])[0];
  console.log(`\n─── ${SHOW} 첫 문서 전문 ───`);
  console.log(JSON.stringify(d, null, 2).slice(0, 6000));
}

/* ══════════════ 적재 ═══════════════════════════════════════ */

if (!WRITE) {
  console.log('\n※ dry-run 입니다. 적재하려면:  pnpm ingest -- --write');
  process.exit(0);
}

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('✗ MONGO_URI 가 없습니다.');
  process.exit(1);
}
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
try {
  await client.connect();
  const col = client.db(DB_NAME).collection('portfolio');
  let ins = 0;
  let upd = 0;
  for (const d of docs) {
    const { slug, images, ...rest } = d;

    /*
      ⚠️ **빈 `images` 로 덮지 않는다.**

      이 스크립트는 Notion 마크다운에서 이미지를 떼어내고 문서를 `images: []`
      로 만든다. 실제 그림은 `images:migrate` 가 Notion 에서 받아 R2 에 올린 뒤
      써 넣는다. 그래서 `$set` 에 빈 배열을 넣으면 **적재할 때마다 그 결과가
      지워진다.** 실제로 그렇게 45건의 이미지 링크가 사라진 적이 있다
      (2026-09-11). 파일은 R2 에 그대로 있었고 문서만 비어 있었다.

      여기서 빈 배열은 "이미지가 없다"가 아니라 **"아직 모른다"**는 뜻이다.
      아는 쪽(손등록·이관)이 채우고, 모르는 쪽은 손대지 않는다.

      손등록 프로젝트는 자기 `images` 를 갖고 오므로 그대로 덮어쓴다.
      → scripts/migrate-images.mjs · content/projects-manual.json
    */
    const hasImages = Array.isArray(images) && images.length > 0;
    const r = await col.updateOne(
      { 'source.type': d.source.type, 'source.id': d.source.id },
      {
        $set: {
          ...rest,
          updatedAt: new Date(),
          ...(RESLUG ? { slug } : {}),
          ...(hasImages ? { images } : {}),
        },
        /** slug 는 사람이 고칠 수 있다. 이미 있으면 덮지 않는다 */
        $setOnInsert: {
          createdAt: new Date(),
          ...(RESLUG ? {} : { slug }),
          /** 처음 만들 때만 빈 배열을 둔다 — 그 뒤로는 건드리지 않는다 */
          ...(hasImages ? {} : { images: [] }),
        },
      },
      { upsert: true },
    );
    if (r.upsertedCount) ins += 1;
    else if (r.modifiedCount) upd += 1;
  }
  const total = await col.countDocuments();
  console.log(`\n✓ 적재 완료 — 신규 ${ins} · 갱신 ${upd} · 컬렉션 총 ${total}건`);
  console.log(`  확인:  pnpm db:check`);

  /*
    이미지는 이 스크립트가 채우지 않는다. 비어 있는 것을 **끝에서 세어
    알려준다** — 예전에는 조용히 비어 있어서, 이력 화면에 그림이 하나도
    없다는 것을 사람이 나중에 발견했다.
  */
  const needImages = await col.countDocuments({
    'source.imageCount': { $gt: 0 },
    'images.0': { $exists: false },
  });
  if (needImages) {
    console.log(`
  ! 이미지가 비어 있는 문서 ${needImages}건 (Notion 에 그림이 있는 문서)`);
    console.log(`    채우려면:  pnpm images:migrate -- --write`);
  }
} catch (err) {
  console.error('\n✗ 적재 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
