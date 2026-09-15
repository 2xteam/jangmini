/**
 * Notion 이력 DB 를 재구성한다.
 *
 *   pnpm notion:restructure            계획만 본다 (dry-run, 기본)
 *   pnpm notion:restructure -- --write 실제로 쓴다
 *
 * 세 단계다.
 *
 *   ① 이력 DB 에 `구분` select 속성을 만든다 (대표 · 개인 · 연표 · 합쳐짐)
 *   ② 기존 46건에 구분을 지정한다
 *   ③ 합본 5건을 **새 페이지로** 만든다
 *
 * ⚠️ **원본을 지우거나 덮지 않는다.** 46건은 그대로 두고 구분만 붙이며,
 * 합본은 새 페이지로 추가한다(46 → 51행). 되돌리려면 새 5건만 지우면 된다.
 * 사용자가 "태그로만" 을 요청했고, 원본 기록이 합쳐지는 것을 원하지 않았다.
 *
 * 합본 본문은 **새 양식**을 쓴다 — 개요 / 문제 / 나의 역할과 결정 / 결과 / 회고.
 * 옛 양식(개요 / 나의 역할 / 성과 및 결과 / 회고)은 나머지 문서가 계속 쓴다.
 *
 * 숫자는 지어내지 않는다. 확보된 것만 넣고 나머지는 `[숫자: …]` 로 남긴다 —
 * 사람이 채워야 면접에서 방어된다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DB_HISTORY = 'db5dca69-72b8-834d-896c-013f4a82615c';
const NOTION_VERSION = '2022-06-28';
const PROP = '구분';
const OPTIONS = [
  { name: '대표', color: 'red' },
  { name: '개인', color: 'purple' },
  { name: '연표', color: 'gray' },
  { name: '합쳐짐', color: 'default' },
];

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
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error('✗ NOTION_TOKEN 이 없습니다.');
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

async function notion(pathname, init) {
  const res = await fetch(`https://api.notion.com/v1${pathname}`, { ...init, headers: H });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${json.code ?? ''} ${json.message ?? ''} — ${pathname}`);
  }
  return json;
}

/**
 * 제목을 맞출 때 쓰는 정규화.
 *
 * ⚠️ Notion 제목 4건이 일반 공백이 아니라 **줄바꿈 없는 공백(U+00A0)**을
 * 쓰고 있었다. 눈으로는 똑같은데 `===` 가 false 가 되어, 합본에 들어가야 할
 * 문서가 조용히 "연표"로 분류됐다. `\s` 는 그 공백도 잡는다.
 */
const norm = (t) => t.replace(/\s+/g, ' ').trim();

const titleOf = (page) => {
  for (const v of Object.values(page.properties ?? {})) {
    if (v?.type === 'title') return norm((v.title ?? []).map((t) => t.plain_text).join(''));
  }
  return '';
};

/* ══════════ 어느 문서가 어디로 가는가 ══════════ */

/** 대표 합본에 흡수되는 원본들 */
const MERGED = {
  legacy: [
    'ASP.NET FE & BE 분리 프로젝트',
    'Common Script 빌드 개선',
    'MultiRepo > MonoRepo 전환',
    'Vanila Js React 전환 작업',
    'NEXT.JS 로 리펙토링',
  ],
  logistics: [
    'WMS 시스템 구축 프로젝트 UI 작업',
    'OMS 기업 주문 및 주소록 관리 프로세스 개선',
    '배포 프로세스 개선 작업',
    '배포 접근성 향상 및 리모트 근무 지원 강화',
    'FE 개발 환경 로컬 도메인 분리 작업',
  ],
  agent: [
    'TracX AI Agent 구축 (Admin 업무 지원 AI)',
    '배송비 관리 Admin UX 개선 및 정보 구조 재설계',
    '배송비 관리페이지 Next.js 리펙토링',
  ],
  platform: [
    '공통 공유 레이어 개발',
    '공통 Item Picker 레이어 개발',
    'Admin용 Grid 모듈 개발',
    'RestFul Dynamic Proxy API 구축 프로젝트',
    '성능 개선 Propiler 모듈 개발',
    '게시판 플렛폼',
    '룰렛 플렛폼',
    '설문조사 플렛폼 개발',
    '판매자 커스텀 페이지 프로세스 구축',
  ],
};

const PERSONAL = [
  'Ignite Architecture – 건축사무소 브랜딩 웹사이트 구축',
  'SnapApps – AI 기반 학습 보조 웹앱 개발 (SnapWord / SnapNote)',
  '함히보까 – 가족과 함께 기획한 목표 달성 스티커 앱 개발',
];

/* ══════════ 합본 5건 ══════════ */

const h2 = (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: t } }] } });
const p = (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: t } }] } });
const li = (t) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: t } }] } });

/** 개요 / 문제 / 나의 역할과 결정 / 결과 / 회고 */
const body = ({ overview, problem, decisions, results, retro }) => [
  h2('개요'),
  ...overview.map(p),
  h2('문제'),
  ...problem.map(li),
  h2('나의 역할과 결정'),
  ...decisions.map(li),
  h2('결과'),
  ...results.map(li),
  h2('회고'),
  ...retro.map(li),
];

const NEW_PAGES = [
  {
    key: 'legacy',
    title: '레거시 현대화 — ASP.NET 에서 React·Next.js 로',
    date: { start: '2023-07-01', end: '2024-07-31' },
    tech: ['FE', 'BE', 'ASP.NET', 'React', 'NEXT.JS', 'typescript', 'webpack'],
    contribution: 1,
    body: body({
      overview: [
        'ASP.NET 풀스택 구조에서 프론트엔드와 백엔드를 분리하고, 빌드·배포와 저장소 구조까지 함께 옮긴 작업입니다. 빌드·배포 3분 → 10초, 코드베이스 25% 축소.',
        '12년을 그 구조 안에서 보낸 사람이 전환을 맡았다는 점이 이 항목의 핵심입니다.',
      ],
      problem: [
        '.NET 개발자 채용이 어려웠습니다. 풀스택 구조에서는 백엔드 인원이 UI 작업까지 떠안아 병목이 생겼습니다.',
        '빌드와 배포에 3분 이상이 걸려 변경을 확인하는 주기가 길었습니다.',
        '저장소가 여러 개로 흩어져 공통 코드의 버전이 서로 어긋났습니다.',
        '[숫자: 당시 화면 수 또는 팀 규모 — 문제의 크기를 보여주는 값]',
      ],
      decisions: [
        'FE 를 분리하되 전면 재작성은 하지 않기로 했습니다. 번들 주입 규칙을 설계해 ASP.NET 페이지가 React 번들을 자동으로 싣게 만들어, 화면 단위로 점진 전환이 가능하게 했습니다.',
        '전환 범위를 메인페이지로 한정했습니다. 한 번에 다 옮기면 되돌릴 수 없고, 레거시와 신규를 동시에 운영해야 검증이 됩니다.',
        'MultiRepo 를 MonoRepo 로 합쳤습니다. 공통 코드의 버전 어긋남이 분리 이후 더 커질 것으로 봤습니다.',
        '상태 관리는 Jotai 를 골랐습니다. [숫자/이유: 왜 Redux 가 아니라 Jotai 였는지]',
      ],
      results: [
        '빌드·배포 시간 3분 이상 → 약 10초.',
        '불필요한 코드와 로직을 걷어 코드베이스 25% 이상 축소.',
        '백엔드 인원이 데이터와 로직에 집중하고, 프론트엔드는 UI 와 인터랙션을 맡는 분담이 자리 잡았습니다.',
        '[숫자: 전환한 화면 수 / 전체 화면 수]',
      ],
      retro: [
        '전환 범위를 메인페이지로 한정한 탓에 나머지 화면은 레거시로 남았고, 두 구조를 동시에 유지해야 했습니다. 점진 전환의 대가입니다.',
        '[한계: 다시 한다면 무엇을 다르게 할지 — 예: 전환 순서를 트래픽이 아니라 변경 빈도로 정했을 것]',
      ],
    }),
  },
  {
    key: 'logistics',
    title: '물류 WMS·OMS 구축과 현장 앱',
    date: { start: '2024-11-01', end: '2025-06-30' },
    tech: ['FE', 'React', 'React-Native', 'NEXT.JS', 'GraphQl', 'MongoDB'],
    contribution: 1,
    body: body({
      overview: [
        'OMS·WMS·Admin 프론트엔드 전 영역을 맡고, React Native 로 현장 PDA 앱까지 직접 만들었습니다. API 호출 99% 감소, 배포 원복 시간 50% 단축.',
        'OMS·FE 파트를 리딩했습니다.',
      ],
      problem: [
        'WMS 시스템과 PDA 스캔 앱을 촉박한 일정 안에 파일럿까지 올려야 했습니다.',
        '프론트엔드 인원을 더 뽑을 수 없는 상황이었습니다.',
        '기업 주문 대량 업로드에서 실무자가 진행 상황을 알 수 없어 같은 작업을 반복 실행하는 일이 있었습니다.',
        '[숫자: 당시 팀 규모와 본인 담당 범위]',
      ],
      decisions: [
        '네이티브 대신 React Native 를 골랐습니다. 웹과 코드·인력을 공유해 추가 채용 없이 현장 앱까지 커버하는 것이 목표였습니다.',
        '조회한 데이터를 서버에서 다시 가공하지 않고 클라이언트에서 재배치했습니다. 서버 부하와 왕복 횟수를 함께 줄이는 쪽을 택했습니다.',
        '대량 처리 시간 자체는 줄이지 못한다고 보고, 진행 상태를 실시간으로 표시하는 쪽으로 방향을 바꿨습니다. 체감 문제였지 처리량 문제가 아니었습니다.',
        '배포에 이전 태그로 되돌리는 경로를 만들어 두었습니다. 파일럿 기간에는 되돌리는 속도가 배포 속도보다 중요합니다.',
      ],
      results: [
        '특정 화면 API 호출 99% 감소.',
        '이전 태그를 활용한 원복으로 배포 원복 시간 50% 단축.',
        '추가 개발자 영입 없이 WMS·PDA 를 포함한 프론트 전 영역을 기한 내 완수.',
        '[숫자: 현장 처리 속도 변화 — PDA 앱 도입 전후]',
      ],
      retro: [
        '대량 처리 시간은 끝내 줄이지 못했습니다. UI 로 체감을 개선했을 뿐이라, 처리량 자체는 다음 과제로 남았습니다.',
        '[한계: React Native 선택의 대가 — 네이티브였다면 나았을 지점]',
      ],
    }),
  },
  {
    key: 'agent',
    title: 'TracX AI Agent — Admin 업무 지원 AI',
    date: { start: '2025-10-01', end: '2026-04-30' },
    tech: ['FE', 'BE', 'NEXT.JS', 'typescript', 'openAI'],
    contribution: 1,
    body: body({
      overview: [
        '배송비 관리 Admin 에서 자연어로 묻고, 검색·필터·상세 호출까지 AI 가 직접 실행하게 만들었습니다. RAG 로 도메인 지식을 구조화하고 화면 기능을 Tool 로 정의했습니다.',
        '[숫자: 조회 시간 변화 또는 관련 문의 건수 변화]',
      ],
      problem: [
        '배송 정책·요율·계약 구조가 복잡해, 필요한 값을 찾으려면 메뉴를 여러 단계 탐색해야 했습니다.',
        '숙련도에 따라 같은 정보를 찾는 시간이 크게 달랐습니다.',
        '문의 티켓 Admin 은 공통 요소가 중복돼 기능 하나를 고치는 데 여러 곳을 손봐야 했습니다.',
      ],
      decisions: [
        'RAG 를 골랐습니다. 파인튜닝은 정책이 바뀔 때마다 다시 학습해야 하는데, 배송비 정책은 자주 바뀝니다.',
        '단순 답변형에서 멈추지 않고 화면 기능을 Tool 로 정의했습니다. 값을 읽어 주는 것보다 그 화면을 열어 주는 편이 실제 업무에 닿습니다.',
        'AI 채팅을 iframe 독립 모듈로 만들었습니다. 특정 페이지에 묶이면 다른 Admin 에 붙일 때마다 다시 만들게 됩니다.',
        '질문 패턴을 기준으로 RAG 문서를 다시 정리했습니다. 문서 구조가 답변 품질을 좌우했습니다.',
      ],
      results: [
        '메뉴 탐색 없이 질문만으로 정책·요율 조회가 가능해졌습니다.',
        '검색·필터링·상세 화면 호출까지 AI 가 수행합니다.',
        '문의 티켓 Admin 의 공통 요소를 정리해 관리 포인트를 [숫자: N개 → M개] 로 줄였습니다.',
        '[숫자: 도입 후 조회 시간 또는 문의 감소폭]',
      ],
      retro: [
        '[한계: 지금 이 Agent 가 못 하는 것 — 어떤 질문에서 어긋나는지]',
        'RAG 품질이 곧 답변 품질이었습니다. 모델을 바꾸는 것보다 문서를 다시 쓰는 편이 효과가 컸습니다.',
      ],
    }),
  },
  {
    key: 'platform',
    title: '이커머스 공통 플랫폼과 사내 모듈',
    date: { start: '2014-05-01', end: '2022-06-30' },
    tech: ['FullStack', 'ASP.NET', 'C#', 'jquery', 'MS-SQL', 'javascript'],
    contribution: 1,
    body: body({
      overview: [
        '여러 서비스가 함께 쓰는 사내 모듈과 플랫폼을 만들었습니다. 공통 공유 레이어·Item Picker·Admin Grid 같은 모듈과, 게시판·룰렛·설문 같은 사내 플랫폼입니다.',
        '한 화면이 아니라 여러 팀이 쓰는 것을 만든 이력입니다.',
      ],
      problem: [
        '같은 UI 를 팀마다 따로 만들어 동작과 모양이 조금씩 달랐습니다.',
        '한 곳을 고쳐도 다른 서비스에는 반영되지 않아 같은 버그가 반복됐습니다.',
        '[숫자: 당시 서비스 수 또는 중복 구현 건수]',
      ],
      decisions: [
        '화면마다 만들지 않고 공통 레이어로 올렸습니다. 쓰는 쪽이 늘수록 고치는 비용이 줄어드는 구조를 택했습니다.',
        '[결정: Grid·Item Picker 를 직접 만든 이유 — 외부 라이브러리를 쓰지 않은 근거]',
        'RestFul Dynamic Proxy 로 API 호출 경로를 하나로 모았습니다. [이유: 무엇을 해결하려 했는지]',
      ],
      results: [
        '[숫자: 공통 모듈을 쓰는 서비스 수]',
        '[숫자: 중복 구현 제거로 줄어든 작업량 또는 관리 포인트]',
        '게시판·룰렛·설문 등 사내 플랫폼을 만들어 기획 요청마다 새로 개발하지 않게 했습니다.',
      ],
      retro: [
        '[한계: 공통 모듈의 대가 — 유연성을 잃은 지점, 또는 버전 관리의 어려움]',
        '여러 팀이 쓰는 것을 만들면 요구가 갈립니다. 어디까지 받아 줄지 정하는 일이 개발보다 어려웠습니다.',
      ],
    }),
  },
];

/* ══════════ 실행 ══════════ */

console.log(`Notion 이력 DB 재구성${WRITE ? '' : '  (dry-run)'}\n`);

/** ── ① 속성 ── */
const db = await notion(`/databases/${DB_HISTORY}`);
const hasProp = Boolean(db.properties?.[PROP]);
console.log(`① 속성 "${PROP}" — ${hasProp ? '이미 있음' : '새로 만든다'}`);
if (!hasProp && WRITE) {
  await notion(`/databases/${DB_HISTORY}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { [PROP]: { select: { options: OPTIONS } } } }),
  });
  console.log(`   ✓ 만들었습니다 (${OPTIONS.map((o) => o.name).join(' · ')})`);
}

/** ── ② 기존 46건 분류 ── */
const rows = [];
let cursor;
do {
  const j = await notion(`/databases/${DB_HISTORY}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
  });
  rows.push(...j.results);
  cursor = j.has_more ? j.next_cursor : undefined;
} while (cursor);

const mergedAll = new Set(Object.values(MERGED).flat().map(norm));
const personal = new Set(PERSONAL.map(norm));
const plan = [];
const unknown = [];
for (const r of rows) {
  const t = titleOf(r);
  if (!t) continue;
  const 구분 = mergedAll.has(t) ? '합쳐짐' : personal.has(t) ? '개인' : '연표';
  plan.push({ id: r.id, title: t, 구분 });
  if (구분 === '연표') unknown.push(t);
}

const tally = plan.reduce((a, x) => ((a[x.구분] = (a[x.구분] ?? 0) + 1), a), {});
console.log(`\n② 기존 ${plan.length}건 분류 —`, Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`   연표로 가는 ${unknown.length}건:`);
for (const t of unknown) console.log(`     · ${t.slice(0, 46)}`);

const missing = [...mergedAll, ...personal].filter((t) => !plan.some((x) => x.title === t));
if (missing.length) {
  console.error(`\n✗ 이름이 맞지 않는 항목 ${missing.length}건 — 멈춥니다`);
  for (const m of missing) console.error(`   ${m}`);
  process.exit(1);
}

if (WRITE) {
  let n = 0;
  for (const x of plan) {
    await notion(`/pages/${x.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { [PROP]: { select: { name: x.구분 } } } }),
    });
    n += 1;
  }
  console.log(`   ✓ ${n}건에 구분을 넣었습니다`);
}

/** ── ③ 합본 5건 ── */
console.log(`\n③ 합본 ${NEW_PAGES.length}건 (FitLog 은 이미 손등록으로 있어 제외)`);
for (const np of NEW_PAGES) {
  const dup = rows.find((r) => titleOf(r) === norm(np.title));
  const blanks = JSON.stringify(np.body).match(/\[(숫자|한계|결정|이유)[:/]/g)?.length ?? 0;
  console.log(`   ${dup ? '이미 있음' : '새로 만듦'}  ${np.title.slice(0, 40).padEnd(42)} 채울 자리 ${blanks}곳`);
  if (!dup && WRITE) {
    await notion('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: DB_HISTORY },
        properties: {
          이름: { title: [{ type: 'text', text: { content: np.title } }] },
          기간: { date: np.date },
          기여도: { number: np.contribution },
          기술스택: { multi_select: np.tech.map((name) => ({ name })) },
          [PROP]: { select: { name: '대표' } },
        },
        children: np.body,
      }),
    });
  }
}

if (!WRITE) {
  console.log(`\n※ dry-run 입니다. 실제로 쓰려면:  pnpm notion:restructure -- --write`);
} else {
  console.log(`\n✓ 끝났습니다. 다음:  pnpm fetch:notion → pnpm ingest -- --write`);
}
