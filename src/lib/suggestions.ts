/**
 * 추천 질문의 **유일한 원본**이다.
 *
 * 랜딩의 빠른 질문 버튼 · 헬퍼 드로어 · `/faq` 페이지가 모두 이 목록을 읽는다.
 * 원본은 세 곳에 각각 다른 문장이 하드코딩돼 있어서, 랜딩에서 누른 질문과
 * 드로어의 질문이 달랐다.
 *
 * ## key 가 왜 필요한가
 *
 * Phase 5 의 답변 캐시가 **이 `key` 로만** 조회한다. 사용자 입력 텍스트를
 * 해시하면 "경력이 어떻게 되나요"와 "경력 어떻게 되세요"가 다른 키가 되어
 * 거의 안 맞고, 반대로 방문자가 조금씩 다른 문장을 던져 캐시 컬렉션을
 * 쓰레기로 채울 수 있다. 그래서 **칩을 누르면 텍스트가 아니라 key 를 보낸다.**
 *
 * key 는 절대 바꾸지 않는다 — 바꾸면 캐시된 답변이 고아가 된다.
 * 문장(`question`)은 얼마든지 다듬어도 된다.
 * → my-obsidian-vault / 50-Plans/D jangmini 구축.md
 */

export type SuggestionCategory = 'me' | 'career' | 'projects' | 'skills' | 'contact';

export type Suggestion = {
  /** 캐시 키. 변경 금지 */
  key: string;
  category: SuggestionCategory;
  question: string;
  /** 랜딩 최상단 버튼으로 노출할지 */
  primary?: boolean;
};

export const SUGGESTIONS: Suggestion[] = [
  /* ── 나 ─────────────────────────────────────────────── */
  { key: 'who-are-you', category: 'me', question: '어떤 개발자인가요?', primary: true },
  { key: 'career-arc', category: 'me', question: '10년 백엔드에서 프론트엔드로 왜 옮겼나요?' },
  { key: 'work-style', category: 'me', question: '일할 때 무엇을 중요하게 보나요?' },

  /* ── 경력 ───────────────────────────────────────────── */
  { key: 'career-summary', category: 'career', question: '경력을 요약해 주세요.', primary: true },
  { key: 'current-role', category: 'career', question: '지금은 어디서 무슨 일을 하나요?' },
  { key: 'team-lead', category: 'career', question: '팀장·PM 경험이 있나요?' },
  { key: 'education', category: 'career', question: '학력과 자격증은 어떻게 되나요?' },

  /* ── 프로젝트 ───────────────────────────────────────── */
  {
    key: 'featured-projects',
    category: 'projects',
    question: '대표 프로젝트를 보여주세요.',
    primary: true,
  },
  { key: 'ai-projects', category: 'projects', question: 'AI 관련 작업은 어떤 게 있나요?' },
  { key: 'react-native', category: 'projects', question: 'React Native로 만든 게 있나요?' },
  { key: 'refactoring', category: 'projects', question: '리팩토링 경험을 알려주세요.' },
  { key: 'side-projects', category: 'projects', question: '사이드 프로젝트는 뭘 했나요?' },

  /* ── 기술 ───────────────────────────────────────────── */
  { key: 'skills', category: 'skills', question: '기술 스택이 어떻게 되나요?', primary: true },
  { key: 'strongest-stack', category: 'skills', question: '가장 자신 있는 기술은 뭔가요?' },
  { key: 'db-experience', category: 'skills', question: 'DB는 어떤 걸 다뤄봤나요?' },

  /* ── 연락 ───────────────────────────────────────────── */
  { key: 'contact', category: 'contact', question: '어떻게 연락하면 되나요?', primary: true },
];

export const CATEGORY_LABEL: Record<SuggestionCategory, string> = {
  me: '소개',
  career: '경력',
  projects: '프로젝트',
  skills: '기술',
  contact: '연락',
};

/** 랜딩 버튼용 — 카테고리별 대표 하나씩 */
export const PRIMARY_SUGGESTIONS = SUGGESTIONS.filter((s) => s.primary);

export const SUGGESTIONS_BY_CATEGORY = (
  Object.keys(CATEGORY_LABEL) as SuggestionCategory[]
).map((category) => ({
  category,
  label: CATEGORY_LABEL[category],
  items: SUGGESTIONS.filter((s) => s.category === category),
}));

export const findSuggestion = (key: string) => SUGGESTIONS.find((s) => s.key === key);
