/**
 * 화면 캡쳐를 R2 로 올린다.
 *
 *   pnpm shots:upload <디렉터리> <프리픽스>
 *   pnpm shots:upload tmp-ingest/shots projects/fitlog
 *
 * Notion 에서 온 이미지는 `migrate-images.mjs` 가 옮긴다. 이 스크립트는
 * **손으로 찍은 캡쳐**용이다 — 실환경 URL 을 Chrome 헤드리스로 찍어 둔 파일이나
 * 사용자가 직접 준 PNG.
 *
 * 캡쳐 방법 (파일로 저장된다 — 브라우저 도구는 화면에만 준다):
 *
 *   chrome.exe --headless=new --disable-gpu --hide-scrollbars \
 *     --window-size=1280,900 --virtual-time-budget=9000 \
 *     --screenshot="절대경로.png" "https://…"
 *
 * 키에 내용 해시를 넣어 **같은 그림은 같은 키**가 된다 → 다시 올려도 덮어쓰기
 * 한 번이고, `HeadObject` 로 건너뛴다. 그래서 `immutable` 캐시가 안전하다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

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

const [dir, prefix] = process.argv.slice(2);
if (!dir || !prefix) {
  console.error('사용법: pnpm shots:upload <디렉터리> <프리픽스>');
  console.error('예:     pnpm shots:upload tmp-ingest/shots projects/fitlog');
  process.exit(1);
}

const {
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: KEY,
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_BUCKET_NAME: BUCKET,
  R2_PUBLIC_URL: PUBLIC_URL,
} = process.env;

if (!ACCOUNT || !KEY || !SECRET || !BUCKET || !PUBLIC_URL) {
  console.error('✗ R2_* 환경 변수가 빠졌습니다. pnpm r2:check 로 확인해 주세요.');
  process.exit(1);
}
if (BUCKET !== 'jangmini') {
  console.error(`✗ R2_BUCKET_NAME 이 "${BUCKET}" 입니다. jangmini 여야 합니다.`);
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY, secretAccessKey: SECRET },
});

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const files = readdirSync(dir)
  .filter((f) => TYPES[path.extname(f).toLowerCase()])
  .sort();

if (!files.length) {
  console.error(`✗ ${dir} 에 이미지가 없습니다.`);
  process.exit(1);
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

console.log(`${files.length}장 → ${BUCKET}/${prefix}/\n`);

const results = [];
let up = 0;
let skip = 0;

for (const f of files) {
  const full = path.join(dir, f);
  const buf = readFileSync(full);
  const ext = path.extname(f).toLowerCase();
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  /** 파일명(확장자 제외)을 유지한다 — 어느 화면인지 URL 로 알 수 있게 */
  const base = path.basename(f, ext).replace(/[^a-zA-Z0-9_-]/g, '-');
  const key = `${prefix}/${base}-${hash}${ext}`;

  if (await exists(key)) {
    skip += 1;
  } else {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buf,
        ContentType: TYPES[ext],
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    up += 1;
  }

  const url = `${PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  results.push({ file: f, url });
  console.log(
    `  ${f.padEnd(26)} ${(statSync(full).size / 1024).toFixed(0).padStart(5)}KB  ${skip && !up ? '건너뜀' : ''}`,
  );
  console.log(`    ${url}`);
}

console.log(`\n올림 ${up} · 건너뜀 ${skip}`);
console.log('\nJSON (portfolio.images 에 넣을 형태):');
console.log(JSON.stringify(results.map((r) => ({ url: r.url, alt: '' })), null, 2));
