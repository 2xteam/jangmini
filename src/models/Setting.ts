import { Schema } from 'mongoose';
import { defineModel } from '@/lib/db';

/**
 * key-value 설정. `_id` 가 설정 키다.
 *
 * **한도·모델·킬스위치를 환경 변수에 두지 않는 이유** — Vercel 환경 변수는
 * 그 배포를 만들 때 스냅샷된다. 숫자 하나 바꿀 때마다 재배포해야 한다.
 * 여기 두면 Admin 에서 바꾸고 바로 반영된다.
 * → my-obsidian-vault / 30-Patterns/Vercel 배포 패턴.md
 *
 * 예외가 하나 있다. `CHAT_ENABLED` 는 **환경 변수로 남긴다** — DB 를 못 읽는
 * 상황에서도 채팅이 열리지 않아야 하고, DB 가 뚫렸을 때 설정 한 줄로 과금
 * 경로가 열리면 안 된다.
 */
export type SettingDoc = {
  _id: string;
  value: unknown;
  label: string;
  updatedAt?: Date;
  updatedBy?: string;
};

const schema = new Schema<SettingDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    label: { type: String, required: true },
    updatedBy: String,
  },
  { timestamps: true, _id: false },
);

export const Setting = defineModel<SettingDoc>('Setting', schema, 'settings');

/** 기본값. seed 스크립트와 이 목록이 짝이다 */
export const SETTING_DEFAULTS: { _id: string; value: unknown; label: string }[] = [
  { _id: 'chat.anon.perMinute', value: 3, label: '익명 · 분당 질문 수' },
  { _id: 'chat.anon.perHour', value: 15, label: '익명 · 시간당 질문 수' },
  { _id: 'chat.anon.perDay', value: 30, label: '익명 · 일 질문 수' },
  { _id: 'chat.global.dailyRequests', value: 500, label: '전역 · 일 요청 수 상한' },
  { _id: 'chat.global.dailyTokens', value: 500_000, label: '전역 · 일 토큰 상한' },
  { _id: 'chat.maxUserChars', value: 500, label: '질문 한 개의 글자 수 상한' },
  { _id: 'chat.maxMessages', value: 21, label: '한 요청의 메시지 개수 상한 (약 10턴)' },
  { _id: 'chat.maxOutputTokens', value: 800, label: '답변 토큰 상한' },
  { _id: 'chat.maxSteps', value: 3, label: 'tool 연속 호출 상한' },
  { _id: 'chat.model', value: 'gpt-4o-mini', label: '사용 모델' },
  {
    _id: 'content.sourceVersion',
    value: 1,
    label: '콘텐츠 버전 — 올리면 answers 캐시가 만료된다',
  },
  { _id: 'welcome.enabled', value: true, label: '첫 진입 안내 모달 표시' },
];
