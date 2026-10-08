/**
 * Notion '위존' 이력서를 터닝포인트HR 양식용 데이터로 뽑는다.
 *
 *   node scripts/forms/wezon-data.mjs   →  tmp-form/wezon-form.json
 *
 * ## 왜 Notion 에서 뽑나
 *
 * 내용의 원본은 Notion 한 곳이다. 양식을 채우려고 내용을 스크립트에 또 적으면
 * 둘이 어긋난다 — 이 저장소에서 반복해 겪은 함정이다. Notion 을 고치고 다시
 * 돌리면 .docx 가 따라온다.
 *
 * 페이지 구조를 전제한다 (notion-write-wezon.mjs 가 만든 그대로) —
 *   H2 절 제목 / H3 회사별 / '주요업무'·'주요성과'·'이직 사유' 라벨 문단
 * 구조가 바뀌면 여기도 바꿔야 한다. 그래서 못 찾은 절은 조용히 넘어가지 않고
 * 경고를 찍는다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const PAGE = '3f3dca69-72b8-8013-bdfb-d19099cf4165';

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

const H = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
};

async function api(p, tries = 3) {
  for (let n = 1; n <= tries; n += 1) {
    try {
      const r = await fetch(`https://api.notion.com/v1${p}`, { headers: H });
      const j = await r.json();
      if (!r.ok) throw new Error(`${r.status} ${j.message ?? ''}`);
      return j;
    } catch (e) {
      if (n === tries) throw e;
      await new Promise((r) => setTimeout(r, 1200 * n));
    }
  }
}

const txt = (b) => (b[b.type]?.rich_text ?? []).map((t) => t.plain_text).join('');
const rowsOf = async (id) =>
  (await api(`/blocks/${id}/children?page_size=50`)).results.map((r) =>
    r.table_row.cells.map((c) => c.map((t) => t.plain_text).join('')),
  );

const warn = [];
const kids = (await api(`/blocks/${PAGE}/children?page_size=100`)).results;

/** 인적사항 표는 2단 안에 들어 있다 — 칼럼을 열어 찾는다 */
async function findPersonalTable() {
  for (const b of kids) {
    if (b.type === 'table') return rowsOf(b.id);
    if (b.type !== 'column_list') continue;
    for (const col of (await api(`/blocks/${b.id}/children?page_size=10`)).results) {
      for (const inner of (await api(`/blocks/${col.id}/children?page_size=10`)).results) {
        if (inner.type === 'table') return rowsOf(inner.id);
      }
    }
  }
  return null;
}

const personalRows = await findPersonalTable();
if (!personalRows) warn.push('인적사항 표를 못 찾았습니다');
const P = Object.fromEntries((personalRows ?? []).map((r) => [r[0], r[1]]));

/** H2 절 사이의 블록을 모은다 */
const sectionOf = (name) => {
  const s = kids.findIndex((b) => b.type === 'heading_2' && txt(b).replace(/\s/g, '') === name.replace(/\s/g, ''));
  if (s < 0) {
    warn.push(`'${name}' 절을 못 찾았습니다`);
    return [];
  }
  const out = [];
  for (let i = s + 1; i < kids.length; i += 1) {
    if (kids[i].type === 'heading_2') break;
    out.push(kids[i]);
  }
  return out;
};

const bullets = (blocks) => blocks.filter((b) => b.type === 'bulleted_list_item').map(txt);

/* ── 학력 ── */
const eduBlocks = sectionOf('학력사항');
const education = eduBlocks.find((b) => b.type === 'table')
  ? await rowsOf(eduBlocks.find((b) => b.type === 'table').id)
  : [];

/* ── 핵심역량 ── */
const core = bullets(sectionOf('핵심역량'));

/* ── 경력 요약 ── */
const careerBlocks = sectionOf('경력사항');
const totalText = (careerBlocks.map(txt).find((t) => /총 경력/.test(t)) ?? '').replace(/^.*총 경력:\s*/, '').trim();
const careerSummary = careerBlocks.find((b) => b.type === 'table')
  ? (await rowsOf(careerBlocks.find((b) => b.type === 'table').id)).slice(1)
  : [];

/* ── 상세 경력 ── */
const detailBlocks = sectionOf('상세경력사항');
const details = [];
let cur = null;
let mode = null;
for (const b of detailBlocks) {
  const t = txt(b);
  if (b.type === 'heading_3') {
    cur = { head: t, meta: '', work: [], perf: [], reason: '' };
    details.push(cur);
    mode = 'meta';
    continue;
  }
  if (!cur) continue;
  if (t === '주요업무') { mode = 'work'; continue; }
  if (t === '주요성과') { mode = 'perf'; continue; }
  if (t === '이직 사유') { mode = 'reason'; continue; }
  if (mode === 'meta' && b.type === 'paragraph' && t) { cur.meta = t; mode = null; continue; }
  if (mode === 'work' && b.type === 'bulleted_list_item') cur.work.push(t);
  if (mode === 'perf' && b.type === 'bulleted_list_item') cur.perf.push(t);
  if (mode === 'reason' && b.type === 'paragraph' && t) cur.reason = t;
}

/* ── 어학·자격 ── */
const certs = bullets(sectionOf('어학, 수상 및 자격사항'));

/* ── 기타(처우) ── */
const etcBlocks = sectionOf('기타사항');
const etc = etcBlocks.find((b) => b.type === 'table') ? await rowsOf(etcBlocks.find((b) => b.type === 'table').id) : [];

/* ── 자기소개서 ── */
const intro = sectionOf('자기소개서').filter((b) => b.type === 'paragraph').map(txt).filter(Boolean);

const data = {
  generatedAt: new Date().toISOString().slice(0, 10),
  applyFor: P['지원 분야'] ?? '',
  personal: {
    name: P['이름'] ?? '',
    birth: P['출생년도'] ?? '',
    address: P['주소'] ?? '',
    contact: P['연락처'] ?? '',
    military: P['병역사항'] ?? '',
  },
  education,
  core,
  totalText,
  careerSummary,
  details,
  certs,
  etc,
  intro,
};

mkdirSync('tmp-form', { recursive: true });
writeFileSync('tmp-form/wezon-form.json', JSON.stringify(data, null, 2), 'utf8');

console.log('→ tmp-form/wezon-form.json');
console.log(`  지원 분야  ${data.applyFor.slice(0, 48)}`);
console.log(`  총 경력    ${data.totalText}`);
console.log(`  학력 ${education.length} · 핵심역량 ${core.length} · 경력요약 ${careerSummary.length} · 상세 ${details.length} · 자격 ${certs.length} · 기타 ${etc.length} · 자소서 ${intro.length}문단`);
details.forEach((d) => console.log(`    ${d.head.split('/')[0].trim().slice(0, 22).padEnd(24)} 업무 ${d.work.length} · 성과 ${d.perf.length} · 사유 ${d.reason ? 'O' : 'X'}`));
if (warn.length) {
  console.log('');
  warn.forEach((w) => console.log(`  ⚠ ${w}`));
}
