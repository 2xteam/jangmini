/**
 * 옛 이력서 서식(장민_이력서_경력기술서_자기소개서.docx)에 채울 데이터를 모은다.
 *
 *   node scripts/forms/legacy-data.mjs one     →  tmp-form/legacy-one.json
 *   node scripts/forms/legacy-data.mjs wezon
 *   node scripts/forms/legacy-data.mjs base    회사와 무관한 기본 이력서
 *
 * ## 왜 두 곳에서 읽는가
 *
 * 이 서식은 **절마다 출처가 다르다.**
 *
 *   기술스택 · 경력 · 주요 프로젝트   ← MongoDB (사이트와 같은 원본)
 *   소개 · 자기 소개 · 지원 동기       ← Notion 회사별 이력서
 *
 * 프로젝트 표의 다섯 칸(기술스택 / 역할 / 주요업무 / 성과 / 링크)은 DB 의
 * techStack · role+teamSize · body · highlights · links 와 그대로 맞물린다.
 * 그래서 프로젝트는 Notion 이 아니라 DB 에서 읽는다 — Notion 회사별 이력서는
 * 회사 단위로 묶여 있어 프로젝트 표를 채울 수 없다.
 *
 * ## 어떤 프로젝트를 싣는가
 *
 * `flagship`(대표)과 `personal`(개인)만 표로 싣고, `timeline` 은 끝에 한 줄씩
 * 붙인다. `merged` 는 **뺀다** — 대표 합본 안에 이미 들어가 있어서 실으면 같은
 * 일이 두 번 나온다. 사이트가 쓰는 기준과 같다.
 *
 * ## 지어내지 않는다
 *
 * 빈 칸은 빈 칸으로 둔다. 양식 스크립트가 그 칸을 통째로 빼거나 `【직접 입력】`
 * 으로 찍는다. 이력서에 지어낸 값을 넣으면 면접에서 그대로 무너진다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

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

/** 회사별 Notion 이력서. `base` 는 Notion 을 보지 않는다 */
const PAGES = {
  one: '3f3dca6972b880259dc1c3f6e71665e8',
  wezon: '3f3dca6972b88013bdfbd19099cf4165',
  base: null,
};

const KEY = (process.argv[2] ?? 'one').toLowerCase();
if (!(KEY in PAGES)) {
  console.error(`✗ 모르는 대상: ${KEY}  (${Object.keys(PAGES).join(' / ')})`);
  process.exit(1);
}

const warn = [];

/* ══════════════════ Notion ══════════════════ */

const NH = { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' };

async function notion(p, tries = 3) {
  for (let n = 1; n <= tries; n += 1) {
    try {
      const r = await fetch(`https://api.notion.com/v1${p}`, { headers: NH });
      const j = await r.json();
      if (!r.ok) throw new Error(`${r.status} ${j.message ?? ''}`);
      return j;
    } catch (e) {
      if (n === tries) throw e;
      await new Promise((r) => setTimeout(r, 1200 * n));
    }
  }
}

const ntxt = (b) => (b[b.type]?.rich_text ?? []).map((t) => t.plain_text).join('');
/** 제목 비교용 — Notion 제목은 '자 기 소 개 서' 처럼 띄어 쓴 것이 섞여 있다 */
const squash = (s) => s.replace(/\s/g, '');

let kids = [];
if (PAGES[KEY]) kids = (await notion(`/blocks/${PAGES[KEY]}/children?page_size=100`)).results;

/** 제목(h2 또는 h3) 다음부터 같은 높이의 다음 제목 전까지 */
function section(name, level = 2) {
  const tag = `heading_${level}`;
  const s = kids.findIndex((b) => b.type === tag && squash(ntxt(b)) === squash(name));
  if (s < 0) {
    warn.push(`Notion '${name}' 절을 못 찾았습니다`);
    return [];
  }
  const stop = level === 2 ? ['heading_2'] : ['heading_2', 'heading_3'];
  const out = [];
  for (let i = s + 1; i < kids.length; i += 1) {
    if (stop.includes(kids[i].type)) break;
    out.push(kids[i]);
  }
  return out;
}

const paras = (bs) => bs.filter((b) => b.type === 'paragraph').map(ntxt).filter(Boolean);
const rowsOf = async (id) =>
  (await notion(`/blocks/${id}/children?page_size=50`)).results.map((r) =>
    r.table_row.cells.map((c) => c.map((t) => t.plain_text).join('')),
  );
const lines = (bs) =>
  bs
    .filter((b) => b.type === 'paragraph' || b.type === 'bulleted_list_item')
    .map(ntxt)
    .filter(Boolean);

/* ══════════════════ MongoDB ══════════════════ */

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const col = client.db('jangmini').collection('portfolio');

const docs = async (kind) => col.find({ kind }).sort({ order: 1 }).toArray();

/* ── 소개 ── */
const [profile] = await docs('profile');

/* ── 기술스택 ── */
/**
 * DB 의 분류(`category`)는 사이트 기준이라 '소프트웨어' 한 칸에 언어·DB·툴이
 * 뒤섞여 있다. 옛 이력서 표의 8칸에 맞추려면 **이름으로 가른다.**
 *
 * 여기 없는 것은 Etc 로 가고 경고를 찍는다 — 조용히 묻히면 새 스택을 넣어도
 * 표에 안 보인다.
 */
const SKILL_CATS = [
  ['Programming Languages', ['ASP.NET', 'C#', 'javascript', 'typescript', 'JAVA', 'JSP']],
  ['Framework / Library', ['.NET Framework', 'jquery', 'React', 'Next.js', 'React-Native', 'GraphQl', 'node']],
  ['Cloud / Infrastructure', ['AWS EC2', 'Cloudflare S3', 'IIS']],
  ['Tooling / DevOps', ['Webpack', 'gulp', 'pnpm', 'swc', 'Git', 'Github', 'Bitbucket', 'jenkins', 'Vite']],
  ['Environment', ['Linux', 'Windows']],
  ['DB', ['MS-SQL', 'MongoDB']],
  ['Etc', ['Jira', 'Confluence', 'Teams', 'Notion']],
];
const skillDocs = await docs('skill');
/** 어학은 기술 표가 아니라 '기타 사항'으로 간다 */
const techDocs = skillDocs.filter((s) => s.category !== '언어');
const catOf = (title) => {
  const t = title.toLowerCase();
  return SKILL_CATS.find(([, names]) => names.some((n) => n.toLowerCase() === t))?.[0] ?? null;
};
const bucket = new Map(SKILL_CATS.map(([c]) => [c, []]));
for (const s of techDocs) {
  const c = catOf(s.title);
  if (!c) {
    warn.push(`스킬 '${s.title}' 의 분류를 모릅니다 — Etc 로 넣었습니다 (SKILL_CATS 에 추가하세요)`);
    bucket.get('Etc').push(s.title);
    continue;
  }
  bucket.get(c).push(s.title);
}
const skills = [...bucket.entries()].filter(([, v]) => v.length).map(([c, v]) => [c, v.join(', ')]);

/* ── 경력 사항 ── */
/** 기간은 점으로 쓴다. DB 에는 '2026-09 ~' 처럼 붙임표가 섞여 있다 */
const dots = (s) => String(s ?? '').replace(/(\d{4})-(\d{1,2})/g, '$1.$2');

/**
 * '부서 및 R&R' 칸.
 *
 * DB 의 experience 에는 부서가 title 에 붙어 있을 뿐(`트랙스로지스 테크팀`)
 * 직급·역할이 없다. Notion 회사별 이력서의 상세 경력 제목이 그 둘을 다듬어
 * 들고 있으므로(`트랙스로지스 테크팀 / 차장 / 2025.09 ~ 재직중`) 거기서 읽고,
 * 없으면 title 에서 회사 이름만 떼어 쓴다.
 */
const detailHeads = kids.filter((b) => b.type === 'heading_3').map(ntxt);
function deptOf(e) {
  const company = e.company ?? '';
  const head = detailHeads.find((h) => squash(h).startsWith(squash(company)));
  const dept = !head
    ? ''
    : head
        .slice(head.indexOf(company) + company.length)
        /** 뒤에 붙은 기간을 떼어낸다. '팀장(2019.07 ~ …' 처럼 괄호가 열린 채 잘리므로 괄호째 지운다 */
        .replace(/\s*\(?\s*\d{4}[.\-]\d{1,2}[\s\S]*$/, '')
        .replace(/^\s*\/\s*/, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/[\s/(]+$/, '')
        .trim();
  /**
   * 허리업처럼 Notion 제목에 부서가 없는 곳이 있다. title 에서 회사명을 떼고,
   * 그래도 비면 본인이 쓴 업무 첫 구절을 쓴다 — 칸이 비면 빠뜨린 것처럼 보인다.
   */
  if (dept) return dept;
  const fromTitle = (e.title ?? '').replace(company, '').trim();
  if (fromTitle) return fromTitle;
  return ((e.highlights ?? [])[0] ?? '').split(/\s[—-]\s/)[0].trim();
}

const expDocs = await docs('experience');
/**
 * '비고' 칸은 비워 둔다. 원본에서는 큐텐의 부서 이동 구간만 적혀 있었고,
 * DB 에는 그 구간이 없다. 성과를 여기 쏟으면 표가 읽히지 않는다 —
 * 그 내용은 아래 '주요 프로젝트'가 맡는다.
 */
const career = expDocs.map((e) => [dots(e.period?.label), e.company ?? e.title ?? '', deptOf(e), '']);

/**
 * 총 경력. 재직 구간을 월 단위로 더한다.
 *
 * 2개월짜리 허리업도 **뺀 적이 있는데 그러면 설로인과 트랙스로지스 사이가
 * 설명 없는 공백으로 남는다.** 짧아도 싣는다.
 */
const MONTH = /(\d{4})[.\-](\d{1,2})/g;
function monthsOf(label) {
  const m = [...String(label).matchAll(MONTH)].map((x) => Number(x[1]) * 12 + Number(x[2]));
  if (!m.length) return 0;
  const now = new Date();
  const end = m.length > 1 ? m[m.length - 1] : now.getFullYear() * 12 + (now.getMonth() + 1);
  return Math.max(0, end - m[0] + 1);
}
const totalMonths = career.reduce((n, r) => n + monthsOf(r[0]), 0);
const careerTotal = `총 ${Math.floor(totalMonths / 12)}년 ${totalMonths % 12}개월`;

/* ── 주요 프로젝트 ── */
const projDocs = await docs('project');

/**
 * 본문에서 한 단락을 꺼낸다.
 *
 * 머리글이 두 갈래다 — 대표(합본)는 `개요 / 문제 / 나의 역할과 결정 / 결과`,
 * 개인은 `개요 / 나의 역할 / 주요 업무 / 성과 및 결과`. 둘 다 받는다.
 *
 * ⚠️ 정규식 하나로 `^##\s*이름$\n([\s\S]*?)(?=\n#|$)` 처럼 잡으면 **첫 줄만**
 * 들어온다. `m` 플래그를 켜는 순간 `$` 가 줄 끝마다 걸려서 게으른 반복이
 * 거기서 멈추기 때문이다. 그래서 머리글로 한 번 쪼개 두고 찾는다.
 */
function sections(body) {
  const map = new Map();
  let cur = null;
  for (const line of String(body ?? '').split('\n')) {
    const h = /^#{1,4}\s*(.+?)\s*$/.exec(line);
    if (h) {
      cur = h[1];
      map.set(cur, []);
      continue;
    }
    if (cur) map.get(cur).push(line);
  }
  return map;
}
function part(body, ...names) {
  const map = sections(body);
  for (const name of names) {
    const v = (map.get(name) ?? []).join('\n').trim();
    if (v) return v;
  }
  return '';
}
/** 마크다운 불릿을 줄 목록으로. 표 칸 안에서는 들여쓰기가 의미 없다 */
const bullets = (md) =>
  String(md)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l && !/^#{1,4}\s/.test(l));

const period = (p) => dots(p.period?.label);

function projectRow(p) {
  /** 주요업무 칸 — 무엇을 왜 그렇게 했는지가 들어가야 한다 */
  const work = part(p.body, '나의 역할과 결정', '주요 업무', '나의 역할') || p.summary || '';
  /** 성과 칸 — highlights 가 이미 다듬어진 결과 목록이다 */
  const result = (p.highlights ?? []).length ? p.highlights : bullets(part(p.body, '결과', '성과 및 결과'));
  return {
    title: [period(p), p.title].filter(Boolean).join(' / '),
    stack: (p.techStack ?? []).join(', '),
    role: [p.teamSize && `팀 구성 : ${p.teamSize}`, p.role && `역할 : ${p.role}`].filter(Boolean).join('\n'),
    work: bullets(work).join('\n'),
    result: result.join('\n'),
    link: (p.links ?? []).map((l) => (l.label ? `${l.label} — ${l.url}` : l.url)).join('\n'),
  };
}

const projects = projDocs.filter((p) => p.tier === 'flagship' || p.tier === 'personal').map(projectRow);
const timeline = projDocs
  .filter((p) => p.tier === 'timeline')
  .map((p) => [period(p), p.title].filter(Boolean).join(' / '));

/**
 * 대표 합본에는 역할·팀 구성이 비어 있다. 그 안으로 들어간(`merged`) 원본들이
 * 들고 있으므로 거기서 가져온다. 여러 개면 가장 많이 나온 값.
 */
const absorbed = new Map();
for (const p of projDocs) {
  if (p.tier !== 'merged' || !p.mergedInto) continue;
  if (!absorbed.has(p.mergedInto)) absorbed.set(p.mergedInto, []);
  absorbed.get(p.mergedInto).push(p);
}
const common = (list, pick) => {
  const n = new Map();
  for (const x of list.map(pick).filter(Boolean)) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};
projDocs
  .filter((p) => p.tier === 'flagship')
  .forEach((p, i) => {
    const row = projects[projDocs.filter((x) => x.tier === 'flagship' || x.tier === 'personal').indexOf(p)];
    if (!row || row.role) return;
    const kidsOf = absorbed.get(p.slug) ?? [];
    if (!kidsOf.length) return;
    const team = common(kidsOf, (x) => x.teamSize);
    const role = common(kidsOf, (x) => x.role);
    row.role = [team && `팀 구성 : ${team}`, role && `역할 : ${role}`].filter(Boolean).join('\n');
  });

await client.close();

/* ══════════════════ 회사별 글 ══════════════════ */

/** 어학은 기술 표에서 뺀 대신 '기타 사항'에 적는다 */
const langs = skillDocs.filter((s) => s.category === '언어').map((s) => `어학 : ${s.title}`);

/**
 * 절 안의 표를 '라벨 : 값' 줄로 편다.
 * 첫 줄이 머리글(`구분 | 내용`)이면 버린다 — 이력서 본문에 들어갈 말이 아니다.
 */
async function tableLines(blocks) {
  const t = blocks.find((b) => b.type === 'table');
  if (!t) return [];
  const rows = await rowsOf(t.id);
  if (rows[0] && /^(구분|항목)$/.test(rows[0][0]?.trim())) rows.shift();
  return rows.map((c) => c.filter(Boolean).join(' : '));
}

/** 표에 이미 있는 항목은 또 붙이지 않는다 */
const merge = (rows, extra) => rows.concat(extra.filter((x) => !rows.some((r) => r.startsWith(x.split(' : ')[0]))));

let essay = [];
let motive = [];
let etc = [];

if (KEY === 'one') {
  essay = paras(section('처우 및 이직 사유'));
  motive = paras(section('지원 동기', 3));
  etc = merge(await tableLines(section('학력 · 자격 · 어학 · 병역')), langs);
} else if (KEY === 'wezon') {
  essay = paras(section('자 기 소 개 서'));
  motive = paras(section('지 원 동 기'));
  etc = merge(await tableLines(section('기 타 사 항')), langs);
} else {
  etc = langs;
}

/**
 * '소개 / About Me' 는 회사와 무관한 내 소개다. DB 의 profile 본문 첫 문단을
 * 쓴다 — 회사별 Notion 이력서의 첫 줄은 "채용 공고 순서로 정리했습니다" 같은
 * 안내문이라 소개가 아니다. 한 번 그걸 집어서 28자짜리 소개가 나왔다.
 */
const intro = (profile?.body ?? '')
  .split(/\n\s*\n/)
  .map((t) => t.trim())
  .filter((t) => t && !/^#{1,4}\s/.test(t))
  .slice(0, 2)
  .join('\n')
  .replace(/\*\*/g, '');
if (!intro) warn.push('소개가 비었습니다 — profile 문서의 본문을 확인하세요');

const data = {
  key: KEY,
  generatedAt: new Date().toISOString().slice(0, 10),
  intro,
  skills,
  careerTotal,
  career,
  projects,
  timeline,
  essay,
  motive,
  etc,
};

mkdirSync('tmp-form', { recursive: true });
const out = `tmp-form/legacy-${KEY}.json`;
writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');

console.log(`→ ${out}`);
console.log(`  소개 ${data.intro ? `${data.intro.length}자` : '없음'}`);
console.log(`  기술스택 ${skills.length}분류 · 경력 ${career.length}사 (${careerTotal})`);
console.log(`  주요 프로젝트 ${projects.length} · 연표 ${timeline.length}`);
console.log(`  자기소개 ${essay.length}문단 · 지원동기 ${motive.length}문단 · 기타 ${etc.length}줄`);
for (const p of projects) {
  const miss = ['stack', 'role', 'work', 'result'].filter((k) => !p[k]);
  console.log(`    ${p.title.slice(0, 44).padEnd(46)}${miss.length ? `빈 칸: ${miss.join(', ')}` : ''}`);
}
if (warn.length) {
  console.log('');
  for (const w of warn) console.log(`  ⚠ ${w}`);
}
