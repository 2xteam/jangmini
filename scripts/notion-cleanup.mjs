/**
 * Notion 원본을 정리한다.
 *
 *   node scripts/notion-cleanup.mjs            미리보기 (아무것도 바꾸지 않는다)
 *   node scripts/notion-cleanup.mjs --write    실제로 고친다
 *
 * ## 1. 근거 없는 수치를 뺀다
 *
 * "6개 페이지가 쓰던 4개 모듈 페이지를 1개로 줄였습니다" 는 합본 요약에만 있고
 * **거기로 합쳐진 9개 원본 프로젝트 어디에도 없다.** 2026-09 에 같은 모양으로
 * 철회한 "문의 티켓 Admin 관리 포인트를 6개 구역에서 1개로" 와 판박이다.
 * 모듈 5종·플랫폼 4종은 개별 프로젝트가 다 남아 있어 그대로 둔다 — 숫자 하나만
 * 뺀다.
 *
 * ## 2. 제목에 섞인 보이지 않는 공백을 없앤다
 *
 * 줄바꿈 없는 공백(U+00A0)이 제목에 들어가 있어 제목으로 정확히 찾으면 걸리지
 * 않는다. 사람 눈에는 보통 공백과 똑같아서 찾기 어렵다.
 *
 * ## 왜 Notion 을 고치나
 *
 * Notion 이 원본이고 DB·사이트·PDF 는 전부 여기서 나온다. DB 만 고치면 다음
 * 수집에서 조용히 되돌아간다 — 이 저장소에서 여러 번 겪은 함정이다.
 * 고친 뒤에는 `pnpm ingest` 로 다시 수집해야 사이트에 반영된다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

const H = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

async function api(p, init, tries = 3) {
  for (let n = 1; n <= tries; n += 1) {
    try {
      const res = await fetch(`https://api.notion.com/v1${p}`, { ...init, headers: H });
      const json = await res.json();
      if (!res.ok) throw new Error(`${res.status} ${json.message ?? ''}`);
      return json;
    } catch (e) {
      if (n === tries) throw e;
      await new Promise((r) => setTimeout(r, 1200 * n));
    }
  }
}

/** 굵게 표시를 **로 적은 글을 Notion rich_text 로 */
const rich = (t) => {
  const out = [];
  for (const part of String(t).split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = part.startsWith('**') && part.endsWith('**');
    out.push({
      type: 'text',
      text: { content: bold ? part.slice(2, -2) : part },
      ...(bold ? { annotations: { bold: true } } : {}),
    });
  }
  return out;
};

const plain = (b) => (b[b.type]?.rich_text ?? []).map((t) => t.plain_text).join('');

/* ══════════════════ 1. 근거 없는 수치 ══════════════════ */

/**
 * 지울 블록과 고칠 블록.
 *
 * 블록 id 는 scripts/notion-cleanup 조사 때 확인한 것이다. 다시 찾으려면
 * 본문에서 /6개.{0,10}페이지.{0,30}1개/ 로 훑으면 된다.
 */
const DELETE = [
  ['프로젝트 합본 — 이커머스 공통 플랫폼과 사내 모듈', '3dcdca6972b8816aa214eb3dacc1b608'],
];

const REWRITE = [
  [
    'ONE 이력서 — 핵심역량 5번',
    '3f3dca6972b881c7a0a0d523e8142eba',
    '**사내 공통 모듈 5종**(공유 레이어·Item Picker·Admin Grid·Profiler·Dynamic Proxy API)과 ' +
      '**플랫폼 4종**(게시판·룰렛·설문·커뮤니티)을 만들어 팀마다 따로 만들던 화면을 하나로 모았습니다.',
  ],
  [
    'ONE 이력서 — 상세경력 큐텐',
    '3f3dca6972b881f2bf13d95ab5706802',
    '공통 공유 레이어 · Item Picker 레이어를 표준화해 서비스 간 중복 구현을 없앴습니다.',
  ],
  [
    '위존 이력서 — 핵심역량',
    '3f3dca6972b881589668dfe3e8e724ba',
    '공통 모듈·플랫폼으로 팀마다 따로 만들던 화면을 통합',
  ],
];

console.log('━━━ 1. 근거 없는 수치 빼기 ━━━\n');

/**
 * 두 번 돌려도 안전해야 한다. 이미 지운 블록을 다시 지우려 하면
 * "Can't edit block that is archived" 로 **스크립트가 통째로 멈춘다** —
 * 그러면 뒤 단계가 아예 돌지 않는데 겉보기에는 조용히 끝난 것처럼 보인다.
 */
for (const [name, id] of DELETE) {
  let b;
  try {
    b = await api(`/blocks/${id}`);
  } catch {
    console.log(`[이미 지움] ${name}\n`);
    continue;
  }
  if (b.archived || b.in_trash) {
    console.log(`[이미 지움] ${name}\n`);
    continue;
  }
  console.log(`[지움] ${name}`);
  console.log(`   - ${plain(b)}`);
  if (WRITE) {
    await api(`/blocks/${id}`, { method: 'DELETE' });
    console.log('   ✓ 지웠습니다');
  }
  console.log('');
}

for (const [name, id, next] of REWRITE) {
  const b = await api(`/blocks/${id}`);
  const before = plain(b);
  const after = next.replace(/\*\*/g, '');
  if (before === after) {
    console.log(`[이미 됨] ${name}\n`);
    continue;
  }
  console.log(`[고침] ${name}`);
  console.log(`   - ${before}`);
  console.log(`   + ${after}`);
  if (WRITE) {
    await api(`/blocks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [b.type]: { rich_text: rich(next) } }),
    });
    console.log('   ✓ 고쳤습니다');
  }
  console.log('');
}

/* ══════════════════ 1-2. 철회한 수치 훑기 ══════════════════ */

/**
 * 2026-09 에 "근거 없음"으로 철회한 수치들이 어딘가에 남아 있는지 훑는다.
 *
 * ⚠️ **중첩 블록까지 들어가야 한다.** 처음에 최상위 자식만 봤다가
 * "API 호출량 99% 감소" 를 놓쳤다 — 그 줄은 불릿 아래 한 단 들어가 있었고,
 * 조사에서는 "남은 것 없음" 이 나왔는데 DB 에는 멀쩡히 있었다.
 */
const RETRACTED = [
  {
    label: 'API 호출 99% 감소',
    re: /99\s*%\s*(감소|축소|절감)|99프로/,
    /**
     * 불필요한 호출을 걷어낸 것은 사실이고 그 설명도 살려야 한다.
     * 근거가 없는 것은 **99% 라는 수치 하나**다. 문장을 통째로 갈아치우면
     * "잘못된 개발 로직으로 인한 중복 호출" 같은 설명까지 깎인다.
     */
    to: (t) => t.replace(/\s*99\s*%\s*/g, ' ').replace(/\s{2,}/g, ' ').trim(),
  },
  { label: '6개 구역 → 1개', re: /6개\s*구역/, to: null },
  { label: '10배 이상', re: /10배/, to: null },
  { label: '6개 페이지 → 1개', re: /6개.{0,10}페이지.{0,30}1개/, to: null },
];

console.log('━━━ 1-2. 철회한 수치가 남아 있는지 (중첩 블록까지) ━━━\n');

async function sweep(blockId, trail, seen) {
  if (seen.has(blockId)) return 0;
  seen.add(blockId);
  let kids;
  try {
    kids = (await api(`/blocks/${blockId}/children?page_size=100`)).results;
  } catch {
    return 0;
  }
  let n = 0;
  for (const b of kids) {
    const t = plain(b);
    for (const rule of RETRACTED) {
      if (!t || !rule.re.test(t)) continue;
      n += 1;
      const next = typeof rule.to === 'function' ? rule.to(t) : rule.to;
      console.log(`⚠ [${rule.label}] ${trail}`);
      console.log(`   - ${t.slice(0, 170)}`);
      if (next) {
        console.log(`   + ${next.slice(0, 170)}`);
        if (WRITE) {
          await api(`/blocks/${b.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ [b.type]: { rich_text: rich(next) } }),
          });
          console.log('   ✓ 고쳤습니다');
        }
      } else if (WRITE) {
        await api(`/blocks/${b.id}`, { method: 'DELETE' });
        console.log('   ✓ 지웠습니다');
      }
      console.log('');
      break;
    }
    if (b.has_children) n += await sweep(b.id, trail, seen);
  }
  return n;
}

/* ══════════════════ 2. 보이지 않는 공백 ══════════════════ */

console.log('━━━ 2. 제목의 보이지 않는 공백 없애기 ━━━\n');

/** 줄바꿈 없는 공백과 폭 없는 문자들 */
const INVISIBLE = /[   ​‌‍﻿]/g;
const clean = (s) => s.replace(INVISIBLE, (ch) => (/[​‌‍﻿]/.test(ch) ? '' : ' ')).replace(/\s+$/, '');

const pages = [];
let cursor;
do {
  const res = await api('/search', {
    method: 'POST',
    body: JSON.stringify({ filter: { value: 'page', property: 'object' }, page_size: 100, start_cursor: cursor }),
  });
  pages.push(...res.results);
  cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);

console.log(`Notion 페이지 ${pages.length}건을 훑었습니다.\n`);

/** 철회 수치 훑기 — 페이지 목록을 구한 뒤에 돈다 */
let swept = 0;
{
  const seen = new Set();
  for (const p of pages) {
    const prop = Object.values(p.properties ?? {}).find((v) => v?.type === 'title');
    const title = (prop?.title ?? []).map((x) => x.plain_text).join('') || p.id;
    swept += await sweep(p.id, title, seen);
  }
  console.log(swept ? `철회 수치 ${swept}곳\n` : '철회 수치: 남은 것 없음\n');
}

console.log('━━━ 2. 제목의 보이지 않는 공백 ━━━\n');

let fixed = 0;
for (const p of pages) {
  const entry = Object.entries(p.properties ?? {}).find(([, v]) => v?.type === 'title');
  if (!entry) continue;
  const [propName, prop] = entry;
  const segments = prop.title ?? [];
  const before = segments.map((t) => t.plain_text).join('');
  const after = clean(before);
  if (before === after) continue;

  fixed += 1;
  console.log(`[고침] ${before.replace(INVISIBLE, '␣')}`);
  console.log(`     → ${after}`);
  if (WRITE) {
    /** 조각마다 서식을 지키면서 글자만 씻는다 */
    const next = segments
      .map((t) => ({
        type: 'text',
        text: { content: clean(t.plain_text) },
        ...(t.annotations ? { annotations: t.annotations } : {}),
      }))
      .filter((t) => t.text.content !== '');
    await api(`/pages/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { [propName]: { title: next.length ? next : [{ type: 'text', text: { content: after } }] } } }),
    });
    console.log('     ✓');
  }
}
console.log(`\n제목 ${fixed}건`);

console.log('');
if (!WRITE) {
  console.log('※ 미리보기입니다. 실제로 고치려면 --write');
} else {
  console.log('✓ Notion 을 고쳤습니다. 이제 다시 수집해야 사이트에 반영됩니다 — pnpm ingest');
}
