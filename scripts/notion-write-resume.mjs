/**
 * '신규' 페이지에 이력서 한 장을 쓴다.
 *
 *   pnpm notion:resume            계획만 본다 (dry-run, 기본)
 *   pnpm notion:resume -- --write 실제로 쓴다
 *
 * 왜 한 장인가 — 이 문서는 **인사담당자에게 건네고 PDF 로 뽑는 용도**다.
 * 프로젝트 상세(개요/문제/역할과 결정/결과/회고)는 이력 DB 의 합본 페이지에
 * 있고, 여기에는 **요약과 지표만** 둔다. 2026 기준으로 10년 이상이면 2장까지
 * 괜찮지만 모든 줄이 값을 더할 때만이다.
 *
 * ⚠️ **기존 블록이 있으면 멈춘다.** 덮어쓰지 않는다. 다시 쓰려면 Notion 에서
 * 페이지를 비우고 실행한다.
 *
 * ⚠️ **숫자를 지어내지 않는다.** 확보된 값만 넣고 나머지는 `[숫자: …]` 로
 * 남긴다. 이력서에 지어낸 숫자를 넣으면 면접에서 그대로 무너진다.
 *
 * 경력 절은 수집기가 파싱한다 — `## 경력` 아래 `### 회사명 / 2025.09 ~` 꼴을
 * 지켜야 한다. → scripts/ingest.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = '3dcdca69-72b8-80f8-8dfb-d31c0a6d0db2'; // 신규
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
  if (!res.ok) throw new Error(`${res.status} ${json.code ?? ''} ${json.message ?? ''}`);
  return json;
}

/* ── 블록 만들기 ────────────────────────────────── */

/** `**굵게**` 를 Notion 리치 텍스트로 바꾼다 */
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

const h1 = (t) => ({ object: 'block', type: 'heading_1', heading_1: { rich_text: rich(t) } });
const h2 = (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(t) } });
const h3 = (t) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(t) } });
const p = (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(t) } });
const li = (t) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(t) } });
const divider = () => ({ object: 'block', type: 'divider', divider: {} });
const callout = (t) => ({
  object: 'block',
  type: 'callout',
  callout: { rich_text: rich(t), icon: { type: 'emoji', emoji: '✏️' } },
});
const quote = (t) => ({ object: 'block', type: 'quote', quote: { rich_text: rich(t) } });

/**
 * 좌우 2단.
 *
 * ⚠️ `column_list` 는 오랫동안 API 로 **읽기만** 됐다. 지금은 만들 수 있다
 * (2026-09-15 확인). 컬럼은 **둘 이상**이어야 하고 각 컬럼에 자식이 있어야 한다.
 */
const columns = (...cols) => ({
  object: 'block',
  type: 'column_list',
  column_list: {
    children: cols.map((children) => ({ object: 'block', type: 'column', column: { children } })),
  },
});

/**
 * 사진.
 *
 * Notion 이 갖고 있는 파일은 만료되는 서명 URL 이라 다른 페이지에서 쓸 수 없다.
 * 대신 **R2 로 이관해 둔 사본**을 external 로 건다 — 만료되지 않는 공개 URL 이다.
 */
const PHOTO = 'https://pub-b6ba1f5f07ef4f8c9be1a32f6beccf5c.r2.dev/profile/profile/1-9bd41f65033a.png';
const image = (url) => ({ object: 'block', type: 'image', image: { type: 'external', external: { url } } });

/* ══════════ 내용 ══════════ */

const blocks = [
  callout(
    '**채울 곳이 남아 있습니다.** `[숫자` 로 검색하면 전부 나옵니다. ' +
      '숫자를 모르거나 공개하기 어려우면 그 줄을 통째로 지우세요 — 빈 괄호가 남는 것보다 낫습니다.',
  ),

  /* ── 소개 ── */
  h2('소개'),
  columns(
    [
      p(
        '이커머스와 물류 도메인에서 14년간 웹 시스템을 만들어 온 풀스택 개발자입니다. ' +
          '글로벌 이커머스 플랫폼에서 12년을 보내며 [숫자: 담당 도메인 — 예: 주문·정산] 영역을 맡았고, ' +
          '2019년부터 2년 11개월간 팀장으로 [숫자: 팀 인원]명과 일했습니다. ' +
          '레거시를 현대화하는 일에 강점이 있습니다 — ASP.NET 풀스택 구조를 React·Next.js 로 분리하면서 ' +
          '**빌드·배포를 3분에서 10초로, 코드베이스를 25%** 줄였습니다.',
      ),
      p(
        'ASP.NET·MS-SQL 로 시작해 React·TypeScript·Next.js 로 옮겨 왔고, 물류에서는 React Native 로 ' +
          '현장 PDA 앱을 만들며 OMS·WMS 를 익혔습니다. 한 스택에 오래 머무르기보다 필요한 곳으로 옮겨 온 편입니다.',
      ),
    ],
    [
      image(PHOTO),
      quote('**장민** · Full Stack Developer'),
      p('이커머스 · 물류 · AI'),
      p('[숫자: 이메일 / 연락 수단 — 공개할 것만]'),
    ],
  ),
  p(
    '최근에는 AI 기술을 실제로 쓰는 일에 무게를 두고 있습니다. 새로 나온 기술은 개인 프로젝트로 먼저 ' +
      '만들어 보며 빠르게 제 것으로 만들고, 업무에 들일 때는 어디서 어긋날 수 있는지를 먼저 확인한 뒤 ' +
      '신중하게 도입합니다. OpenAI Vision 으로 건강검진 결과지를 읽는 서비스에서는 추출 정확도를 실제 ' +
      '문서로 측정해 **29개 항목 중 6개**가 틀린 것을 확인했고, 사람이 알아차리도록 검증 장치를 따로 ' +
      '만들었습니다. 반복되고 되돌릴 수 있는 일은 AI 에 맡기되 구조와 판단은 사람이 쥐는 것, ' +
      '그 경계를 정하는 일이 지금 개발자의 몫이라고 봅니다.',
  ),
  p(
    '기술을 대하는 관점도 여기서 나옵니다. 특정 스택을 얼마나 오래 다뤘느냐보다 필요한 영역에 얼마나 ' +
      '빨리 들어갈 수 있느냐가 더 중요해졌다고 생각합니다. AI 기술에 올라타면 익숙하지 않은 언어와 ' +
      '도메인의 벽을 훨씬 빨리 넘을 수 있고, 지금은 기초 스택을 넓히는 것보다 그쪽에 힘을 쏟는 편이 ' +
      '가장 효과적이라고 믿습니다.',
  ),
  p('업무 밖에서는 주기적으로 러닝을 하고 있습니다.'),

  divider(),

  /* ── 경력 ── */
  h2('경력'),

  h3('트랙스로지스 테크팀 / 2025.09 ~'),
  li('이커머스 물류 Admin 의 레거시 ASP.NET 과 Next.js 를 함께 운영하며, 신규 화면은 Next.js 로 전환'),
  li('**RAG + Tool Calling 기반 AI Agent** 를 배송비 관리 Admin 에 구축 — 메뉴 탐색 없이 자연어로 조회하고, 검색·필터·상세 호출까지 AI 가 직접 실행'),
  li('AI 채팅을 **iframe 독립 모듈**로 설계해 여러 Admin 화면에 붙일 수 있는 구조 확보'),
  li('문의 티켓 Admin 의 중복 공통 요소를 정리해 관리 포인트를 [숫자: 정리 전 N개 → 후 M개] 로 축소'),
  li('쿼리 튜닝·데이터 마이그레이션으로 [숫자: 대상 SP·테이블 규모] 처리, [숫자: 응답 시간 개선폭]'),

  h3('설로인 테크팀 / 2024.11 ~ 2025.06'),
  li('OMS·WMS·Admin 프론트엔드 전 영역을 담당하며 **OMS·FE 파트 리딩** — [숫자: 팀 규모] 중 프론트 단독'),
  li('**React Native 기반 PDA 스캔 앱**을 개발해 추가 개발자 영입 없이 WMS 현장 앱까지 커버, 촉박한 일정 안에 파일럿 완수'),
  li('주소록 자동 완성이 매번 전체 목록을 조회하며 페이지를 멈추게 하던 것을 찾아, 동작하지 않던 로직을 걷어내고 우편번호 누락 건만 조회하도록 수정'),
  li('이전 태그를 활용한 원복 경로를 만들어 **배포 원복 시간 50% 단축**'),
  li('OMS 기업 주문 업로드에 실시간 진행 상태를 표시해 대량 처리 중 실무자 대기 경험 개선'),
  li('MongoDB·GraphQL 기반 API 를 백엔드와 협업해 연동'),

  h3('큐텐테크놀로지 개발본부 / 2012.05 ~ 2024.09'),
  li('글로벌 이커머스 플랫폼의 [숫자: 담당 도메인] 영역을 12년간 맡아 [숫자: 담당 서비스·화면 수] 를 설계·개발·운영'),
  li('**팀장 (2019.07 ~ 2022.05, 2년 11개월)** — [숫자: 팀 인원]명 팀의 일정·인력·릴리스를 책임지고, [숫자: 그때 개선한 것과 폭]'),
  li('ASP.NET 풀스택에서 **React·Next.js 전환을 주도** — 빌드·배포 시간 **3분 → 10초**'),
  li('공통 모듈(Grid·Item Picker·공유 레이어)을 만들어 여러 서비스가 함께 쓰게 하고, 불필요한 로직을 걷어 **코드베이스 25% 축소**'),
  li('MultiRepo → MonoRepo 전환과 배포 프로세스 개선으로 **원복 시간 50% 단축**'),
  li('쿼리 튜닝·데이터 마이그레이션·SP 최적화로 [숫자: 대상 규모와 개선폭]'),
  li('프로모션 부정 이용을 초기 단계에서 차단 — 예외 처리 전 약 **10만 건**의 부정 이용 발생'),

  h3('엑스오비스 개발연구소 / 2011.11 ~ 2012.04'),
  li('C#·C++·WPF·OpenCV 기반 **인터랙티브 전시 프로그램**을 개발하고 현장에 직접 설치'),
  li('창원 민속박물관 · 목포 어린이박물관 · 용산 전쟁기념관 등에 납품'),
  li('AR 뷰어, LED 컨트롤러, 영상 플레이어, 방명록 등 전시물별 프로그램을 단독 개발'),

  divider(),

  /* ── 대표 프로젝트 ── */
  h2('대표 프로젝트'),
  p('상세는 포트폴리오 이력 DB 의 각 페이지에 있습니다 — 개요 / 문제 / 나의 역할과 결정 / 결과 / 회고.'),

  h3('레거시 현대화 — ASP.NET 에서 React·Next.js 로'),
  p('큐텐테크놀로지 · 2023–2024 · PM / 일정 조율 · FE 개발'),
  li('**빌드·배포 3분 → 10초** · **코드베이스 25% 축소**'),
  li('번들 주입 규칙을 설계해 화면 단위 점진 전환이 가능하게 했습니다. 한 번에 다 옮기면 되돌릴 수 없습니다'),
  li('MultiRepo 를 MonoRepo 로 합쳐 공통 코드의 버전 어긋남을 없앴습니다'),
  li('ASP.NET · React · Next.js · webpack · MonoRepo'),

  h3('물류 WMS·OMS 구축과 현장 앱'),
  p('설로인 · 2024–2025 · OMS·FE 파트 리드'),
  li('**배포 원복 시간 50% 단축** · 추가 채용 없이 프론트 전 영역 커버'),
  li('네이티브 대신 React Native 를 골라 추가 채용 없이 현장 앱까지 커버했습니다'),
  li('대량 처리 시간은 줄이지 못한다고 보고 진행 상태 표시로 방향을 바꿨습니다 — 체감 문제였지 처리량 문제가 아니었습니다'),
  li('React Native · Next.js · GraphQL · MongoDB'),

  h3('TracX AI Agent — Admin 업무 지원 AI'),
  p('트랙스로지스 · 2025–2026 · 풀스택 개발'),
  li('[숫자: 조회 시간 변화 또는 문의 건수 변화]'),
  li('RAG 를 골랐습니다 — 배송비 정책이 자주 바뀌어 파인튜닝은 매번 다시 학습해야 합니다'),
  li('화면 기능을 Tool 로 정의해 답변에서 멈추지 않고 그 화면을 열어 줍니다'),
  li('RAG · Tool Calling · OpenAI · Next.js'),

  h3('FitLog — 결과지 사진에서 체성분·피검사를 읽어 추이로'),
  p('개인 프로젝트 · 2026 · 1인 (기획 · 설계 · 개발 · 배포)'),
  li('Vision 추출 정확도를 실제 결과지로 측정해 **29개 항목 중 6개 오류**를 확인'),
  li('프롬프트 강화(6→6)와 EXIF 교정(6→5)이 듣지 않는 것을 확인한 뒤, 막는 대신 **잡는 쪽**으로 방향 전환'),
  li('결과지 내부 계산 5종으로 검산하고, 추출 결과를 자동 저장하지 않고 반드시 검토 화면을 거칩니다'),
  li('OpenAI Vision · Next.js · MongoDB · Cloudflare R2'),

  h3('이커머스 공통 플랫폼과 사내 모듈'),
  p('큐텐테크놀로지 · 2014–2022 · 팀장 / 팀원'),
  li('[숫자: 공통 모듈을 쓰는 서비스 수] · [숫자: 중복 구현 제거로 줄어든 작업량]'),
  li('공통 공유 레이어 · Item Picker · Admin Grid 같은 사내 모듈을 만들어 여러 팀이 함께 쓰게 했습니다'),
  li('게시판 · 룰렛 · 설문 같은 사내 플랫폼을 만들어 기획 요청마다 새로 개발하지 않게 했습니다'),
  li('ASP.NET · C# · jQuery · MS-SQL'),

  divider(),

  /* ── 그 외 작업 ── */
  h2('그 외 작업'),
  li('**2026** · 트랙스로지스 — Inquiry Ticket Admin 구조 개선 및 업무 자동화 정비'),
  li('**2023** · 큐텐 — 메인·카테고리·리뷰·베스트상품·이벤트 페이지 유지보수'),
  li('**2021** · 큐텐 — 판매자 광고발송 페이지 리팩토링 (코드베이스 25% 축소)'),
  li('**2020** · 큐텐 — 방송 Monitoring · 커뮤니티 플랫폼 · Coin 선물하기 바이오 인증'),
  li('**2019** · 큐텐 — Qpay QR결제 · 프로젝트앱 하이브리드 메인 · BlockChain coin 선물하기 (MAU 25% 상승)'),
  li('**2018** · 큐텐 — 구매자 중고몰 플랫폼 구축'),
  li('**2017** · 큐텐 — Shopping SNS 광고 플랫폼 (부정 이용 10만 건 차단)'),
  li('**2014** · 큐텐 — VS Extension (WPF) · Deploy Monitoring 사이트'),
  li('**2012–2024** · 큐텐 — 담당 페이지 개발 유지보수 (상시)'),

  divider(),

  /* ── 개인 프로젝트 ── */
  h2('개인 프로젝트'),
  li('**Ignite Architecture** (2026.04–05) — 건축사무소 브랜딩 웹사이트. 기획부터 납품까지'),
  li('**SnapApps** (2026.03) — SnapWord · SnapNote. 사진에서 단어장을 만들고 오답을 정리하는 AI 학습 보조 웹앱'),
  li('**함히보까** (2025.07–08) — 가족과 함께 기획한 목표 달성 스티커 앱'),

  divider(),

  /* ── 기술 · 학력을 좌우로 ── */
  columns(
    [
      h2('기술'),
      li('**Full Stack** — ASP.NET, .NET Framework, C#, MS-SQL, JSP'),
      li('**Front End** — React, TypeScript, Next.js, React Native, Jotai, Recoil, GraphQL, Vite, webpack'),
      li('**AI** — OpenAI API, RAG, Tool Calling, Vision 추출, 정확도 측정·검증 장치'),
      li('**Infra** — AWS EC2, Cloudflare R2, Vercel, GitHub Actions, MongoDB, Linux'),
    ],
    [
      h2('학력 · 자격 · 병역'),
      li('전주대학교 정보시스템학과 졸업'),
      li('코딩지도사 1급 (2021.06)'),
      li('정보처리기사 (2012.11)'),
      li('TESOL (2011.06)'),
      li('육군 만기 제대'),
    ],
  ),
];

/* ══════════ 실행 ══════════ */

console.log(`'신규' 페이지에 이력서를 쓴다${WRITE ? '' : '  (dry-run)'}\n`);

const existing = await notion(`/blocks/${PAGE}/children?page_size=10`);
if ((existing.results ?? []).length) {
  console.error(`✗ 페이지에 블록이 ${existing.results.length}개 이상 있습니다. 덮어쓰지 않습니다.`);
  console.error('  다시 쓰려면 Notion 에서 페이지를 비운 뒤 실행해 주세요.');
  process.exit(1);
}

const marks = JSON.stringify(blocks).match(/\[숫자[:：]/g)?.length ?? 0;
const sections = blocks.filter((b) => b.type === 'heading_2').length;
console.log(`블록 ${blocks.length}개 · 절 ${sections}개 · 채울 자리 ${marks}곳`);
for (const b of blocks.filter((x) => x.type === 'heading_2')) {
  console.log('   ##', b.heading_2.rich_text.map((t) => t.text.content).join(''));
}

if (!WRITE) {
  console.log(`\n※ dry-run 입니다. 실제로 쓰려면:  pnpm notion:resume -- --write`);
  process.exit(0);
}

/** Notion 은 한 번에 100블록까지 받는다 */
for (let i = 0; i < blocks.length; i += 90) {
  const chunk = blocks.slice(i, i + 90);
  await notion(`/blocks/${PAGE}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children: chunk }),
  });
  console.log(`   ✓ ${i + chunk.length}/${blocks.length}`);
}
console.log('\n✓ 다 썼습니다.');
