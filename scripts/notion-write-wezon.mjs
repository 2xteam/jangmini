/**
 * 위존(Wezon) 지원용 이력서를 Notion '위존' 페이지에 쓴다.
 *
 *   pnpm notion:wezon            계획만 본다 (dry-run, 기본)
 *   pnpm notion:wezon -- --write 실제로 쓴다
 *
 * ## 양식
 *
 * 터닝포인트HR 이 보낸 `성함_회사명_포지션명_터닝포인트HR.docx` 의 절 구성을
 * 그대로 따른다 — 지원분야 / 인적사항 / 학력 / 핵심역량 / 경력 / 상세경력 /
 * 어학·자격 / 기타(처우) / 자기소개서. 회사별로 **이직 사유를 따로** 적게
 * 되어 있는 것이 이 양식의 특징이다.
 *
 * ## ⚠️ 충족하지 못한 필수 요건이 둘 있다
 *
 *   · Python 기반 AI 서비스 설계·개발 — 경험 없음 (TypeScript·Next.js·C#)
 *   · 제조 분야 경험 필수            — 경험 없음 (이커머스·물류)
 *
 * 둘 다 **지어내지 않는다.** 대신 인접한 것(RAG·Tool Calling Agent 설계,
 * 산업용 Admin·모니터링, 물류 현장 시스템)을 앞세운다. 면접 한 번이면
 * 드러나고, 그때 나머지 이력까지 같이 의심받는다.
 *
 * 신상·연봉은 `tmp-form/personal.json` (.gitignore) 에서 읽는다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = '3f3dca69-72b8-8013-bdfb-d19099cf4165'; // 위존
const PHOTO =
  'https://pub-b6ba1f5f07ef4f8c9be1a32f6beccf5c.r2.dev/profile/profile/1-9bd41f65033a.png';

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
const C = P.companies;

const H = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

async function notion(p, init, tries = 3) {
  for (let n = 1; n <= tries; n += 1) {
    try {
      const res = await fetch(`https://api.notion.com/v1${p}`, { ...init, headers: H });
      const json = await res.json();
      if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''}`);
      return json;
    } catch (e) {
      if (n === tries) throw e;
      await new Promise((r) => setTimeout(r, 1200 * n));
    }
  }
}

/* ── 블록 ── */

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

const h2 = (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(t) } });
const h3 = (t) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: rich(t) } });
const p_ = (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(t) } });
const li = (t) => ({
  object: 'block',
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: rich(t) },
});
const divider = () => ({ object: 'block', type: 'divider', divider: {} });
const image = (url) => ({ object: 'block', type: 'image', image: { type: 'external', external: { url } } });
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

/** 사람이 채워야 하는 자리 */
const TODO = '【확인 필요】';

/* ══════════ 내용 ══════════ */

const blocks = [
  /* ── 인적사항 ── */
  h2('인 적 사 항'),
  image(PHOTO),
  table(
    [
      ['지원 분야', '위존(Wezon) / 제조 분야 AI 서비스 기획·아키텍처 설계 및 개발'],
      ['이름', `${P.name} (Jang Min)`],
      ['출생년도', '1986년 05월 04일 (만 40세)'],
      ['주소', '경기도 용인시 수지구 상현동'],
      ['연락처', `${P.phone} / 2xteam@naver.com`],
      ['병역사항', '군필 / 2006.03 ~ 2008.03 / 육군 병장 만기제대'],
    ],
    false,
  ),

  /* ── 학력 ── */
  h2('학 력 사 항'),
  table(
    [
      ['2005.03 ~ 2012.02', '전주대학교(전주) 미디어정보학부 졸업 (복수전공: 문화기술) (학점: 4.03 / 4.5)'],
      ['2002.03 ~ 2005.02', '전주영생고등학교 졸업'],
    ],
    false,
  ),

  /* ── 핵심역량 (JD 기준 4가지) ── */
  h2('핵 심 역 량'),
  li(
    '**AI 서비스 아키텍처 설계 및 Agent 개발** — RAG 와 Tool Calling 으로 사내 Admin 업무를 돕는 AI Agent 를 설계·구축했습니다. ' +
      '자연어 질의로 검색·필터·상세 호출까지 Agent 가 직접 실행하며, 운영자 단위 업무 시간이 10분에서 평균 1분 이내로 줄었습니다.',
  ),
  li(
    '**현업 문제를 AI Use Case 와 기술 아키텍처로 구체화** — 정책·요율 구조가 복잡해 탐색 비용이 큰 문제를 정의하고, ' +
      '파인튜닝 대신 RAG 를 택한 근거(정책 변경 주기)와 오인식을 사람이 알아차리게 하는 검증 장치까지 함께 설계했습니다.',
  ),
  li(
    '**레거시 현대화와 시스템 아키텍처 설계** — ASP.NET 풀스택 구조를 React·Next.js 로 분리하는 전환을 주도해 ' +
      '빌드·배포를 3분에서 10초로, 코드베이스를 25% 줄였습니다. 화면 단위로 점진 전환하도록 번들 주입 규칙을 설계했습니다.',
  ),
  li(
    '**기술조직 리딩 및 유관부서 협업** — 팀장 2년 11개월(2019.07 ~ 2022.05)로 일정·인력·릴리스를 책임졌고, ' +
      '이후 FE 파트를 리딩했습니다. 기획자가 없는 상황에서 요구사항을 직접 수집하고 타 팀과 협의를 주도한 경험이 있습니다.',
  ),

  /* ── 경력 요약 ── */
  h2('경 력 사 항'),
  p_('**총 경력: 14년 11개월**'),
  table([
    ['회사 / 부서', '담당 (직급)', '기간'],
    ['트랙스로지스 / 테크팀', '풀스택 개발 · AI Agent 구축 (차장)', '2025.09 ~ 현재'],
    ['허리업코리아(주) / Qoo10 Japan 프로젝트', '풀스택 개발 · FE 전환 POC · Java API 유지보수', '2025.07 ~ 2025.08'],
    ['설로인 / 테크팀', 'OMS·WMS·Admin FE 개발 · 파트 리딩 (매니저)', '2024.11 ~ 2025.06'],
    ['큐텐테크놀로지 / 개발본부', '풀스택·프론트엔드 개발 (책임연구원 / 팀장)', '2012.05 ~ 2024.09'],
    ['엑스오비스 / 개발연구소', '응용 SW 개발 (인턴)', '2011.11 ~ 2012.04'],
  ]),

  /* ── 상세 경력 ── */
  h2('상 세 경 력 사 항'),

  h3('트랙스로지스  테크팀 / 풀스택 개발 (차장)          2025.09 ~ 현재'),
  p_(`이커머스 물류 3PL / ${C['트랙스로지스'].note}`),
  p_('**주요업무**'),
  li('배송비 관리 Admin 에 RAG + Tool Calling 기반 AI Agent 설계·구축 (도메인 지식 구조화, 화면 기능의 Tool 정의)'),
  li('AI 채팅을 iframe 독립 모듈로 설계해 여러 Admin 화면에 재사용 가능한 구조 확보'),
  li('문의 티켓 Admin 리팩토링 — 공통 컴포넌트·constants 정리, API 별로 중복 관리되던 SP 리스트 통합, 용어 표준화'),
  li('레거시 ASP.NET 과 Next.js 병행 운영, 신규 화면의 Next.js 전환'),
  li('쿼리 튜닝 및 데이터 마이그레이션'),
  p_('**주요성과**'),
  li('메뉴 탐색 없이 자연어 질의만으로 정책·요율 조회가 가능해졌고, **운영자 단위 업무 시간을 10분에서 평균 1분 이내로** 단축'),
  li('파인튜닝이 아닌 RAG 를 택해 정책 변경 때마다 재학습하지 않는 구조 확보. 질문 패턴 기준으로 RAG 문서를 재구성해 답변 품질 개선'),
  li('문의 티켓 Admin 의 관리 포인트를 줄여 이후 기능 추가·수정 비용 절감'),
  p_('**이직 사유**'),
  p_(
    '근무하던 별정 사무실이 철수하며 출퇴근 왕복 시간이 크게 늘어 현재 조건으로는 근무 지속이 어려워졌습니다. ' +
      '이를 계기로, 사내 Admin 수준에서 적용해 온 AI Agent 경험을 **제조·산업 현장의 Enterprise AI 서비스로 확장**하고자 지원합니다.',
  ),

  /**
   * 2개월짜리 단기 재직. 짧고 성과가 없어 빼 두었던 것을 되살렸다 —
   * 설로인(2025.06)과 트랙스로지스(2025.09) 사이가 설명되지 않은 공백으로
   * 남고, 4대보험 이력에 있어 경력증명서 단계에서 드러난다. 두 회사 모두
   * 허위기재를 경고했다. 짧은 재직보다 숨긴 사실이 치명적이다.
   */
  h3('허리업코리아(주)  Qoo10 Japan 프로젝트 / 풀스택 개발          2025.07 ~ 2025.08'),
  p_('소프트웨어 개발 및 외주(SI) 전문 IT 중소기업 / Qoo10 Japan 수주 프로젝트 참여'),
  p_('**주요업무**'),
  li('Qoo10 Japan 서비스 **풀스택 개발** — 화면 개발 및 유지보수'),
  li('기존 화면의 **프론트엔드 전환 작업 POC** 수행 (기술 검증)'),
  li('**Java 기반 endpoint API 유지보수**'),
  p_('**주요성과**'),
  li('프론트엔드 전환의 기술 검증(POC)을 수행했습니다. 근무 형태 변경과 단기 참여가 겹쳐 본 전환까지는 이르지 못했습니다.'),
  p_('**이직 사유**'),
  /**
   * ⚠️ 이 문단의 초점은 **조건 변경**이다. 처음에 "전면 재택이 맞지 않았다" 로
   * 썼더니 개인 성향 문제로 읽혔다 — 2026년에 "재택을 못 견디는 사람" 은
   * 불리하다. 실제로는 입사 때 안내받은 근무 형태가 입사 직후 회사 정책으로
   * 바뀐 것이고, 본인 선택이 아니다. 같은 사실인데 초점이 다르다.
   */
  p_(
    '입사 시 안내받은 근무 형태는 사무실 출근이었으나, 입사 직후 프리랜서 인력의 근무지를 분리한다는 ' +
      '회사 정책이 시행되어 일주일 만에 전면 재택으로 전환되었습니다(기존 인원 포함). 이후 3주간 ' +
      '재택으로만 근무하며 당초 안내받은 조건과 협업 방식이 달라졌다고 판단하던 중, 개발본부장의 ' +
      '제안을 받아 현재 회사로 옮겼습니다.',
  ),

  h3('설로인  테크팀 / OMS·WMS·Admin FE 개발 · 파트 리딩 (매니저)          2024.11 ~ 2025.06'),
  p_(`축산 이커머스 및 물류 / ${C['설로인'].note}`),
  p_('**주요업무**'),
  li('OMS·WMS·Admin 프론트엔드 전 영역 담당, OMS 운영 및 FE 파트 리딩'),
  li('React Native 기반 WMS 현장 PDA 스캔 앱 개발 (기획자 부재 상황에서 요구사항 직접 수집·조율)'),
  li('배포 프로세스 개선 — 태그 기반 배포·원복 체계 도입, 배포 환경을 클라우드 원격 데스크톱으로 이관'),
  li('MongoDB·GraphQL 기반 API 백엔드 협업 연동'),
  p_('**주요성과**'),
  li('인력을 늘리지 않고 네이티브 대신 React Native 를 선택해 **현장 앱까지 포함한 프론트 전 영역을 기한 내 완수**'),
  li('**현장 인원 6명이 동시에 각 2,000건 이상 전송해도 데이터 누락 없이 실사 완료**'),
  li('revert commit 방식을 태그 기반 원복으로 바꿔 **배포 원복 시간 50% 단축**'),
  li('대량 업로드에 실시간 진행 상태를 표시해 중복 실행과 대기 불편 해소 (처리량이 아닌 체감이 문제임을 확인하고 방향 전환)'),
  p_('**이직 사유**'),
  p_(
    '근무지가 군포라 처음부터 통근 거리를 감수하고 입사했으나, 장기간 근무하며 출퇴근에 쓰는 시간이 ' +
      '과도하다고 판단했습니다. 이직을 고려하던 중 이전 직장에서 함께 일했던 개발실장의 제안을 받아 ' +
      '이직했습니다.',
  ),

  h3('큐텐테크놀로지  개발본부 / 풀스택·프론트엔드 개발 (책임연구원 · 팀장)          2012.05 ~ 2024.09'),
  p_(`글로벌 이커머스 플랫폼 / ${C['큐텐테크놀로지'].note}`),
  p_('**주요업무**'),
  li('**팀장 (2019.07 ~ 2022.05, 2년 11개월)** — 일정·인력·릴리스 책임, 결제·판매자·프로모션·커뮤니티 영역 과제 관리'),
  li('ASP.NET·JSP 기반 화면의 React 개발 환경 구축 및 FE·BE 분리, Next.js 전환 (2023 ~ 2024, 티몬 팀)'),
  li('사내 공통 모듈 5종(공유 레이어·Item Picker·Admin Grid·Profiler·Dynamic Proxy API)과 플랫폼 4종(게시판·룰렛·설문·커뮤니티) 설계·개발'),
  li('실시간 모니터링 시스템 2건 — SignalR 기반 배포 모니터링(2014), 방송 모니터링·이벤트 중계(2020)'),
  li('결제 도메인 — Qpay QR 결제 온·오프라인 프로세스, BlockChain 기반 코인 선물하기, 바이오 인증'),
  li('MS-SQL 운영 — SP 최적화, 쿼리 튜닝, 회원 리워드 데이터 마이그레이션'),
  p_('**주요성과**'),
  li('**빌드·배포 시간을 3분 이상에서 약 10초로** 단축 (Maven·gulp 통합, swc 도입), MultiRepo 를 MonoRepo 로 전환'),
  li('판매자 광고발송 페이지 리팩토링에서 로그로 미사용 로직을 확인·제거해 **코드베이스 25% 이상 축소**'),
  li('React Profiler 기반 성능 계측 모듈을 직접 개발해 과도한 렌더링을 찾아 **렌더링 1000ms 에서 200ms 로** 개선'),
  li('JSP·Vanilla Script 페이지를 Next.js 로 전환해 SSR 도입, **페이지 로딩 1000ms 에서 600ms 로** 단축'),
  li('공통 모듈·플랫폼으로 팀마다 따로 만들던 화면을 통합 — 6개 페이지가 쓰던 4개 모듈 페이지를 1개로 축소'),
  p_('**이직 사유**'),
  p_('회사 경영 악화로 조직이 축소되며 퇴사했습니다.'),

  h3('엑스오비스  개발연구소 / 응용 SW 개발 (인턴)          2011.11 ~ 2012.04'),
  p_(`전시 인터랙티브 콘텐츠 개발 / ${C['엑스오비스'].note}`),
  p_('**주요업무**'),
  li('C#·C++·WPF·OpenCV 기반 전시용 인터랙티브 프로그램 개발 및 현장 설치'),
  li('RS232 컨트롤러·RFID 통신·LED 연동, AR 마커 인식 프로그램 단독 개발'),
  li('전시관 서버실 통합 관리 시스템 구축'),
  p_('**주요성과**'),
  li('용산 전쟁기념관 6.25 전쟁관, 창원 민속박물관, 목포 어린이박물관 등 **실제 전시 현장에 납품·설치**'),
  li('하드웨어 제어와 영상·센서 연동을 다루며 현장에서 동작하는 시스템을 끝까지 책임지는 경험 확보'),
  p_('**이직 사유**'),
  p_('교수 추천으로 참여한 단기 프로젝트 계약이 만료되어 퇴사했습니다.'),

  /* ── 어학·자격 ── */
  h2('어학, 수상 및 자격사항'),
  li('TESOL 취득 (2011.06) · 호주 어학연수 및 워킹홀리데이 1년 (2010.07 ~ 2011.07) · 미국 어학연수 (2010.01 ~ 2010.02)'),
  li('정보처리기사 (2012.01) · 코딩지도사 1급 (2021.06)'),
  li('학부 수석 1회 · 차석 1회 · 장학금 4회 수상, 한 학기 조기 졸업'),

  /* ── 기타 (처우) ── */
  h2('기 타 사 항'),
  table(
    [
      ['현재 연봉', `${P.salaryCurrent}`],
      ['희망 연봉', `${P.salaryWanted} 이상 또는 협의 가능 (성과급 별도)`],
      ['현재 직급', '차장'],
      ['희망 직급', '협의'],
      ['입사 시기', '채용 확정 후 4주 이내 (협의 가능)'],
    ],
    false,
  ),

  divider(),

  /* ── 자기소개서 ── */
  h2('자 기 소 개 서'),
  p_(
    '이커머스와 물류 도메인에서 14년간 웹 시스템을 만들어 온 개발자입니다. 한 회사에서 12년을 보냈고, ' +
      '그 안에서 스스로 전환기를 만들었습니다. ASP.NET 풀스택으로 시작해 결제·판매자·프로모션·커뮤니티 영역을 ' +
      '맡았고, 2019년부터 2년 11개월간 팀장으로 일정과 인력을 책임졌습니다. 이후 React·Next.js 전환을 직접 ' +
      '주도해 빌드·배포를 3분에서 10초로, 코드베이스를 25% 줄였습니다. 12년을 그 구조 안에서 보낸 사람이 ' +
      '전환을 맡았다는 점이 제 이력의 중심입니다.',
  ),
  p_(
    '최근 2년은 AI 를 업무에 실제로 붙이는 일에 집중했습니다. 배송비 관리 Admin 에 RAG 와 Tool Calling 기반 ' +
      'Agent 를 구축하면서 가장 어려웠던 것은 모델이 아니라 **경계를 정하는 일**이었습니다. 파인튜닝 대신 RAG 를 ' +
      '택한 것은 정책이 자주 바뀌기 때문이었고, 단순 답변에서 멈추지 않고 화면 기능을 Tool 로 정의한 것은 값을 ' +
      '읽어 주는 것보다 그 화면을 열어 주는 편이 실제 업무에 닿기 때문이었습니다. 결과적으로 운영자의 단위 업무 ' +
      '시간이 10분에서 평균 1분 이내로 줄었습니다. 동시에 AI 가 틀릴 수 있다는 전제로 검증 장치를 함께 만들었습니다. ' +
      '개인 프로젝트에서 OpenAI Vision 으로 건강검진 결과지를 읽을 때는 추출 정확도를 실제 문서로 측정해 29개 항목 ' +
      '중 6개가 틀린 것을 확인하고, 사람이 알아차릴 수 있는 교차 검증을 따로 설계했습니다.',
  ),
  p_(
    '일하는 방식은 세 가지로 요약됩니다. 첫째, 한 번에 다 바꾸지 않습니다. 레거시 전환에서 번들 주입 규칙을 ' +
      '설계해 화면 단위로 옮긴 것도, 배포에 태그 기반 원복 경로를 먼저 만들어 둔 것도 같은 이유입니다. 되돌릴 수 ' +
      '없는 변경은 검증이 되지 않습니다. 둘째, 요구를 그대로 받지 않고 문제를 먼저 정의합니다. 대량 업로드가 ' +
      '느리다는 요구에서 처리량이 아니라 체감이 문제임을 확인하고 진행 상태 표시로 방향을 바꾼 적이 있습니다. ' +
      '셋째, 숫자로 확인하고 넘어갑니다.',
  ),
  p_(
    '위존의 제조 분야 AI 서비스는 제가 해 온 일과 두 지점에서 만납니다. 하나는 현업의 문제를 AI Use Case 와 ' +
      '아키텍처로 구체화하는 일이고, 다른 하나는 운영자가 실제로 쓰는 화면과 시스템을 설계하는 일입니다. ' +
      '다만 **제조 도메인과 Python 기반 개발은 아직 제 경험 밖**입니다. 물류 현장의 WMS·PDA 시스템을 직접 ' +
      '만들며 현장 제약 안에서 동작하는 시스템을 설계해 본 경험, 그리고 익숙하지 않은 영역에 빠르게 들어가 온 ' +
      '이력(ASP.NET에서 React·Next.js 로, 다시 React Native 와 AI 로)이 그 간극을 메우는 근거가 되리라 생각합니다. ' +
      '필요하다면 입사 전부터 Python 기반 AI 스택을 집중적으로 준비하겠습니다.',
  ),
];

/* ── 실행 ── */

const existing = (await notion(`/blocks/${PAGE}/children?page_size=10`)).results ?? [];
const meaningful = existing.filter((b) => {
  const t = (b[b.type]?.rich_text ?? []).map((x) => x.plain_text).join('').trim();
  return t.length > 0 || b.type === 'table' || b.type === 'image';
});
if (meaningful.length) {
  console.error(`✗ '위존' 페이지에 내용이 있습니다 (${meaningful.length}블록). 덮어쓰지 않습니다.`);
  console.error('  다시 쓰려면 Notion 에서 페이지를 비우고 실행하세요.');
  process.exit(1);
}

console.log(`위존 지원용 이력서를 씁니다${WRITE ? '' : '  (dry-run)'}`);
console.log(`  블록 ${blocks.length}개 · 표 ${blocks.filter((b) => b.type === 'table').length}개`);
console.log(`  절: ${blocks.filter((b) => b.type === 'heading_2').map((b) => b.heading_2.rich_text.map((t) => t.text.content).join('')).join(' / ')}`);
console.log(`  ${TODO} 자리 ${JSON.stringify(blocks).split(TODO).length - 1}곳`);

if (!WRITE) {
  console.log('\n※ dry-run 입니다. 쓰려면:  pnpm notion:wezon -- --write');
  process.exit(0);
}

for (let i = 0; i < blocks.length; i += 90) {
  await notion(`/blocks/${PAGE}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children: blocks.slice(i, i + 90) }),
  });
  console.log(`  ${Math.min(i + 90, blocks.length)}/${blocks.length}`);
}
console.log('✓ 완료');
