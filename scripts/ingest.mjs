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
const FEATURED = [
  { match: 'Ignite Architecture', why: '사이드 · 건축사무소 브랜딩. 기획~납품 전 과정' },
  { match: 'TracX AI Agent', why: '트랙스로지스 AI · RAG + Tool Calling' },
  { match: 'SnapApps', why: '사이드 · SnapWord/SnapNote 시리즈' },
  { match: 'WMS 시스템', why: 'React Native PDA 스캐너 · 현장 검증' },
  { match: 'OMS 기업 주문', why: '설로인 OMS · API 호출 99% 감소' },
  { match: 'ASP.NET FE & BE', why: '.NET → React 전환' },
  /**
   * AI 작업으로 소개하지 않는다. 이력서 기술스택에 OpenAI 가 적혀 있지만
   * 노션 본문의 실제 작업은 레거시 구조 정리·용어 통일·팀 자동배정이다
   * (2026-09-08 사용자 확인).
   */
  { match: 'Inquiry Ticket', why: '트랙스로지스 · 고객응대(Ticket) 서비스 개발' },
];

/**
 * 슬러그 손질. 로마자 자동 생성은 정확하지만 URL 로 길고 안 예쁘다
 * (`baesongbi-gwanripeiji-next-js-ripektoring`). **공유될 프로젝트만** 다듬는다.
 * 적용하려면 `--reslug` 를 준다 — 기본은 기존 슬러그를 덮지 않는다.
 */
const SLUG_OVERRIDES = [
  { match: 'Ignite Architecture', slug: 'ignite-architecture' },
  { match: 'TracX AI Agent', slug: 'tracx-ai-agent' },
  { match: 'SnapApps', slug: 'snapapps' },
  { match: 'WMS 시스템', slug: 'wms-pda-scanner' },
  { match: 'OMS 기업 주문', slug: 'sirloin-oms' },
  { match: 'ASP.NET FE & BE', slug: 'aspnet-fe-be-split' },
  { match: '함히보까', slug: 'hamhibokka' },
  { match: 'Inquiry Ticket', slug: 'inquiry-ticket-admin' },
  { match: '배송비 관리 Admin UX', slug: 'shipping-fee-admin-ux' },
  { match: '배송비 관리페이지 Next.js', slug: 'shipping-fee-nextjs' },
];

const isFeatured = (title) => FEATURED.some((f) => title.includes(f.match));
const slugOverride = (title) => SLUG_OVERRIDES.find((o) => title.includes(o.match))?.slug ?? null;

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
  const date = props['기간']?.date ?? {};

  const { body: noImages, images } = extractImages(body.markdown);
  const cleaned = cleanMarkdown(noImages);
  const links = extractLinks(noImages);
  const sections = splitSections(cleaned);

  const overview = sections['개요'] ?? '';
  const roleSec = sections['나의 역할'] ?? '';
  const resultSec = sections['성과 및 결과'] ?? '';
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

  if (!overview) warnings.push(`개요 섹션 없음(도입부로 대체): ${title}`);
  if (!highlights.length) warnings.push(`성과 불릿 없음: ${title}`);

  push({
    kind: 'project',
    slug: uniqueSlug(slugOverride(title) ?? slugify(title), usedSlugs, `project-${i + 1}`),
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
    /** `/resume` 에 싣는 대표 프로젝트 → FEATURED 주석 참고 */
    featured: isFeatured(title),
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
const rootMd = cleanMarkdown(extractImages(root.markdown).body);

push({
  kind: 'profile',
  slug: uniqueSlug('profile', usedSlugs),
  title: '장민',
  summary: 'Full Stack Developer',
  body: rootMd.split(/^##\s/m)[0].trim(),
  techStack: [],
  highlights: [],
  links: extractLinks(root.markdown).filter((l) => !/notion\.(so|com)/.test(l.url)),
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
    if (b) bullets.push(b[1].replace(/\*\*/g, '').trim());
    else if (bullets.length && line.trim() === '') continue;
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

/**
 * 에세이 — 구조가 자유로우므로 덩어리로 담는다.
 *
 * 병역은 따로 문서를 만들지 않는다. Notion 루트 페이지의 프로필 안에
 * `### 병역 / - 육군 만기 제대` 로 이미 들어 있어서, 별도 문서로 넣으면
 * 중복이 되고 kind 를 certificate 로 두면 자격증 목록에 섞인다.
 */
{
  const ESSAYS = [
    { key: /자기 소개/, title: '자기 소개', until: /^가족$/ },
    { key: /^가족$/, title: '가족', until: /^학창 시절 및 활동$/ },
    { key: /^학창 시절 및 활동$/, title: '학창 시절 및 활동', until: /지원 동기/ },
    { key: /지원 동기/, title: '지원 동기', until: /기타 사항/ },
  ];
  let n = 0;
  for (const e of ESSAYS) {
    const s = rLines.findIndex((l) => e.key.test(l));
    if (s < 0) {
      warnings.push(`에세이 "${e.title}" 를 찾지 못했습니다`);
      continue;
    }
    let stop = rLines.findIndex((l, i) => i > s && e.until.test(l));
    if (stop < 0) stop = Math.min(s + 60, rLines.length);
    const text = rLines
      .slice(s + 1, stop)
      .filter(Boolean)
      .join('\n\n');
    if (!text) continue;
    push({
      kind: 'essay',
      slug: uniqueSlug(slugify(e.title), usedSlugs, `essay-${n + 1}`),
      title: e.title,
      summary: text.slice(0, 120).replace(/\n/g, ' '),
      body: text,
      techStack: [],
      highlights: [],
      links: [],
      images: [],
      order: n++,
      visibility: 'public',
      source: { type: 'docx', id: `essay:${e.title}` },
    });
  }
}

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

const featuredDocs = (byKind.project ?? []).filter((d) => d.featured);
console.log(`\n─── 대표 프로젝트 ${featuredDocs.length}건 (/resume 에 싣는 것) ───`);
for (const d of featuredDocs) {
  const why = FEATURED.find((f) => d.title.includes(f.match))?.why ?? '';
  console.log(`  ${(d.period.label || '-').padEnd(19)} ${d.slug.padEnd(22)} ${why}`);
}
const notFound = FEATURED.filter(
  (f) => !(byKind.project ?? []).some((d) => d.title.includes(f.match)),
);
if (notFound.length) {
  console.log(`  ! FEATURED 에 있으나 못 찾은 항목: ${notFound.map((m) => m.match).join(', ')}`);
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

for (const kind of ['experience', 'education', 'certificate', 'activity', 'essay']) {
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
    const { slug, ...rest } = d;
    const r = await col.updateOne(
      { 'source.type': d.source.type, 'source.id': d.source.id },
      {
        $set: { ...rest, updatedAt: new Date(), ...(RESLUG ? { slug } : {}) },
        /** slug 는 사람이 고칠 수 있다. 이미 있으면 덮지 않는다 */
        $setOnInsert: { createdAt: new Date(), ...(RESLUG ? {} : { slug }) },
      },
      { upsert: true },
    );
    if (r.upsertedCount) ins += 1;
    else if (r.modifiedCount) upd += 1;
  }
  const total = await col.countDocuments();
  console.log(`\n✓ 적재 완료 — 신규 ${ins} · 갱신 ${upd} · 컬렉션 총 ${total}건`);
  console.log(`  확인:  pnpm db:check`);
} catch (err) {
  console.error('\n✗ 적재 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
