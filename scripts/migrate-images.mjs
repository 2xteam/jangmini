/**
 * Notion 이미지 → R2 재호스팅.
 *
 *   pnpm images:migrate            계획만 본다 (dry-run, 기본)
 *   pnpm images:migrate -- --write 실제로 올리고 DB 를 갱신한다
 *
 * ## 왜 스냅샷을 못 쓰나
 *
 * `tmp-ingest/bodies.json` 에 담긴 이미지 URL 은 S3 presigned 이고
 * `X-Amz-Expires=3600` 이다. 수집 후 한 시간이 지나면 **403 Forbidden** 이다
 * (2026-09-08 실측: 78분 뒤 403). 그래서 이 스크립트는 페이지마다
 * **Notion 에서 새 URL 을 받아 곧바로 내려받아 올린다.** 받아 두고 나중에
 * 올리는 구조로는 동작하지 않는다.
 *
 * ## 멱등성
 *
 * 키에 내용 해시를 넣는다 — `projects/<slug>/<n>-<hash>.<ext>`.
 * 같은 이미지는 같은 키가 되므로 다시 돌려도 덮어쓰기 한 번이고, 이미 있으면
 * HeadObject 로 건너뛴다. Notion 이 매번 다른 presigned URL 을 주더라도
 * 내용이 같으면 키가 같다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { extractImages } from './lib/notion-md.mjs';

const DB_NAME = 'jangmini';
const NOTION_VERSION = '2022-06-28';
/** Notion 은 초당 약 3회를 권고한다 */
const DELAY_MS = 350;

const WRITE = process.argv.includes('--write');

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
  NOTION_TOKEN,
  MONGO_URI,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_URL,
} = process.env;

const missing = Object.entries({
  NOTION_TOKEN,
  MONGO_URI,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_URL,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`✗ 빠진 환경 변수: ${missing.join(', ')}`);
  process.exit(1);
}
if (R2_BUCKET_NAME !== 'jangmini') {
  console.error(`✗ R2_BUCKET_NAME 이 "${R2_BUCKET_NAME}" 입니다. jangmini 여야 합니다.`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function notionMarkdown(pageId, attempt = 1) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}/markdown`, {
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION },
  });
  if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || attempt * 1500;
    await sleep(wait);
    return notionMarkdown(pageId, attempt + 1);
  }
  if (!res.ok) throw new Error(`Notion ${res.status} — ${pageId}`);
  const json = await res.json();
  return json.markdown ?? '';
}

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

function extFrom(url, contentType) {
  const fromType = EXT_BY_TYPE[(contentType ?? '').split(';')[0].trim().toLowerCase()];
  if (fromType) return fromType;
  /** presigned URL 의 경로에서 확장자를 뽑는다 (쿼리는 버린다) */
  const m = /\.([a-z0-9]{3,4})(?:$|\?)/i.exec(new URL(url).pathname);
  return (m?.[1] ?? 'bin').toLowerCase().replace('jpeg', 'jpg');
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 20000 });
let uploaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

try {
  await client.connect();
  const col = client.db(DB_NAME).collection('portfolio');

  /** Notion 에서 온 것 중 이미지가 있던 문서 */
  const docs = await col
    .find({ 'source.type': 'notion', 'source.imageCount': { $gt: 0 } })
    .project({ slug: 1, title: 1, kind: 1, 'source.id': 1, 'source.imageCount': 1, images: 1 })
    .sort({ kind: 1, order: 1 })
    .toArray();

  /** 루트 프로필 페이지도 포함한다 (imageCount 를 기록하지 않았다) */
  const profile = await col.findOne(
    { kind: 'profile' },
    { projection: { slug: 1, title: 1, kind: 1, 'source.id': 1, images: 1 } },
  );
  if (profile && !docs.some((d) => d.slug === profile.slug)) docs.unshift(profile);

  console.log(`대상 문서 ${docs.length}건${WRITE ? '' : '  (dry-run)'}\n`);

  for (const [i, doc] of docs.entries()) {
    const md = await notionMarkdown(doc.source.id);
    const { images } = extractImages(md);
    const label = `${String(i + 1).padStart(2)}/${docs.length} ${doc.slug.slice(0, 30).padEnd(32)}`;

    if (!images.length) {
      console.log(`${label} 이미지 없음`);
      await sleep(DELAY_MS);
      continue;
    }

    const result = [];
    let up = 0;
    let sk = 0;
    let fa = 0;

    for (const [n, img] of images.entries()) {
      if (!WRITE) {
        result.push({ url: '(dry-run)', alt: img.alt });
        continue;
      }
      try {
        /** presigned URL 은 지금 유효하다. 받자마자 내려받는다 */
        const res = await fetch(img.notionUrl);
        if (!res.ok) throw new Error(`다운로드 ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
        const ext = extFrom(img.notionUrl, contentType);
        const key = `${doc.kind === 'profile' ? 'profile' : 'projects'}/${doc.slug}/${n + 1}-${hash}.${ext}`;

        if (await exists(key)) {
          sk += 1;
        } else {
          await s3.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET_NAME,
              Key: key,
              Body: buf,
              ContentType: contentType.split(';')[0],
              /** 내용 해시가 키에 있으므로 영구 캐시해도 안전하다 */
              CacheControl: 'public, max-age=31536000, immutable',
            }),
          );
          up += 1;
          bytes += buf.length;
        }
        result.push({
          url: `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`,
          alt: img.alt || `${doc.title} 이미지 ${n + 1}`,
        });
      } catch (err) {
        fa += 1;
        console.log(`    ✗ ${n + 1}번 이미지: ${err instanceof Error ? err.message : err}`);
      }
    }

    uploaded += up;
    skipped += sk;
    failed += fa;

    if (WRITE && result.length) {
      await col.updateOne({ slug: doc.slug }, { $set: { images: result, updatedAt: new Date() } });
    }

    console.log(
      `${label} ${images.length}장` +
        (WRITE ? `  → 올림 ${up} · 건너뜀 ${sk}${fa ? ` · 실패 ${fa}` : ''}` : ''),
    );
    await sleep(DELAY_MS);
  }

  console.log('\n─── 요약 ───');
  if (!WRITE) {
    console.log(`  dry-run 입니다. 실제로 올리려면:  pnpm images:migrate -- --write`);
  } else {
    console.log(`  올림 ${uploaded}장 · 건너뜀 ${skipped}장 · 실패 ${failed}장`);
    console.log(`  전송량 ${(bytes / 1024 / 1024).toFixed(1)}MB`);
    const withImages = await col.countDocuments({ 'images.0': { $exists: true } });
    console.log(`  images 가 채워진 문서 ${withImages}건`);
    if (failed) process.exitCode = 1;
  }
} catch (err) {
  console.error('\n✗ 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
