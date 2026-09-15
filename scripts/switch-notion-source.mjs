/**
 * Notion 원본을 **다른 페이지 묶음으로 갈아끼운다.**
 *
 *   pnpm notion:switch            계획만 본다 (dry-run, 기본)
 *   pnpm notion:switch -- --write 실제로 바꾼다
 *
 * ⚠️ **왜 스크립트가 필요한가.**
 *
 * `ingest` 는 `(source.type, source.id)` 로 upsert 한다. Notion 을 복제하면
 * 페이지 id 가 전부 새로 생기므로, 스크립트의 상수만 바꾸면 적재가 기존
 * 문서를 **못 찾고 새로 넣으려 한다.** 그러면 `slug` 유니크 인덱스에 걸려
 * 터지거나, 슬러그까지 새로 매기면 컬렉션이 두 배가 된다.
 *
 * 게다가 문서에는 **Notion 에 없는 것**이 붙어 있다 —
 *
 *   images      R2 로 이관한 링크 (47건). Notion 재수집이 다시 채울 수 있지만
 *               그 사이 화면이 비고, 이관을 다시 돌려야 한다
 *   featured    사람이 고른 대표 8건
 *   overrides   admin 에서 손으로 고친 값
 *   slug        URL. 바뀌면 밖에 나간 링크가 깨진다
 *
 * 그래서 문서를 새로 만들지 않고 **`source.id` 만 갈아끼운다.** 나머지 필드는
 * 손대지 않는다. 옛 id 는 파일로 남겨 되돌릴 수 있게 한다.
 *
 * 짝은 **제목으로** 짓는다. 복제본이라 제목이 같고, 그 밖에 두 묶음을 잇는
 * 안정된 열쇠가 없다. 제목이 겹치거나 한쪽에만 있으면 **그 건은 건드리지
 * 않고 보고만 한다** — 반쯤 바뀐 상태가 가장 나쁘다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const DB_NAME = 'jangmini';
const NOTION_VERSION = '2022-06-28';
const OUT_DIR = 'tmp-ingest';

/* ── 갈아끼울 대상 ─────────────────────────────────────── */

const FROM = {
  root: '73f9685e-f7da-4368-b724-d8dd83c66a87',
  history: '9c8683cb-83bf-4886-8335-09c55eceefd1',
  resource: '7c7c3a75-9223-47f0-9c99-6213eb333258',
};

/** 장민 / 포트폴리오 New (2026-09-15 복제) */
const TO = {
  root: '3dcdca69-72b8-809a-8858-ca809186e6e2',
  history: 'db5dca69-72b8-834d-896c-013f4a82615c',
  resource: '082dca69-72b8-82e2-b3a2-813745afc343',
};

/* ── 환경 ──────────────────────────────────────────────── */

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
const TOKEN = process.env.NOTION_TOKEN;
const URI = process.env.MONGO_URI;

if (!TOKEN) {
  console.error('✗ NOTION_TOKEN 이 없습니다.');
  process.exit(1);
}
if (!URI) {
  console.error('✗ MONGO_URI 가 없습니다.');
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

async function queryAll(databaseId) {
  const out = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''} — ${databaseId}`);
    out.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return out;
}

function titleOf(page) {
  for (const v of Object.values(page.properties ?? {})) {
    if (v?.type === 'title') return (v.title ?? []).map((t) => t.plain_text).join('').trim();
  }
  return '';
}

/** 제목 → 페이지 id. 제목이 겹치면 그 제목을 버린다(어느 쪽인지 알 수 없다) */
function byTitle(rows) {
  const map = new Map();
  const dup = new Set();
  for (const r of rows) {
    const t = titleOf(r);
    if (!t) continue;
    if (map.has(t)) dup.add(t);
    map.set(t, r.id);
  }
  for (const t of dup) map.delete(t);
  return { map, dup: [...dup] };
}

/* ── 짝 짓기 ───────────────────────────────────────────── */

console.log(`Notion 원본 교체${WRITE ? '' : '  (dry-run)'}\n`);

const pairs = new Map(); // 옛 페이지 id → 새 페이지 id
const problems = [];

for (const key of ['history', 'resource']) {
  const [oldRows, newRows] = await Promise.all([queryAll(FROM[key]), queryAll(TO[key])]);
  const a = byTitle(oldRows);
  const b = byTitle(newRows);

  let matched = 0;
  for (const [title, oldId] of a.map) {
    const newId = b.map.get(title);
    if (newId) {
      pairs.set(oldId, newId);
      matched += 1;
    } else {
      problems.push(`${key}: "${title}" 이 새 묶음에 없습니다`);
    }
  }
  for (const title of b.map.keys()) {
    if (!a.map.has(title)) problems.push(`${key}: "${title}" 은 새 묶음에만 있습니다 (적재로 새로 들어옵니다)`);
  }
  for (const t of [...a.dup, ...b.dup]) problems.push(`${key}: 제목이 겹칩니다 — "${t}" (건드리지 않습니다)`);

  console.log(`${key.padEnd(9)} 옛 ${a.map.size} · 새 ${b.map.size} · 짝지음 ${matched}`);
}

/** 루트 페이지는 프로필 문서 하나가 쓴다 */
pairs.set(FROM.root, TO.root);
console.log(`root      1건 (프로필)\n`);

if (problems.length) {
  console.log('─── 확인할 것 ───');
  for (const p of problems) console.log('  !', p);
  console.log('');
}

/* ── DB 반영 ───────────────────────────────────────────── */

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 20000 });
try {
  await client.connect();
  const col = client.db(DB_NAME).collection('portfolio');

  const docs = await col
    .find({ 'source.type': 'notion' })
    .project({ slug: 1, title: 1, 'source.id': 1 })
    .toArray();

  const plan = [];
  const orphan = [];
  for (const d of docs) {
    const next = pairs.get(d.source.id);
    if (next) {
      plan.push({ slug: d.slug, title: d.title, from: d.source.id, to: next });
      continue;
    }
    /*
      경력은 DB 행이 아니라 루트 페이지의 `## 경력` 절을 파싱해서 만든다.
      그래서 id 가 `<루트id>:exp:<회사명>` 꼴이다 — 루트 id 를 **접두사로**
      갖는다. 앞부분만 갈아끼운다.
    */
    if (d.source.id.startsWith(`${FROM.root}:`)) {
      plan.push({
        slug: d.slug,
        title: d.title,
        from: d.source.id,
        to: d.source.id.replace(FROM.root, TO.root),
      });
      continue;
    }
    orphan.push(d);
  }

  console.log(`notion 출처 문서 ${docs.length}건 — 바꿀 것 ${plan.length} · 짝 없음 ${orphan.length}`);
  for (const o of orphan.slice(0, 10)) console.log(`  ! 짝 없음: ${o.slug} (${o.title})`);
  if (orphan.length > 10) console.log(`  … 외 ${orphan.length - 10}건`);

  /*
    새 id 가 **이미 다른 문서에 쓰이고 있으면** 유니크 인덱스에 걸린다.
    바꾸기 전에 본다 — 중간에 터지면 절반만 바뀐 상태가 남는다.
  */
  const taken = await col
    .find({ 'source.type': 'notion', 'source.id': { $in: plan.map((p) => p.to) } })
    .project({ slug: 1, 'source.id': 1 })
    .toArray();
  if (taken.length) {
    console.error(`\n✗ 새 id 가 이미 쓰이고 있습니다 (${taken.length}건). 이미 바꾼 뒤일 수 있습니다.`);
    for (const t of taken.slice(0, 5)) console.error(`   ${t.slug} ← ${t.source.id}`);
    process.exit(1);
  }

  if (!WRITE) {
    console.log(`\n※ dry-run 입니다. 실제로 바꾸려면:  pnpm notion:switch -- --write`);
    process.exit(0);
  }

  /** 되돌릴 수 있게 남긴다 */
  mkdirSync(OUT_DIR, { recursive: true });
  const backup = path.join(OUT_DIR, `source-id-backup-${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify({ FROM, TO, plan }, null, 2), 'utf8');
  console.log(`\n되돌릴 기록: ${backup}`);

  let done = 0;
  for (const p of plan) {
    await col.updateOne({ slug: p.slug }, { $set: { 'source.id': p.to } });
    done += 1;
  }
  console.log(`✓ source.id 를 ${done}건 갈아끼웠습니다.`);
  console.log(`\n다음: scripts/fetch-notion.mjs 의 상수 3개를 새 id 로 바꾸고`);
  console.log(`      pnpm fetch:notion → pnpm ingest -- --write`);
} catch (err) {
  console.error('\n✗ 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close();
}
