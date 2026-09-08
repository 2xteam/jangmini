/**
 * R2 연결·권한·공개 URL 을 점검한다.
 *
 *   pnpm r2:check
 *
 * **값이 맞아도 토큰이 그 버킷을 못 보면 전부 403 이고, 증상이 조용하다** —
 * FitLog 는 업로드 실패를 삼켜서 값만 저장되고 원본이 비었다.
 * → my-obsidian-vault / 40-Infra/Cloudflare R2.md
 *
 * 판단 기준
 *   ListBuckets 만 403                       정상 (버킷 범위 토큰)
 *   HeadBucket·ListObjects·PutObject 모두 403 토큰이 그 버킷 범위가 아니거나 다른 계정
 *   PutObject 만 403                          읽기 전용 토큰
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

function loadEnv() {
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
}
loadEnv();

const {
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: KEY,
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_BUCKET_NAME: BUCKET,
  R2_PUBLIC_URL: PUBLIC_URL,
} = process.env;

const missing = Object.entries({ ACCOUNT, KEY, SECRET, BUCKET, PUBLIC_URL })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`✗ 빠진 값: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('형식');
const fmt = (label, ok) => console.log(`  ${ok ? '✓' : '✗'} ${label}`);
fmt(`R2_ACCOUNT_ID  32자 hex`, /^[0-9a-f]{32}$/.test(ACCOUNT));
fmt(`R2_ACCESS_KEY_ID  32자 hex`, /^[0-9a-f]{32}$/.test(KEY));
fmt(`R2_SECRET_ACCESS_KEY  64자 hex`, /^[0-9a-f]{64}$/.test(SECRET));
console.log(`  · 버킷      ${BUCKET}`);
console.log(`  · 공개 URL  ${PUBLIC_URL}`);
if (BUCKET !== 'jangmini') {
  console.log(`\n  ! 버킷이 "jangmini" 가 아닙니다. 다른 앱의 .env.local 을 복사하지 않았는지 확인해 주세요.`);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY, secretAccessKey: SECRET },
});

const KEY_NAME = `_healthcheck/${Date.now()}.txt`;
const BODY = 'jangmini r2 healthcheck';
const results = {};

async function step(name, fn) {
  try {
    const r = await fn();
    results[name] = 'ok';
    return r;
  } catch (err) {
    const code = err?.name ?? err?.Code ?? 'Error';
    results[name] = code;
    return null;
  }
}

console.log('\n권한');
await step('HeadBucket', () => s3.send(new HeadBucketCommand({ Bucket: BUCKET })));
const list = await step('ListObjects', () =>
  s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 5 })),
);
await step('PutObject', () =>
  s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: KEY_NAME, Body: BODY, ContentType: 'text/plain' }),
  ),
);

for (const [k, v] of Object.entries(results)) {
  console.log(`  ${v === 'ok' ? '✓' : '✗'} ${k.padEnd(12)} ${v}`);
}

const allDenied = Object.values(results).every((v) => v !== 'ok');
const onlyPut = results.PutObject !== 'ok' && results.HeadBucket === 'ok';

if (allDenied) {
  console.log(
    `\n✗ 셋 다 실패했습니다 — 토큰이 "${BUCKET}" 버킷 범위가 아니거나 다른 계정의 토큰입니다.\n` +
      `  R2 → API 토큰 → Object Read & Write, 대상 버킷을 ${BUCKET} 으로 새로 만들어 주세요.`,
  );
  process.exitCode = 1;
} else if (onlyPut) {
  console.log(`\n✗ 읽기 전용 토큰입니다. Object Read & Write 로 다시 만들어 주세요.`);
  process.exitCode = 1;
}

/* ── 공개 URL 이 이 버킷을 가리키는지 ─────────────────────── */
if (results.PutObject === 'ok') {
  console.log('\n공개 URL');
  const url = `${PUBLIC_URL.replace(/\/$/, '')}/${KEY_NAME}`;
  try {
    const res = await fetch(url);
    const text = res.ok ? (await res.text()).trim() : '';
    if (res.ok && text === BODY) {
      console.log(`  ✓ ${PUBLIC_URL} 이 이 버킷을 가리킵니다`);
    } else if (res.status === 404) {
      console.log(
        `  ✗ 404 — 방금 올린 파일이 이 URL 로 안 보입니다.\n` +
          `    R2_PUBLIC_URL 이 **다른 버킷**의 r2.dev 주소일 수 있습니다.\n` +
          `    ${BUCKET} 버킷 → Settings → Public access 에서 그 버킷의 주소를 확인해 주세요.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`  ✗ HTTP ${res.status} — Public access 가 꺼져 있을 수 있습니다`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.log(`  ✗ 요청 실패: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }

  /** 점검용 오브젝트는 지운다 */
  await step('DeleteObject', () =>
    s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY_NAME })),
  );
  console.log(
    `\n  점검 파일 정리: ${results.DeleteObject === 'ok' ? '완료' : '실패(' + results.DeleteObject + ') — ' + KEY_NAME + ' 을 수동으로 지워 주세요'}`,
  );
}

if (list?.Contents?.length) {
  console.log(`\n버킷에 이미 있는 오브젝트 ${list.KeyCount}개 (최대 5개 표시)`);
  for (const o of list.Contents) console.log(`  ${o.Key}`);
} else if (results.ListObjects === 'ok') {
  console.log('\n버킷이 비어 있습니다 (정상 — 아직 아무것도 올리지 않았습니다)');
}
