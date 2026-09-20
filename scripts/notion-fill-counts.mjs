/**
 * '신규' 이력서에서 **셀 수 있는 숫자**를 채운다.
 *
 *   pnpm notion:counts            계획만 본다 (dry-run, 기본)
 *   pnpm notion:counts -- --write 실제로 고친다
 *
 * ⚠️ **지어내지 않는다.** 여기 들어가는 값은 전부 portfolio 컬렉션을 세어서
 * 나온 것이다. 기록에 없는 것(적용 서비스 수, 절감 작업량)은 숫자를 만들지
 * 않고 **셀 수 있는 다른 사실**로 문장을 바꾼다 — 모듈 5종·플랫폼 4종처럼.
 *
 * 세어서 나온 값 (2026-09-15)
 *
 *   큐텐 프로젝트        27건. 8개 영역으로 빠짐없이 분류된다
 *   팀장 기간 프로젝트    8건 (2019.07~2022.05 안에 시작한 것)
 *   사내 공통 모듈       5종 · 사내 플랫폼 4종
 *
 * 팀 인원은 넣지 않는다 — 2인 팀이라 숫자가 오히려 규모를 작게 보이게 한다
 * (2026-09-15 사용자 확인).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = '3dcdca69-72b8-80f8-8dfb-d31c0a6d0db2';
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
const H = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

async function notion(p, init) {
  const res = await fetch(`https://api.notion.com/v1${p}`, { ...init, headers: H });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''}`);
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

/** 찾을 조각 → 바꿀 문장 */
const EDITS = [
  {
    find: '글로벌 이커머스 플랫폼의 [숫자: 담당 도메인]',
    to:
      '글로벌 이커머스 플랫폼에서 12년간 결제 · 판매자 · 프로모션 · 커뮤니티 · 상품 전시 영역의 ' +
      '**27건**을 설계·개발·운영했습니다. 그중 **공통 모듈 5종**과 **개발환경·빌드·배포 개선 8건**은 ' +
      '여러 팀이 함께 쓰는 것이었습니다.',
  },
  {
    find: '팀장 (2019.07 ~ 2022.05, 2년 11개월) — 팀의 일정',
    to:
      '**팀장 (2019.07 ~ 2022.05, 2년 11개월)** — 소규모 팀의 일정·인력·릴리스를 책임지며 이 기간에 ' +
      '**8건**을 맡았습니다. Qpay QR결제와 바이오 인증 같은 결제, 판매자 광고발송·커스텀 페이지, ' +
      '커뮤니티·설문 플랫폼이었습니다.',
  },
  {
    find: '[숫자: 공통 모듈을 쓰는 서비스 수]',
    to:
      '사내 공통 모듈 **5종**(공유 레이어 · Item Picker · Admin Grid · Profiler · Dynamic Proxy API)과 ' +
      '사내 플랫폼 **4종**(게시판 · 룰렛 · 설문 · 커뮤니티)',
  },
  {
    find: '글로벌 이커머스 플랫폼에서 12년을 보내며 [숫자: 담당 도메인',
    to:
      '이커머스와 물류 도메인에서 14년간 웹 시스템을 만들어 온 풀스택 개발자입니다. ' +
      '글로벌 이커머스 플랫폼에서 12년을 보내며 결제 · 판매자 · 프로모션 · 커뮤니티 영역의 **27건**을 ' +
      '맡았고, 2019년부터 2년 11개월간 팀장을 맡았습니다. 레거시를 현대화하는 일에 강점이 있습니다 — ' +
      'ASP.NET 풀스택 구조를 React·Next.js 로 분리하면서 ' +
      '**빌드·배포를 3분에서 10초로, 코드베이스를 25%** 줄였습니다.',
  },
];

/* ── 실행 ── */

const kids = async (id) => (await notion(`/blocks/${id}/children?page_size=100`)).results ?? [];
const txt = (b) => (b[b.type]?.rich_text ?? []).map((t) => t.plain_text).join('');

/** 컬럼 안까지 훑는다 — 소개 문단이 컬럼 안에 있다 */
const flat = [];
for (const b of await kids(PAGE)) {
  flat.push(b);
  if (b.type === 'column_list') {
    for (const col of await kids(b.id)) for (const x of await kids(col.id)) flat.push(x);
  }
}

console.log(`셀 수 있는 숫자를 채운다${WRITE ? '' : '  (dry-run)'}\n`);

let done = 0;
for (const e of EDITS) {
  const hit = flat.find((b) => txt(b).includes(e.find));
  if (!hit) {
    console.log(`  ✗ 못 찾음: ${e.find.slice(0, 40)}`);
    continue;
  }
  console.log(`  ${hit.type}`);
  console.log(`    전: ${txt(hit).slice(0, 78)}`);
  console.log(`    후: ${e.to.replace(/\*\*/g, '').slice(0, 78)}`);
  if (WRITE) {
    await notion(`/blocks/${hit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [hit.type]: { rich_text: rich(e.to) } }),
    });
  }
  done += 1;
}

console.log(`\n${done}/${EDITS.length} 건`);
if (!WRITE) console.log('※ dry-run 입니다. 고치려면:  pnpm notion:counts -- --write');
