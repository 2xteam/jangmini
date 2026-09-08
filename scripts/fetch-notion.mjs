/**
 * Notion → tmp-ingest/*.json 스냅샷.
 *
 *   pnpm fetch:notion
 *
 * **수집과 정규화를 나눈 이유** — 정규화 규칙은 여러 번 고치게 되는데, 그때마다
 * Notion API 를 다시 때리면 느리고 rate limit 에 걸린다. 스냅샷을 사이에 두면
 * `pnpm ingest` 를 몇 번이든 돌릴 수 있고, 결과가 달라졌을 때 입력이 같았는지
 * 확인할 수 있다. tmp-ingest/ 는 .gitignore 에 있다.
 *
 * ⚠️ 이미지 URL 은 저장하되 **믿지 않는다.** Notion 이 주는 S3 URL 은
 * presigned 이고 `X-Amz-Expires=3600` — 한 시간 뒤 전부 깨진다. 그래서
 * 스냅샷에는 참고용으로만 두고, 실제 사용은 R2 재호스팅 뒤에 한다.
 * → my-obsidian-vault / 10-Projects/jangmini.md
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'tmp-ingest';

/** 루트 포트폴리오 페이지 */
const ROOT_PAGE = '73f9685e-f7da-4368-b724-d8dd83c66a87';
/** 인라인 DB 두 개 */
const DB_HISTORY = '9c8683cb-83bf-4886-8335-09c55eceefd1'; // 포트폴리오 이력
const DB_RESOURCE = '7c7c3a75-9223-47f0-9c99-6213eb333258'; // 포트폴리오 리소스

/**
 * 2022-06-28 을 쓴다. 이 버전에서 databases/{id}/query 가 정상 동작한다.
 * (Notion MCP 의 query-data-source 는 invalid_request_url 로 깨져 있었다.
 *  공개 REST API 는 문제없다 — 2026-09-08 확인)
 */
const NOTION_VERSION = '2022-06-28';

/** Notion 은 초당 약 3회를 권고한다. markdown 을 47번 받으므로 사이를 둔다 */
const DELAY_MS = 350;

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

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error(
    '✗ NOTION_TOKEN 이 없습니다.\n' +
      '  notion.so/my-integrations → 해당 통합 → Internal Integration Secret\n' +
      '  (ntn_ 으로 시작) 을 .env.local 에 넣어 주세요.',
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notion(pathname, init = {}, attempt = 1) {
  const res = await fetch('https://api.notion.com/v1' + pathname, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  /** 429 와 5xx 는 몇 번 다시 시도한다. 한 번 실패로 47건을 버리지 않는다 */
  if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || attempt * 1500;
    console.log(`    ${res.status} — ${wait}ms 뒤 재시도 (${attempt}/4)`);
    await sleep(wait);
    return notion(pathname, init, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${json.code ?? ''} ${json.message ?? ''} — ${pathname}`);
  }
  return json;
}

/** 커서를 따라 전부 받는다. 47건이 100 안에 들어오지만 늘어날 수 있다 */
async function queryAll(databaseId) {
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    const json = await notion(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    out.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
    if (cursor) await sleep(DELAY_MS);
  } while (cursor);
  return out;
}

async function markdown(pageId) {
  const json = await notion(`/pages/${pageId}/markdown`);
  return json.markdown ?? '';
}

function titleOf(page) {
  for (const v of Object.values(page.properties ?? {})) {
    if (v?.type === 'title') return (v.title ?? []).map((t) => t.plain_text).join('');
  }
  return '';
}

mkdirSync(OUT_DIR, { recursive: true });

try {
  console.log('Notion 수집 시작\n');

  /* ── 루트 페이지 ─────────────────────────────────────── */
  process.stdout.write('루트 페이지 … ');
  const rootMd = await markdown(ROOT_PAGE);
  writeFileSync(
    path.join(OUT_DIR, 'root.json'),
    JSON.stringify({ id: ROOT_PAGE, markdown: rootMd }, null, 2),
    'utf8',
  );
  console.log(`${rootMd.length}자`);
  await sleep(DELAY_MS);

  /* ── DB 두 개의 행(속성) ─────────────────────────────── */
  process.stdout.write('포트폴리오 이력 행 … ');
  const historyRows = await queryAll(DB_HISTORY);
  console.log(`${historyRows.length}건`);
  await sleep(DELAY_MS);

  process.stdout.write('포트폴리오 리소스 행 … ');
  const resourceRows = await queryAll(DB_RESOURCE);
  console.log(`${resourceRows.length}건`);
  await sleep(DELAY_MS);

  writeFileSync(
    path.join(OUT_DIR, 'rows-history.json'),
    JSON.stringify(historyRows, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(OUT_DIR, 'rows-resource.json'),
    JSON.stringify(resourceRows, null, 2),
    'utf8',
  );

  /* ── 프로젝트 상세 본문 ──────────────────────────────── */
  console.log(`\n프로젝트 상세 본문 ${historyRows.length}건`);
  const bodies = [];
  let empty = 0;
  for (const [i, row] of historyRows.entries()) {
    const title = titleOf(row) || '(제목 없음)';
    let md = '';
    let error = null;
    try {
      md = await markdown(row.id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (!md) empty += 1;
    bodies.push({
      id: row.id,
      title,
      markdown: md,
      error,
      lastEditedTime: row.last_edited_time,
      url: row.url,
      publicUrl: row.public_url ?? null,
    });
    console.log(
      `  ${String(i + 1).padStart(2)}/${historyRows.length}  ` +
        `${title.slice(0, 38).padEnd(40)} ${error ? '✗ ' + error : md.length + '자'}`,
    );
    await sleep(DELAY_MS);
  }
  writeFileSync(path.join(OUT_DIR, 'bodies.json'), JSON.stringify(bodies, null, 2), 'utf8');

  /* ── 요약 ────────────────────────────────────────────── */
  const failed = bodies.filter((b) => b.error);
  console.log('\n─── 요약 ───');
  console.log(`  루트 페이지        1건`);
  console.log(`  프로젝트 행        ${historyRows.length}건`);
  console.log(`  프로젝트 본문      ${bodies.length - empty}건 (본문 없음 ${empty}건)`);
  console.log(`  스킬 행            ${resourceRows.length}건`);
  if (failed.length) {
    console.log(`\n  ✗ 실패 ${failed.length}건`);
    for (const f of failed) console.log(`    ${f.title} — ${f.error}`);
    process.exitCode = 1;
  }
  console.log(`\n  → ${OUT_DIR}/ 에 저장했습니다`);
  console.log(`  다음:  pnpm ingest`);
} catch (err) {
  console.error('\n✗ 수집 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
