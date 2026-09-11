import type { PortfolioDoc, PortfolioKind } from '@/models/Portfolio';

/**
 * 손으로 고친 값을 **원본과 따로** 보관한다.
 *
 * ⚠️ 문서의 필드를 직접 고치면 **다음 `ingest --write` 에 지워진다.**
 * 콘텐츠는 Notion·이력서·손등록 JSON 에서 오고, 적재는 `$set` 으로 문서를
 * 통째로 덮는다. 2026-09-11 에 이관해 둔 이미지 링크 45건이 정확히 그렇게
 * 사라졌다 — 파일은 R2 에 그대로 있었고 문서만 비어 있었다.
 *
 * 그래서 admin 의 편집은 `overrides` 에만 쌓는다.
 *
 *   ingest 가 쓰는 것   문서의 본래 필드 (title, body, …)
 *   admin 이 쓰는 것    overrides.title, overrides.body, …
 *   화면이 보는 것      overrides 가 있으면 그것, 없으면 본래 값
 *
 * `ingest` 는 `overrides` 라는 키를 만들지 않으므로 `$set` 이 건드리지
 * 않는다. 되돌리는 것도 쉽다 — 그 키를 지우면 원본이 다시 보인다.
 *
 * → my-obsidian-vault / 10-Projects/jangmini.md
 */

export type FieldType = 'text' | 'longtext' | 'list' | 'number' | 'bool' | 'select';

export type FieldSpec = {
  /** 문서 경로이자 override 키. 점 표기를 쓴다 (`period.label`) */
  key: string;
  label: string;
  type: FieldType;
  /** 비우면 모든 kind 에 나온다 */
  kinds?: PortfolioKind[];
  options?: string[];
  hint?: string;
};

/**
 * 고칠 수 있는 항목.
 *
 * **이 목록이 유일한 기준이다** — API 의 검증도, 화면의 입력칸도 여기서 온다.
 * 두 곳에 적으면 한쪽만 늘어난다.
 *
 * `slug` 와 `source` 는 일부러 뺐다. 슬러그는 URL 이고 `source` 는 재적재의
 * 열쇠(`source.type` + `source.id` 로 upsert 한다)라, 손으로 바꾸면 같은
 * 문서가 둘로 갈라진다.
 */
export const FIELDS: FieldSpec[] = [
  { key: 'title', label: '제목', type: 'text' },
  { key: 'summary', label: '요약', type: 'text', hint: '한두 문장. 목록과 챗 답변에 쓰인다' },
  { key: 'body', label: '본문', type: 'longtext', hint: '마크다운. 프로젝트는 개요/나의 역할/성과 및 결과/회고' },
  { key: 'company', label: '소속', type: 'text' },
  { key: 'role', label: '역할', type: 'text' },
  { key: 'teamSize', label: '팀 구성', type: 'text' },
  { key: 'period.label', label: '기간 표기', type: 'text', hint: '2026-09 ~ 처럼 화면에 그대로 나온다' },
  {
    key: 'contribution',
    label: '기여도',
    type: 'number',
    kinds: ['project'],
    hint: '0~1. 비우면 화면에 표시하지 않는다',
  },
  { key: 'level', label: '숙련도', type: 'number', kinds: ['skill'], hint: '0~1' },
  { key: 'category', label: '분류', type: 'text', kinds: ['skill', 'activity'] },
  { key: 'techStack', label: '기술 태그', type: 'list', hint: '줄바꿈으로 구분' },
  { key: 'highlights', label: '성과 요점', type: 'list', hint: '줄바꿈으로 구분' },
  { key: 'featured', label: '대표', type: 'bool', kinds: ['project'], hint: '이력서와 목록에서 앞세운다' },
  {
    key: 'visibility',
    label: '공개',
    type: 'select',
    options: ['public', 'private'],
    hint: 'private 은 조회 쿼리가 아예 집지 않는다 — 챗봇도 못 본다',
  },
  { key: 'order', label: '정렬', type: 'number', hint: '작을수록 앞. 프로젝트는 적재할 때 기간순으로 다시 매긴다' },
];

export function fieldsFor(kind: PortfolioKind) {
  return FIELDS.filter((f) => !f.kinds || f.kinds.includes(kind));
}

export const FIELD_KEYS = new Set(FIELDS.map((f) => f.key));

/** 점 표기 경로에서 값을 꺼낸다 */
export function readPath(doc: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, doc);
}

/** 점 표기 경로에 값을 넣는다. 중간 객체가 없으면 만든다 */
function writePath(doc: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== 'object' || cur[part] === null) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export type WithOverrides = PortfolioDoc & {
  featured?: boolean;
  overrides?: Record<string, unknown>;
};

/**
 * 저장된 override 를 원본 위에 얹는다.
 *
 * **조회하는 모든 자리에서 부른다.** 한 군데라도 빠뜨리면 그 화면만 옛 값을
 * 보여주고, 왜 admin 에서 고친 게 반영이 안 되는지 찾기 어려워진다.
 */
export function applyOverrides<T extends WithOverrides | null>(doc: T): T {
  if (!doc || !doc.overrides) return doc;
  const merged = { ...doc } as Record<string, unknown>;
  for (const [key, value] of Object.entries(doc.overrides)) {
    if (!FIELD_KEYS.has(key)) continue;
    writePath(merged, key, value);
  }
  return merged as T;
}
