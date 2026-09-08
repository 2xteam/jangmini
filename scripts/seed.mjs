/**
 * 초기 데이터를 넣는다. **몇 번 돌려도 안전하다.**
 *
 *   pnpm seed
 *
 * 넣는 것
 *   settings  기본값 (이미 있는 값은 건드리지 않는다 — 관리자가 바꾼 값을 덮지 않게)
 *   readers   초기 계정 하나
 *
 * ⚠️ 초기 비밀번호를 이 파일에 적지 않는다. `.env.local` 의
 * SEED_READER_PASSWORD 에서 읽는다 — 저장소에 평문 비밀번호를 남기지 않기 위해서다.
 * 저장은 bcrypt 해시로만 한다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

/** src/lib/db.ts 의 DB_NAME 과 같아야 한다. 환경 변수로 받지 않는다 */
const DB_NAME = 'jangmini';

/** src/models/Setting.ts 의 SETTING_DEFAULTS 와 짝이다 */
const SETTING_DEFAULTS = [
  { _id: 'chat.anon.perMinute', value: 3, label: '익명 · 분당 질문 수' },
  { _id: 'chat.anon.perHour', value: 15, label: '익명 · 시간당 질문 수' },
  { _id: 'chat.anon.perDay', value: 30, label: '익명 · 일 질문 수' },
  { _id: 'chat.global.dailyRequests', value: 500, label: '전역 · 일 요청 수 상한' },
  { _id: 'chat.global.dailyTokens', value: 500000, label: '전역 · 일 토큰 상한' },
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

const READER_ID = '2xteam';

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const text = readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        if (process.env[m[1]] !== undefined) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    } catch {
      /* 없으면 넘어간다 */
    }
  }
}

loadEnv();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('✗ MONGO_URI 가 없습니다.');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });

try {
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`✓ 연결됐습니다 (DB: ${DB_NAME})`);

  /* ── settings ─────────────────────────────────────────────
   * value 는 $setOnInsert 다. 관리자가 Admin 에서 바꾼 값을 이 스크립트가
   * 되돌리면 안 된다. label 은 문구가 나아질 수 있으니 $set 으로 갱신한다.
   */
  console.log('\nsettings');
  let inserted = 0;
  for (const s of SETTING_DEFAULTS) {
    const r = await db.collection('settings').updateOne(
      { _id: s._id },
      {
        $setOnInsert: { value: s.value, createdAt: new Date() },
        $set: { label: s.label, updatedAt: new Date() },
      },
      { upsert: true },
    );
    if (r.upsertedCount) inserted += 1;
    const cur = await db.collection('settings').findOne({ _id: s._id });
    console.log(
      `  ${s._id.padEnd(30)} ${String(JSON.stringify(cur.value)).padStart(8)}` +
        (r.upsertedCount ? '  ← 새로 넣음' : '  (기존 값 유지)'),
    );
  }
  console.log(`  총 ${SETTING_DEFAULTS.length}개 중 ${inserted}개 신규`);

  /* ── readers ──────────────────────────────────────────── */
  console.log('\nreaders');
  const existing = await db.collection('readers').findOne({ readerId: READER_ID });
  if (existing) {
    console.log(
      `  ${READER_ID} 이미 있습니다 — 비밀번호를 덮지 않습니다.\n` +
        `    role=${existing.role} enabled=${existing.enabled} ` +
        `expiresAt=${existing.expiresAt ?? '무기한'} dailyCap=${existing.dailyCap}`,
    );
  } else {
    const pw = process.env.SEED_READER_PASSWORD;
    if (!pw) {
      console.error(
        `\n✗ SEED_READER_PASSWORD 가 없습니다.\n` +
          `  .env.local 에 초기 비밀번호를 넣고 다시 실행해 주세요.\n` +
          `  저장소에 평문을 남기지 않기 위해 이 값은 코드에 두지 않습니다.`,
      );
      process.exitCode = 1;
    } else {
      await db.collection('readers').insertOne({
        readerId: READER_ID,
        passwordHash: await bcrypt.hash(pw, 12),
        label: '본인',
        role: 'admin',
        expiresAt: null,
        enabled: true,
        unlimited: true,
        /** 계정이 뚫려도 무한 과금은 막는다 (2026-09-08 결정) */
        dailyCap: 500,
        loginCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`  ${READER_ID} 새로 만들었습니다 (role=admin · 무기한 · dailyCap 500)`);
      if (pw.length < 8) {
        console.log(
          `\n  ! 비밀번호가 ${pw.length}자입니다. 이 계정은 admin 권한과\n` +
            `    무제한 질문 권한을 함께 갖습니다. Admin 의 비밀번호 변경 화면에서\n` +
            `    더 긴 값으로 바꾸는 것을 권합니다.`,
        );
      }
    }
  }

  console.log('\n확인:  pnpm db:check');
} catch (err) {
  console.error('\n✗ 실패했습니다:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
