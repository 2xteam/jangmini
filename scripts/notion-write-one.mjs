/**
 * ONE Tech Stop 지원용 이력서를 Notion 'ONE' 페이지에 쓴다.
 *
 *   pnpm notion:one            계획만 본다 (dry-run, 기본)
 *   pnpm notion:one -- --write 실제로 쓴다
 *
 * ## 왜 전용 문서인가
 *
 * 리크루터가 **"후보자 입장이 아니라 채용사 인사담당자의 시선으로"** 라고
 * 못 박았다. 일반 이력서는 내가 한 일을 시간순으로 적지만, 이 문서는 JD 의
 * 요건 순서로 다시 세운다. 서류심사는 요건 체크로 시작하기 때문이다.
 *
 * 리크루터가 지정한 것 —
 *   · 첫 페이지에 '핵심역량 및 보유기술' (JD 연관 내용만)
 *   · 상세 경력에 전직장 규모(매출·사원수)와 사업내용
 *   · 최종 연봉(기준연봉, 성과급 제외)과 희망연봉을 구체 수치로
 *   · 이직 사유를 구체적이고 긍정적으로
 *
 * ## 없는 것을 있다고 쓰지 않는다
 *
 * JD 가 요구하는 PostgreSQL · BigQuery · Kafka · ELK · GCP 는 경험이 없다.
 * 숨기지 않고 '인접 경험과 함께' 적는다. 면접 한 번이면 드러나고, 그때
 * 나머지 숫자까지 같이 의심받는다 — 이 저장소에서 "API 호출 99% 감소" 로
 * 한 번 겪었다.
 *
 * 신상·연봉은 `tmp-form/personal.json` (.gitignore) 에서 읽는다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = '3f3dca69-72b8-8025-9dc1-c3f6e71665e8'; // ONE
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

let P;
try {
  P = JSON.parse(readFileSync('tmp-form/personal.json', 'utf8'));
} catch {
  console.error('✗ tmp-form/personal.json 이 없습니다. scripts/forms/README.md 참고.');
  process.exit(1);
}

const PHOTO =
  'https://pub-b6ba1f5f07ef4f8c9be1a32f6beccf5c.r2.dev/profile/profile/1-9bd41f65033a.png';

const H = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

async function notion(p, init) {
  const res = await fetch(`https://api.notion.com/v1${p}`, { ...init, headers: H });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.code ?? ''} ${json.message ?? ''}`);
  return json;
}

/* ── 블록 만들기 ────────────────────────────────── */

function rich(text) {
  const out = [];
  for (const part of String(text).split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = part.startsWith('**') && part.endsWith('**');
    out.push({
      type: 'text',
      text: { content: bold ? part.slice(2, -2) : part },
      ...(bold ? { annotations: { bold: true } } : {}),
    });
  }
  return out.length ? out : [{ type: 'text', text: { content: String(text) } }];
}

const h1 = (t) => ({ object: 'block', type: 'heading_1', heading_1: { rich_text: rich(t) } });
const h2 = (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(t) } });
const h3 = (t) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(t) } });
const p_ = (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(t) } });
const li = (t) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(t) } });
const divider = () => ({ object: 'block', type: 'divider', divider: {} });
const callout = (t, emoji = '📌') => ({
  object: 'block',
  type: 'callout',
  callout: { rich_text: rich(t), icon: { type: 'emoji', emoji } },
});
const quote = (t) => ({ object: 'block', type: 'quote', quote: { rich_text: rich(t) } });

/** 표. 첫 행은 머리글 */
const table = (rows, header = true) => ({
  object: 'block',
  type: 'table',
  table: {
    table_width: rows[0].length,
    has_column_header: header,
    has_row_header: false,
    children: rows.map((cells) => ({
      object: 'block',
      type: 'table_row',
      table_row: { cells: cells.map((c) => rich(c)) },
    })),
  },
});

/* ══════════ 내용 ══════════ */

const C = P.companies;

const blocks = [
  /* ── 이름과 직함 ── 옛 이력서 서식(26pt/18pt 골드)이 여기에 걸린다 */
  h1('장 민'),
  p_('Full Stack Developer'),

  /* ── 인적사항 (첫 장 최상단) ── */
  h2('인 적 사 항'),
  /**
   * 증명사진. Notion 이 보관한 파일은 만료되는 서명 URL 이라 R2 사본을
   * external 로 건다. PDF 변환기가 오른쪽으로 띄워 표가 옆으로 흐른다.
   */
  { object: 'block', type: 'image', image: { type: 'external', external: { url: PHOTO } } },
  /**
   * '지원 포지션' 을 첫 줄에 둔다. 리크루터를 거쳐 가는 문서라 인사담당자
   * 손에 닿을 때 메일 본문과 떨어질 수 있고, 여러 공고를 동시에 돌리는
   * 담당자에게 어느 건인지 한 줄이 실제로 쓸모가 있다. 맨 위 배너로 두면
   * 이력서가 아니라 지원서처럼 보여서 표 안으로 내렸다.
   */
  table([
    ['지원 포지션', 'ONE Tech Stop Pte. Ltd.  /  Web Application 개발 및 운영 (EDI/API Monitoring System)'],
    ['성명', `${P.name} (Jang Min)`],
    ['생년월일', P.birthDotted],
    ['연락처', `${P.phone}  /  2xteam@naver.com`],
    ['주소', P.address ?? '—'],
    ['최종학력', '전주대학교 미디어정보학부 졸업 (2005.03 ~ 2012.02) · 복수전공 문화기술'],
    ['병역', '육군 병장 만기전역 (2006.03 ~ 2008.03)'],
    ['총 경력', '14년 11개월 (풀스택 개발)'],
    ['포트폴리오', 'jangmini.myjane.co.kr'],
  ], false),
  divider(),

  /* ── 1. 핵심역량 (첫 페이지 최상단) ── */
  h2('핵심역량 및 보유기술'),
  p_('채용 공고의 담당업무·자격요건 순서로 정리했습니다.'),

  h3('1. Next.js · TypeScript 기반 레거시 전환과 아키텍처 설계'),
  li('ASP.NET 풀스택 12년을 보낸 뒤 **직접 React·Next.js·TypeScript 전환을 주도**했습니다. 레거시를 아는 사람이 전환을 맡아 무엇을 남기고 버릴지 빠르게 판단했습니다.'),
  li('번들 주입 규칙을 설계해 ASP.NET 페이지가 React 번들을 자동으로 싣게 만들어 **화면 단위 점진 전환**을 가능하게 했습니다. 한 번에 옮기면 되돌릴 수 없고 검증도 되지 않습니다.'),
  li('**빌드·배포 3분 이상에서 약 10초로, 코드베이스 25% 축소.** MultiRepo 를 MonoRepo 로 합쳐 공통 코드의 버전 어긋남을 없앴습니다.'),

  h3('2. 실시간 API 트랜잭션·상태 모니터링 시스템 구축'),
  li('**SignalR 기반 실시간 모니터링 대시보드를 두 차례 설계·개발**했습니다. 배포 상태 모니터링 사이트(2014)와 방송 모니터링·이벤트 전송 시스템(2020)으로, 서버 이벤트를 실시간으로 수집해 화면에 가시화하는 구조입니다.'),
  li('**RESTful Dynamic Proxy API** 를 구축해 클라이언트와 서버의 인터페이스를 단일 경로로 모았습니다. 파라미터 오류를 줄이고 구버전 클라이언트 호환성을 확보했으며, 산발적으로 흩어진 SP·Service 의 관리 포인트를 한곳으로 줄였습니다.'),
  li('React Profiler 를 활용한 **성능 측정 모듈**을 직접 만들어 컴포넌트별 렌더링 시간과 발생 빈도를 계측했고, 과도한 렌더링을 찾아 **페이지 렌더링 1000ms 에서 200ms 로** 개선했습니다.'),

  h3('3. 물류 도메인 · OMS/WMS · 외부 API 연동'),
  li('**OMS·WMS·Admin 프론트엔드 전 영역을 담당**하고 OMS 운영과 FE 파트를 리딩했습니다.'),
  li('인원을 늘릴 수 없는 상황에서 네이티브 대신 **React Native 를 골라 현장 PDA 스캔 앱**까지 직접 개발, 촉박한 일정 안에 파일럿을 완수했습니다. 현장 6명이 동시에 각 2,000건 이상 전송해도 누락 없이 실사를 마쳤습니다.'),
  li('**MongoDB·GraphQL 기반 API** 를 백엔드와 협업해 연동했고, 조회 데이터를 클라이언트에서 재배치해 서버 부하와 왕복 횟수를 함께 줄였습니다.'),

  h3('4. 운영자용 Admin · 모니터링 툴 설계와 AI 적용'),
  li('배송비 관리 Admin 에 **RAG + Tool Calling 기반 AI Agent** 를 구축했습니다. 메뉴 탐색 없이 자연어로 묻고 검색·필터·상세 호출까지 AI 가 직접 실행하며, **운영자 단위 업무 시간이 10분에서 평균 1분 이내**로 줄었습니다.'),
  li('파인튜닝 대신 RAG 를 택한 이유는 배송비 정책이 자주 바뀌기 때문이고, 추출 결과를 그대로 믿지 않도록 **검증 장치를 함께 설계**했습니다.'),
  /**
   * ⚠️ "관리 포인트를 6개 구역에서 1개로" 와 "10배 이상" 은 2026-09 에 근거
   * 없음으로 철회했다. 포트폴리오 어디에도 출처가 없었다. 아래 문구는 Notion
   * 에 들어 있는 것과 **같아야 한다** — 다르면 다시 생성할 때 되살아난다.
   */
  li('문의 티켓 Admin 리팩토링 — 공통 컴포넌트와 constants 를 정리해 중복 코드를 걷어내고, API 별로 중복 관리되던 SP 리스트를 통합했습니다. To·CC·수신자 등 제각각이던 용어도 표준화해 이후 기능 추가·수정 비용을 낮췄습니다.'),
  li('쿼리 튜닝과 데이터 마이그레이션으로 데이터 등록 및 조회 성능을 개선했습니다.'),

  h3('5. CI/CD · 코드 품질 관리 · 팀 리딩'),
  li('**GitHub·Jenkins 기반 배포 파이프라인을 개선**하고, revert commit 대신 이전 태그를 활용한 원복 경로를 만들어 **원복 시간 50% 단축**. 배포 환경을 클라우드 원격 데스크톱으로 이관해 외부에서도 배포 가능하게 했습니다.'),
  /**
   * ⚠️ 5종·4종은 개별 프로젝트가 다 남아 있어 근거가 있다. 뒤에 붙어 있던
   * "6개 페이지가 쓰던 4개 모듈 페이지를 1개로" 는 합본 요약에만 있고 그
   * 안으로 합쳐진 9개 원본 어디에도 없어서 2026-10 에 뺐다.
   */
  li('**사내 공통 모듈 5종**(공유 레이어·Item Picker·Admin Grid·Profiler·Dynamic Proxy API)과 **플랫폼 4종**(게시판·룰렛·설문·커뮤니티)을 만들어 팀마다 따로 만들던 화면을 하나로 모았습니다.'),
  li('**팀장 2년 11개월**(2019.07 ~ 2022.05)로 일정·인력·릴리스를 책임졌고, 이후 FE 파트 리딩을 맡았습니다. FE 팀 로컬 개발 환경을 통합해 팀원이 동일한 환경에서 개발하도록 정비했습니다.'),

  h3('6. 글로벌 환경 경험'),
  li('**글로벌 이커머스 플랫폼에서 12년** 재직하며 다국가 서비스를 전제로 한 개발·운영을 했습니다.'),
  li('호주 어학연수·워킹홀리데이 **1년 체류**(2010.07 ~ 2011.07), **TESOL 취득**(2011.06), 미국 어학연수 1개월. 귀국 후 영어회화 교사로 봉사했습니다.'),

  divider(),

  /* ── 보유기술 ── */
  h2('보유 기술'),
  table([
    ['구분', '보유 기술'],
    ['Languages / Framework', 'TypeScript, JavaScript, Next.js, React, React Native, Node.js, Nest.js, ASP.NET(C#), JSP(Java), jQuery'],
    ['Database', 'MongoDB, MS-SQL (SP·쿼리 튜닝·데이터 마이그레이션), GraphQL'],
    ['Cloud / Infra', 'AWS EC2, Cloudflare R2, Vercel, IIS, Linux'],
    ['DevOps / 형상관리', 'GitHub(GitFlow)·Bitbucket Pipelines, Jenkins, GitHub Actions, MonoRepo, Webpack·Vite·swc·gulp, pnpm'],
    ['모니터링 / 실시간', 'SignalR 기반 실시간 모니터링 대시보드, React Profiler 성능 계측 모듈'],
    ['AI', 'OpenAI API, RAG, Tool Calling, OpenAI Vision'],
    ['협업', 'Jira, Confluence, Notion, Teams'],
  ]),

  divider(),

  /* ── 요건 대비 ── */
  h2('채용 요건 대비 경험'),
  table([
    ['자격요건', '보유 경험'],
    ['Full Stack 개발 약 10년', '14년 11개월 (ASP.NET 풀스택 12년 + React·Next.js 전환 이후 3년)'],
    ['TypeScript, Next.js', '2023년부터 주력. 레거시 전환·Admin·AI Agent 전부 Next.js·TypeScript'],
    ['Nest.js', '개인 프로젝트에서 Nest.js + GraphQL + MongoDB 로 API 서버 구축 (2025)'],
    ['MongoDB', '설로인·트랙스로지스 운영 DB, 개인 서비스 다수'],
    ['PostgreSQL / BigQuery', 'MS-SQL 로 SP 최적화·쿼리 튜닝·대용량 마이그레이션 수행 (PostgreSQL·BigQuery 는 미경험)'],
    ['GCP 또는 AWS', 'AWS EC2 · Cloudflare R2 · Vercel 로 개인 서비스 배포·운영'],
    ['GitHub(GitFlow) · CI/CD', 'Jenkins·GitHub Actions 파이프라인 구축, 태그 기반 배포·원복(원복 시간 50% 단축)'],
    ['코드 품질 · 코드 리뷰', '공통 모듈 5종으로 팀 간 UI·코드 표준화, FE 팀 개발 환경 통합, 팀장 2년 11개월'],
    ['애자일 · 커뮤니케이션', '기획자 부재 상황에서 요구사항 직접 수집·조율(WMS 구축), 타 팀 협의 주도'],
    ['비즈니스 영어', 'TESOL 취득, 호주 1년 체류. 문서·메일 기반 협업 가능, 회화는 업무 적응 기간 필요'],
    ['[우대] EDI/API 모니터링', 'SignalR 실시간 모니터링 대시보드 2건, RESTful Dynamic Proxy API 구축'],
    ['[우대] Kafka · ELK', 'SignalR 기반 실시간 이벤트 수집·중계 모니터링 시스템 2건 구축 (Kafka·ELK 는 미경험)'],
    ['[우대] 해운업 도메인', '이커머스 12년 + 물류(OMS·WMS·배송비·운송) 2년 (해운업은 미경험)'],
  ]),

  divider(),

  /* ── 경력 요약 ── */
  h2('경력 요약'),
  table([
    ['기간', '회사 / 규모', '직급', '역할'],
    ['2025.09 ~ 재직중 (1년 2개월)', `트랙스로지스 — ${C['트랙스로지스'].note}`, '차장', '물류 Admin 개발 · AI Agent 구축'],
    ['2025.07 ~ 2025.08 (2개월)', `허리업코리아(주) — ${C['허리업코리아'].note}`, '—', '풀스택 개발 · FE 전환 POC · Java API 유지보수'],
    ['2024.11 ~ 2025.06 (8개월)', `설로인 — ${C['설로인'].note}`, '매니저', 'OMS·WMS·Admin FE 총괄 · 파트 리딩'],
    ['2012.05 ~ 2024.09 (12년 5개월)', `큐텐테크놀로지 — ${C['큐텐테크놀로지'].note}`, '책임연구원 / 팀장', '글로벌 이커머스 개발·운영 · 레거시 현대화'],
    ['2011.11 ~ 2012.04 (6개월)', `엑스오비스 — ${C['엑스오비스'].note}`, '인턴', '전시용 인터랙티브 프로그램 개발·설치'],
  ]),

  divider(),

  /* ── 상세 경력 ── */
  h2('상세 경력'),

  h3('트랙스로지스 테크팀 / 차장 / 2025.09 ~ 재직중'),
  p_(`**사업내용** 이커머스 물류 3PL · **규모** ${C['트랙스로지스'].note}`),
  li('**AI Agent 구축** — 배송비 정책·요율·계약 구조가 복잡해 필요한 값을 찾으려면 메뉴를 여러 단계 탐색해야 했습니다. RAG 로 도메인 지식을 구조화하고 화면 기능을 Tool 로 정의해, 자연어 질의로 검색·필터·상세 호출까지 AI 가 직접 실행하도록 만들었습니다. **운영자 단위 업무 시간 10분에서 평균 1분 이내.**'),
  li('**모듈 설계** — AI 채팅을 iframe 독립 모듈로 설계해 여러 Admin 화면에 그대로 붙일 수 있는 구조를 확보했습니다.'),
  li('**Admin 구조 개선** — 문의 티켓 Admin 리팩토링. 공통 컴포넌트와 constants 를 정리해 중복 코드를 걷어내고, API 별로 중복 관리되던 SP 리스트를 통합했습니다.'),
  li('**데이터 성능** — 쿼리 튜닝과 데이터 마이그레이션으로 데이터 등록 및 조회 성능을 개선했습니다.'),
  li('**레거시 병행 운영** — 레거시 ASP.NET 과 Next.js 를 함께 운영하며 신규 화면은 Next.js 로 전환하고 있습니다.'),

  /**
   * 2개월 단기. 짧다고 빼면 설로인과 트랙스로지스 사이가 공백으로 남고,
   * 4대보험 이력에 있어 경력증명서 단계에서 드러난다.
   */
  h3('허리업코리아(주) / 2025.07 ~ 2025.08'),
  p_(`**사업내용** 소프트웨어 개발 및 외주(SI) · **규모** ${C['허리업코리아'].note}`),
  li('Qoo10 Japan 서비스 **풀스택 개발** — 화면 개발 및 유지보수'),
  li('기존 화면의 **프론트엔드 전환 작업 POC** 수행 (기술 검증)'),
  li('**Java 기반 endpoint API 유지보수**'),
  li('입사 시 안내받은 사무실 출근 형태가 입사 직후 사내 정책으로 전면 재택으로 전환되어, 2개월 재직 후 개발본부장의 제안을 받아 이직했습니다.'),

  h3('설로인 테크팀 / 매니저 / 2024.11 ~ 2025.06'),
  p_(`**사업내용** 축산 이커머스 및 물류 · **규모** ${C['설로인'].note}`),
  li('**OMS·WMS·Admin 프론트엔드 전 영역 담당**, OMS 운영과 FE 파트 리딩.'),
  li('**현장 앱** — 인원을 늘릴 수 없어 네이티브 대신 React Native 를 선택, WMS PDA 스캔 앱을 직접 개발해 촉박한 일정 안에 파일럿 완수. **현장 6명이 동시에 각 2,000건 이상 전송해도 데이터 누락 없이 실사 완료.**'),
  li('**배포 안정성** — revert commit 방식을 태그 기반 원복으로 바꿔 **원복 시간 50% 단축**. 배포 환경을 클라우드 원격 데스크톱으로 이관해 외부에서도 배포 가능하게 개선.'),
  li('**API 최적화** — 주소록 자동 완성이 매번 전체 목록을 조회하며 페이지를 멈추게 하던 문제를 찾아, 동작하지 않던 로직을 걷어내고 우편번호 누락 건만 조회하도록 수정.'),
  li('**UX** — OMS 기업 주문 대량 업로드에 실시간 진행 상태를 표시해 중복 실행과 대기 불편을 없앴습니다. 처리량이 아니라 체감이 문제라고 판단한 결과입니다.'),
  li('**연동** — MongoDB·GraphQL 기반 API 를 백엔드와 협업해 연동.'),

  h3('큐텐테크놀로지 개발본부 / 책임연구원 · 팀장(2019.07 ~ 2022.05) / 2012.05 ~ 2024.09'),
  p_(`**사업내용** 글로벌 이커머스 플랫폼 · **규모** ${C['큐텐테크놀로지'].note}`),
  p_('**레거시 현대화 (2023 ~ 2024, 티몬 팀)** — 큐텐테크놀로지 소속으로 티몬 인수 후 팀 이동'),
  li('ASP.NET·JSP 기반 화면에 React 개발 환경을 구축하고 FE·BE 를 분리. 번들 주입 규칙을 설계해 화면 단위 점진 전환이 가능하게 했습니다.'),
  li('**빌드·배포 3분 이상에서 약 10초로** 단축 (Maven·gulp 통합, swc 도입).'),
  li('JSP·Vanilla Script 페이지를 Next.js 로 리팩토링해 SSR 도입, **페이지 로딩 1000ms 에서 600ms 로** 단축.'),
  li('React Profiler 기반 성능 계측 모듈 개발, 과도한 렌더링을 찾아 **렌더링 1000ms 에서 200ms 로** 개선.'),
  li('Admin 용 Grid 모듈을 통합해 BE 개발자에게 일관된 UI·UX 제공. MultiRepo 를 MonoRepo 로 전환.'),
  p_('**공통 모듈 · 플랫폼 (2014 ~ 2022)**'),
  li('**RESTful Dynamic Proxy API 구축** — 클라이언트 파라미터 오류를 줄이고 구버전 호환성을 확보, 산발적인 SP·Service 의 관리 포인트를 한곳으로 모았습니다.'),
  li('공통 공유 레이어 · Item Picker 레이어를 표준화해 서비스 간 중복 구현을 없앴습니다.'),
  li('게시판·룰렛·설문조사·커뮤니티 **사내 플랫폼 4종**을 만들어 기획 요청마다 새로 개발하지 않게 했습니다.'),
  li('판매자 광고발송 페이지 리팩토링 — 로그로 사용 여부를 모니터링해 미사용 로직을 확인하고 제거, **코드베이스 25% 이상 축소.**'),
  p_('**실시간 모니터링 · 결제 (2014 ~ 2020)**'),
  li('**SignalR 기반 배포 모니터링 사이트** 개발 — 배포 상태를 실시간으로 수집해 현황을 가시화.'),
  li('**SignalR 기반 방송 모니터링 시스템** 개발 — 모니터링과 디바이스를 분리하고 채팅·이벤트 전송을 실시간 중계해 방송 중 이벤트에 즉시 대응.'),
  li('Qpay QR 결제 온·오프라인 프로세스 구축, BlockChain 기반 코인 선물하기 개발, 바이오 인증 추가.'),
  li('개발 편의를 위한 Visual Studio Extension 을 직접 만들어 긴급 배포 시간과 파일 탐색 시간을 줄였습니다.'),

  h3('엑스오비스 개발연구소 / 인턴 / 2011.11 ~ 2012.04'),
  p_(`**사업내용** 전시 인터랙티브 콘텐츠 개발 · **규모** ${C['엑스오비스'].note}`),
  li('C#·C++·WPF·OpenCV 기반 전시 프로그램을 개발하고 현장에 직접 설치 (용산 전쟁기념관, 창원 민속박물관, 목포 어린이박물관).'),
  li('RS232 컨트롤러·RFID·LED 연동, AR 마커 인식 프로그램을 단독 개발. 서버실 통합 관리 시스템 구축.'),

  divider(),

  /* ── JD 직접 연관 ── */
  h2('EDI / API 모니터링 관련 경험 (JD 직접 연관)'),
  p_('공고의 핵심 담당업무인 모니터링 툴 설계·구축과 직접 맞닿는 경험만 따로 모았습니다.'),
  table([
    ['경험', '시기', '내용'],
    ['SignalR 실시간 배포 모니터링 사이트', '2014.07 ~ 2014.09', '서버 배포 상태를 실시간 수집·가시화하는 웹 애플리케이션 설계·개발'],
    ['SignalR 실시간 방송 모니터링 시스템', '2020.09 ~ 2020.12', '모니터링과 디바이스 분리, 채팅·이벤트 실시간 중계로 즉시 대응 체계 구축'],
    ['RESTful Dynamic Proxy API 구축', '2015.12 ~ 2016.03', '클라이언트·서버 인터페이스 단일화, 파라미터 오류 감소, 구버전 호환성 확보'],
    ['React Profiler 성능 계측 모듈', '2023.10', '컴포넌트별 렌더링 시간·빈도 계측, 렌더링 1000ms 에서 200ms 로 개선'],
    ['배송비 관리 Admin · AI Agent', '2025.10 ~ 2026.04', '운영자용 조회·검색 대시보드 설계, 자연어 질의로 데이터 조회·가시화'],
    ['OMS 대량 업로드 진행 상태 표시', '2024.11', '배치 처리 진행 상황을 실시간 표시해 중복 실행 방지'],
  ]),

  divider(),

  /* ── 학력 · 자격 · 어학 ── */
  h2('학력 · 자격 · 어학 · 병역'),
  table([
    ['구분', '내용'],
    ['학력', '전주대학교 미디어정보학부 졸업 (2005.03 ~ 2012.02) · 복수전공 문화기술 · 학점 4.03/4.5'],
    ['학업 성과', '학부 수석 1회 · 차석 1회 · 장학금 4회 · 한 학기 조기 졸업'],
    ['자격', '정보처리기사(2012.01) · TESOL(2011.06) · 코딩지도사 1급(2021.06)'],
    ['어학', '호주 어학연수 및 워킹홀리데이 1년(2010.07 ~ 2011.07) · 미국 어학연수 1개월(2010.01 ~ 2010.02)'],
    ['병역', '육군 병장 만기전역 (2006.03 ~ 2008.03)'],
  ]),

  divider(),

  /* ── 처우 ── */
  h2('처우 및 이직 사유'),
  table([
    ['구분', '내용'],
    ['최종 연봉 (기준연봉)', `${P.salaryCurrent} · 성과급 없음`],
    ['희망 연봉', `${P.salaryWanted} 이상 또는 협의 가능`],
    ['입사 가능 시기', P.availableFrom],
    ['근무 희망지', '서울 강남 (신논현) · 현 거주지 용인 수지에서 출퇴근 가능'],
  ]),
  h3('이직 사유'),
  /** 이직 사유의 사실 부분은 personal.json 에서 읽는다 — 공개 저장소에 적지 않는다 */
  p_(
    `${C['트랙스로지스'].reason} 이를 계기로 다음 단계를 찾던 중, 국내 이커머스·물류 Admin 에 ` +
      '머물러 있던 경험을 **글로벌 해운 플랫폼의 데이터 연동과 모니터링 영역으로 확장**하고자 ' +
      '지원하게 되었습니다.',
  ),
  h3('지원 동기'),
  p_(
    'ONE Tech Stop 이 맡고 있는 일은 제가 최근 몇 년간 해 온 일과 겹칩니다. 레거시를 Next.js·' +
      'TypeScript 로 옮기는 일, 운영자가 실제로 쓰는 Admin 과 모니터링 화면을 설계하는 일, 그리고 ' +
      '시스템 사이를 오가는 데이터를 실시간으로 가시화하는 일입니다.',
  ),
  p_(
    '특히 차세대 코어 시스템 Chorus 와 3사 통합 플랫폼이라는 과제에 관심이 있습니다. 12년을 한 ' +
      '레거시 안에서 보낸 뒤 그 전환을 직접 맡아 본 사람으로서, 무엇을 남기고 무엇을 버릴지 판단하는 ' +
      '일에 기여할 수 있다고 생각합니다. 한 번에 다 바꾸지 않고 되돌릴 수 있게 옮기는 방식이 큰 ' +
      '시스템일수록 필요하다고 봅니다.',
  ),
  p_(
    '글로벌 협업 환경도 제게는 자연스러운 조건입니다. 글로벌 이커머스 플랫폼에서 12년을 일했고, ' +
      '호주에서 1년을 지내며 TESOL 을 취득했습니다. 해외 개발진과 문서·메일 기반으로 요구사항을 ' +
      '주고받는 일은 바로 가능하며, 회화는 업무 적응 기간에 빠르게 끌어올리겠습니다.',
  ),

];

/* ── 실행 ── */

const existing = (await notion(`/blocks/${PAGE}/children?page_size=5`)).results ?? [];
if (existing.length) {
  console.error(`✗ 'ONE' 페이지에 이미 블록이 ${existing.length}개 이상 있습니다. 덮어쓰지 않습니다.`);
  console.error('  다시 쓰려면 Notion 에서 페이지를 비우고 실행하세요.');
  process.exit(1);
}

console.log(`ONE 전용 이력서를 씁니다${WRITE ? '' : '  (dry-run)'}`);
console.log(`  블록 ${blocks.length}개 · 표 ${blocks.filter((b) => b.type === 'table').length}개`);
console.log(`  절: ${blocks.filter((b) => b.type === 'heading_1' || b.type === 'heading_2').map((b) => b[b.type].rich_text.map((t) => t.text.content).join('')).join(' / ')}`);

if (!WRITE) {
  console.log('\n※ dry-run 입니다. 쓰려면:  pnpm notion:one -- --write');
  process.exit(0);
}

/** Notion 은 한 번에 100블록까지 받는다 */
for (let i = 0; i < blocks.length; i += 90) {
  const chunk = blocks.slice(i, i + 90);
  await notion(`/blocks/${PAGE}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children: chunk }),
  });
  console.log(`  ${Math.min(i + 90, blocks.length)}/${blocks.length}`);
}
console.log('✓ 완료');
