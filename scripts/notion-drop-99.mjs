/**
 * "API 호출 99% 감소" 를 Notion 에서 걷어낸다.
 *
 *   pnpm notion:drop99            계획만 본다 (dry-run, 기본)
 *   pnpm notion:drop99 -- --write 실제로 고친다
 *
 * 왜 빼는가 — 원본(`OMS 기업 주문 및 주소록 관리 프로세스 개선`)에 몇 건이
 * 몇 건이 됐는지가 없다. "전량 조회 → 필터 조회" 를 보고 붙인 어림값이다.
 * 게다가 없앤 호출은 **원래 아무 일도 하지 않던 호출**이라("로직이 제대로
 * 동작하지 않아 아무런 효과가 없는 상태"), 캐물으면 성능 최적화가 아니라
 * 버그 수정으로 귀결된다. 이력서에서 숫자 하나가 무너지면 나머지 숫자까지
 * 같이 의심받는다. (2026-09-20 사용자 확인)
 *
 * ⚠️ 원본 프로젝트 페이지는 **건드리지 않는다.** 그건 당시 기록이다.
 * 고치는 것은 이력서('신규')와 합본 페이지의 표현뿐이다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RESUME = '3dcdca69-72b8-80f8-8dfb-d31c0a6d0db2'; // 신규
const DB_HISTORY = 'db5dca69-72b8-834d-896c-013f4a82615c';
const MERGED_TITLE = '물류 WMS·OMS 구축과 현장 앱';
const NOTION_VERSION = '2022-06-28';

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

const WRITE = process.argv.includes('--write');
if (!process.env.NOTION_TOKEN) {
  console.error('✗ NOTION_TOKEN 이 없습니다.');
  process.exit(1);
}
const H = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

async function notion(p, init) {
  const res = await fetch(`https://api.notion.com/v1${p}`, { ...init, headers: H });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''} — ${p}`);
  return json;
}

function rich(text) {
  const out = [];
  for (const part of String(text).split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = part.startsWith('**') && part.endsWith('**');
    out.push({
      type: 'text',
      text: { content: bold ? part.slice(2, -2) : part },
      annotations: bold ? { bold: true } : undefined,
    });
  }
  return out;
}

/** 원본에 실제로 있는 사실만 쓴다 — 전량 조회를 걷어내고 누락 건만 조회 */
const EDITS = [
  {
    where: '이력서 · 경력(설로인)',
    find: 'API 호출을 99%',
    to:
      '주소록 자동 완성이 매번 전체 목록을 조회하며 페이지를 멈추게 하던 것을 찾아, ' +
      '동작하지 않던 로직을 걷어내고 우편번호 누락 건만 조회하도록 수정',
  },
  {
    where: '이력서 · 대표 프로젝트',
    find: 'API 호출 99% 감소',
    to: '**배포 원복 시간 50% 단축** · 추가 채용 없이 프론트 전 영역 커버',
  },
  {
    where: '합본 · 개요',
    find: 'API 호출 99% 감소, 배포 원복',
    to:
      'OMS·WMS·Admin 프론트엔드 전 영역을 맡고, React Native 로 현장 PDA 앱까지 직접 만들었습니다. ' +
      '추가 채용 없이 프론트 전 영역을 기한 내 커버했고, 배포 원복 시간을 50% 줄였습니다.',
  },
  {
    where: '합본 · 결과',
    find: '특정 화면 API 호출 99% 감소',
    to: '주소록 자동 완성에서 동작하지 않던 전체 목록 조회를 걷어내 페이지 멈춤 현상을 제거.',
  },
];

const kids = async (id) => (await notion(`/blocks/${id}/children?page_size=100`)).results ?? [];
const txt = (b) => (b[b.type]?.rich_text ?? []).map((t) => t.plain_text).join('');

/** 컬럼 안까지 훑는다 */
async function flatten(root) {
  const out = [];
  for (const b of await kids(root)) {
    out.push(b);
    if (b.type === 'column_list') {
      for (const col of await kids(b.id)) for (const x of await kids(col.id)) out.push(x);
    }
  }
  return out;
}

/* 합본 페이지를 제목으로 찾는다 */
const norm = (t) => t.replace(/\s+/g, ' ').trim();
const rows = (await notion(`/databases/${DB_HISTORY}/query`, { method: 'POST', body: '{}' })).results ?? [];
const merged = rows.find((r) =>
  Object.values(r.properties ?? {}).some(
    (v) => v?.type === 'title' && norm(v.title.map((t) => t.plain_text).join('')) === MERGED_TITLE,
  ),
);
if (!merged) throw new Error(`합본 페이지를 못 찾음: ${MERGED_TITLE}`);

const blocks = [...(await flatten(RESUME)), ...(await flatten(merged.id))];

console.log(`"API 호출 99% 감소" 를 걷어낸다${WRITE ? '' : '  (dry-run)'}\n`);

let done = 0;
for (const e of EDITS) {
  const hit = blocks.find((b) => txt(b).includes(e.find));
  if (!hit) {
    console.log(`  ✗ 못 찾음 — ${e.where}: ${e.find}`);
    continue;
  }
  console.log(`  ${e.where}  (${hit.type})`);
  console.log(`    전: ${txt(hit)}`);
  console.log(`    후: ${e.to.replace(/\*\*/g, '')}\n`);
  if (WRITE) {
    await notion(`/blocks/${hit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [hit.type]: { rich_text: rich(e.to) } }),
    });
  }
  done += 1;
}

/* 남은 게 있는지 다시 확인한다 */
if (WRITE) {
  const after = [...(await flatten(RESUME)), ...(await flatten(merged.id))];
  const left = after.filter((b) => txt(b).includes('99%'));
  console.log(left.length ? `⚠ 아직 남음 ${left.length}건` : '남은 99% 없음');
}

console.log(`${done}/${EDITS.length} 건`);
if (!WRITE) console.log('※ dry-run 입니다. 고치려면:  pnpm notion:drop99 -- --write');
