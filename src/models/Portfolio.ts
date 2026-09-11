import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/** 이력의 종류. 화면과 tool 이 이 값으로 갈라진다 */
export const PORTFOLIO_KINDS = [
  'profile',
  'experience',
  'project',
  'skill',
  'education',
  'certificate',
  'activity',
  'essay',
] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

export type PortfolioDoc = {
  kind: PortfolioKind;
  /** URL·캐시 키에 쓰는 안정된 식별자 */
  slug: string;
  title: string;
  /** 한두 문장. 챗봇이 인용하고 목록에 노출된다 */
  summary?: string;
  /** 마크다운 전문. 프로젝트는 개요/역할/성과/회고 4단 */
  body?: string;
  company?: string;
  role?: string;
  teamSize?: string;
  /** 기여도 0~1 (프로젝트) */
  contribution?: number;
  /** 분류 — 스킬의 "소프트웨어 / 전문적 지식 / 언어", 활동의 "봉사활동 / 대외활동" */
  category?: string;
  /** 숙련도 0~1 (스킬) */
  level?: number;
  period?: { start?: Date; end?: Date; label?: string };
  techStack: string[];
  highlights: string[];
  links: { label: string; url: string }[];
  images: { url: string; alt?: string }[];
  order: number;
  /**
   * `private` 은 공개 조회 쿼리가 집지 않는다.
   * 급여·개인 연락처·재직 중 내부 정보는 여기로 둔다 —
   * 시스템 프롬프트로만 막으면 언젠가 새 나간다.
   */
  visibility: 'public' | 'private';
  source: { type: 'notion' | 'docx' | 'manual'; id: string; lastEditedAt?: Date };
  /**
   * admin 에서 손으로 고친 값. 원본 필드는 그대로 두고 여기에만 쌓는다 —
   * 문서를 직접 고치면 다음 적재에 지워진다. → lib/overrides.ts
   */
  overrides?: Record<string, unknown>;
  updatedAt?: Date;
  createdAt?: Date;
};

const schema = new Schema<PortfolioDoc>(
  {
    kind: { type: String, required: true, enum: PORTFOLIO_KINDS },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    summary: String,
    body: String,
    company: String,
    role: String,
    teamSize: String,
    contribution: Number,
    category: String,
    level: Number,
    period: {
      start: Date,
      end: Date,
      label: String,
    },
    techStack: { type: [String], default: [] },
    highlights: { type: [String], default: [] },
    links: {
      type: [{ _id: false, label: String, url: String }],
      default: [],
    },
    images: {
      type: [{ _id: false, url: String, alt: String }],
      default: [],
    },
    order: { type: Number, default: 0 },
    visibility: { type: String, required: true, enum: ['public', 'private'], default: 'public' },
    source: {
      /** 재수집 멱등성의 열쇠. (type, id) 로 upsert 한다 */
      type: { type: String, required: true, enum: ['notion', 'docx', 'manual'] },
      id: { type: String, required: true },
      lastEditedAt: Date,
    },
    /** 키는 `lib/overrides.ts` 의 FIELDS 로 제한한다. 스키마는 열어 둔다 */
    overrides: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);

schema.index({ slug: 1 }, { unique: true });
schema.index({ kind: 1, order: 1 });
schema.index({ visibility: 1, kind: 1 });
schema.index({ 'source.type': 1, 'source.id': 1 }, { unique: true });

/** 컬렉션 이름은 `portfolio` 다 — 복수형 `portfolios` 가 아니다 */
export const Portfolio = defineModel<PortfolioDoc>('Portfolio', schema, 'portfolio');
