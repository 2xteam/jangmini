/**
 * 이력 데이터 한 벌을 만든다 — **양식과 무관한 형태**로.
 *
 *   pnpm form:data        tmp-form/data.json 을 새로 쓴다
 *
 * ## 왜 데이터와 양식을 나누는가
 *
 * 지원서 양식은 회사마다 다르고 계속 새로 들어온다. 양식마다 DB 를 다시
 * 뒤지게 두면 같은 값을 여러 곳에서 계산하게 되고, 한 곳만 고치면 나머지가
 * 조용히 낡는다. 그래서 **데이터는 여기 한 곳**에서 만들고, 양식별
 * 스크립트는 그것을 제 칸에 옮겨 적기만 한다.
 *
 * 새 양식이 오면 → scripts/forms/README.md
 *
 * ## 모르는 값은 지어내지 않는다
 *
 * 연봉·주소·이직 사유처럼 사람만 아는 것은 `null` 로 두고, 양식 스크립트가
 * `【직접 입력】` 으로 찍는다. 이력서에 지어낸 값을 넣으면 면접에서 그대로
 * 무너진다 — 이 저장소에서 "API 호출 99% 감소" 로 한 번 겪었다.
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

const DB_NAME = 'jangmini';
const OUT = 'tmp-form/data.json';

/**
 * 신상 정보와 회사 정보는 **저장소 밖**에 둔다.
 *
 * ⚠️ 이 저장소는 **공개**다. 휴대폰 번호·주소·연봉을 코드에 적으면 그대로
 * 공개된다. 그래서 `tmp-form/personal.json` (.gitignore) 에서 읽고, 저장소에는
 * 값이 빈 `personal.example.json` 만 둔다.
 *
 * 처음 쓸 때 —
 *   cp scripts/forms/personal.example.json tmp-form/personal.json
 *
 * 지원서에 손으로 적어 넣은 값(직급·연봉·회사 매출 등)은 **그 파일로 되돌려
 * 둔다.** 그래야 다음 양식이 왔을 때 다시 묻지 않는다.
 */
const PERSONAL_FILE = 'tmp-form/personal.json';
let PERSONAL;
try {
  PERSONAL = JSON.parse(readFileSync(PERSONAL_FILE, 'utf8'));
} catch {
  console.error(
    `✗ ${PERSONAL_FILE} 이 없습니다.
` +
      `  cp scripts/forms/personal.example.json ${PERSONAL_FILE}
` +
      `  으로 만든 뒤 값을 채우세요 (이 파일은 커밋되지 않습니다).`,
  );
  process.exit(1);
}

/**
 * 회사별 한 줄 요약.
 *
 * 양식의 경력 표에는 한 칸에 한 줄만 들어간다. 본문 첫 불릿을 그대로 쓰면
 * 세 줄로 넘쳐 표가 무너진다 — 그래서 짧은 문장을 따로 둔다.
 */
const ONE_LINER = {
  트랙스로지스: '이커머스 물류 Admin 개발 · AI Agent 구축',
  설로인: 'OMS·WMS·Admin 프론트엔드 총괄 · React Native 현장 앱 개발',
  큐텐테크놀로지: '글로벌 이커머스 플랫폼 개발·운영 · 레거시 현대화 주도',
  엑스오비스: '인터랙티브 전시 프로그램 개발 및 현장 설치',
  허리업코리아: 'Qoo10 Japan 프로젝트 풀스택 개발 · FE 전환 POC · Java API 유지보수',
};

/** 회사별 재직 구간. `총 경력` 을 여기서 계산한다 */
const SPANS = [
  ['2011.11', '2012.04'],
  ['2012.05', '2024.09'],
  ['2024.11', '2025.06'],
  /** 2개월 단기. 짧다고 빼면 설로인과 트랙스로지스 사이가 공백으로 남는다 */
  ['2025.07', '2025.08'],
  ['2025.09', '2026.10'],
];

const monthsOf = (a, b) => {
  const [y1, m1] = a.split('.').map(Number);
  const [y2, m2] = b.split('.').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
};

/** `14년 8개월` */
const span = (n) => [Math.floor(n / 12) && `${Math.floor(n / 12)}년`, n % 12 && `${n % 12}개월`]
  .filter(Boolean)
  .join(' ');

const bullets = (body) =>
  (body ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean);

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const col = client.db(DB_NAME).collection('portfolio');

const byKind = async (kind, sort = { order: 1 }) => col.find({ kind }).sort(sort).toArray();

const profile = await col.findOne({ kind: 'profile' });
const experiences = await byKind('experience');
const education = await byKind('education');
const certificates = await byKind('certificate');
const activities = await byKind('activity');
const flagship = await col.find({ kind: 'project', tier: 'flagship' }).sort({ order: 1 }).toArray();

/** 소개 본문. `### 병역` 같은 사이트 전용 절은 뺀다 — 자기소개서에 들어가면 안 된다 */
const intro = (profile?.body ?? '')
  .split(/\n{2,}/)
  .map((p) => p.split('\n').join(' ').replace(/\*\*/g, '').trim())
  .filter(Boolean)
  .filter((p) => !/^#{1,4}\s*(병역|학력|자격)/.test(p));

const totalMonths = SPANS.reduce((n, [a, b]) => n + monthsOf(a, b), 0);

/** 어학연수는 대외활동에서 추린다 */
const study = activities
  .filter((a) => /어학연수|워킹홀리데이/.test(a.title))
  .map((a) => `${a.period?.label ?? ''} ${a.title}`.trim());

const data = {
  generatedAt: new Date().toISOString().slice(0, 10),
  personal: {
    ...PERSONAL,
    birthText: `${PERSONAL.birth.y}년 ${PERSONAL.birth.m}월 ${PERSONAL.birth.d}일`,
    birthDotted: `${PERSONAL.birth.y}. ${String(PERSONAL.birth.m).padStart(2, '0')}. ${String(PERSONAL.birth.d).padStart(2, '0')}`,
    militaryText: `${PERSONAL.military.text} (${PERSONAL.military.from.replace('.', '년 ')}월 ~ ${PERSONAL.military.to.replace('.', '년 ')}월)`,
    email: (profile?.links ?? []).find((l) => /mailto:/.test(l.url ?? ''))?.url?.replace('mailto:', '')
      ?? '2xteam@naver.com',
  },
  career: { totalMonths, totalText: span(totalMonths) },

  /**
   * 핵심역량. 양식마다 "4~6줄" 같은 요구가 있어 **여섯 줄까지** 준비하고
   * 앞에서부터 필요한 만큼 쓴다. 숫자가 든 것을 앞에 둔다 — 6.5초 안에
   * 읽히는 것은 숫자다.
   */
  core: [
    '레거시 현대화 — ASP.NET 풀스택을 React·Next.js 로 분리하는 전환을 주도. 빌드·배포 3분 → 10초, 코드베이스 25% 축소',
    'AI 실무 적용 — RAG + Tool Calling 기반 Admin Agent 를 설계·구축. 운영자 단위 업무 시간 10분 → 평균 1분 이내',
    '이커머스 도메인 12년 — 결제·판매자·프로모션·커뮤니티·상품 전시 영역 27건을 설계·개발·운영',
    '공통화 설계 — 사내 공통 모듈 5종(공유 레이어·Item Picker·Admin Grid 등)과 플랫폼 4종을 만들어 여러 팀이 함께 쓰게 함',
    '물류 도메인 — OMS·WMS·Admin 프론트 전 영역을 담당하고 React Native 로 현장 PDA 앱까지 직접 개발',
    '팀 리딩 — 2019.07 ~ 2022.05(2년 11개월) 팀장으로 일정·인력·릴리스를 책임, 설로인에서 OMS·FE 파트 리딩',
  ],

  /**
   * ⚠️ 학력은 기간이 `period` 가 아니라 **`summary`** 에 들어 있다
   * (이력서 docx 파서가 그렇게 넣는다). `period` 만 보면 빈칸이 나온다.
   */
  education: education.map((e) => ({
    title: e.title,
    period: e.period?.label ?? e.summary ?? null,
    /** 둘 다 전주 소재다. 다른 학교가 생기면 여기에 표를 둔다 */
    place: /전주/.test(e.title) ? '전주' : null,
  })),
  certificates: certificates.map((c) => ({ title: c.title, at: c.period?.label ?? null })),
  study,

  companies: experiences.map((e, i) => {
    const [from, to] = (e.period?.label ?? '').split('~').map((s) => s.trim());
    const idx = SPANS.length - 1 - i;
    const m = SPANS[idx] ? monthsOf(SPANS[idx][0], SPANS[idx][1]) : null;
    return {
      name: e.company,
      dept: e.title.replace(e.company, '').trim() || null,
      from,
      to: to || '현재',
      months: m,
      monthsText: m ? span(m) : null,
      /**
       * 직급과 업종·인원·매출은 DB 에 없다. 지원서를 쓰며 사람이 채운 값을
       * personal.json 에 되돌려 두면 다음 양식부터 자동으로 들어간다.
       */
      rank: PERSONAL.companies?.[e.company]?.rank ?? null,
      oneLiner: ONE_LINER[e.company] ?? null,
      bullets: bullets(e.body),
      note: PERSONAL.companies?.[e.company]?.note ?? null,
    };
  }),

  projects: flagship.map((p) => ({
    title: p.title,
    company: p.company,
    period: p.period?.label ?? null,
    summary: p.summary,
    highlights: (p.highlights ?? []).map((h) => h.replace(/\*\*/g, '').trim()),
  })),

  intro,
};

mkdirSync('tmp-form', { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');

console.log(`→ ${OUT}`);
console.log(`  총 경력 ${data.career.totalText} (${totalMonths}개월)`);
console.log(`  회사 ${data.companies.length} · 대표 프로젝트 ${data.projects.length} · 학력 ${data.education.length} · 자격 ${data.certificates.length}`);
console.log(`  자기소개 ${data.intro.length}문단 · 핵심역량 ${data.core.length}줄`);
const unknown = Object.entries(PERSONAL).filter(([, v]) => v === null).map(([k]) => k);
console.log(`  사람이 채워야 하는 것 ${unknown.length}가지 — ${unknown.join(', ')}`);

await client.close();
