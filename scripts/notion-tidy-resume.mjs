/**
 * 이력서 Notion 페이지를 PDF 와 비슷하게 정돈한다.
 *
 *   node scripts/notion-tidy-resume.mjs <페이지id> [--write]
 *   pnpm notion:tidy -- --write      세 페이지(ONE·위존·신규) 모두
 *
 * ## 고치는 것
 *
 * 1. **증명사진이 본문 폭을 다 먹는다.** Notion 은 이미지를 기본으로 꽉 채워
 *    그린다. 2단(`column_list`)으로 바꿔 왼쪽에 인적사항 표, 오른쪽 좁은
 *    칸에 사진을 둔다 — PDF 와 같은 배치다. `width_ratio` 는 2024년부터
 *    공개 API 에서 지원한다.
 *
 * 2. **절 사이가 붙어 보인다.** 큰 절(heading_2) 앞에 구분선을 넣는다.
 *    PDF 는 CSS 로 절 제목에 윗선을 긋지만 Notion 에는 그 기능이 없다.
 *
 * ⚠️ **Notion 은 블록을 옮길 수 없다.** 2단으로 바꾸려면 기존 이미지와 표를
 * 지우고 새로 만들어야 한다. 그래서 지우기 전에 표 내용을 먼저 읽어 두고,
 * 새 블록을 만든 뒤에 지운다 — 중간에 끊겨도 내용이 사라지지 않는다.
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
const PAGES = process.argv.filter((a) => /^[0-9a-f-]{32,36}$/.test(a));
const TARGETS = PAGES.length
  ? PAGES
  : [
      ['ONE', '3f3dca69-72b8-8025-9dc1-c3f6e71665e8'],
      ['위존', '3f3dca69-72b8-8013-bdfb-d19099cf4165'],
      ['신규', '3dcdca69-72b8-80f8-8dfb-d31c0a6d0db2'],
    ];

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

const txt = (b) => (b[b.type]?.rich_text ?? []).map((t) => t.plain_text).join('');
const cellsOf = (row) => row.table_row.cells.map((c) => c.map((t) => t.plain_text).join(''));
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
  return out.length ? out : [{ type: 'text', text: { content: String(t) } }];
};

async function tidy(name, PAGE) {
  const kids = (await api(`/blocks/${PAGE}/children?page_size=100`)).results;
  const did = [];

  /* ── 1. 사진을 2단으로 ── */
  const imgIdx = kids.findIndex((b) => b.type === 'image');
  const already = kids.some((b) => b.type === 'column_list');
  if (imgIdx >= 0 && !already) {
    const img = kids[imgIdx];
    const url = img.image?.external?.url ?? img.image?.file?.url;
    /** 사진 바로 다음의 표가 인적사항이다 */
    const tbl = kids.slice(imgIdx + 1).find((b) => b.type === 'table');
    if (url && tbl) {
      const rows = (await api(`/blocks/${tbl.id}/children?page_size=30`)).results.map(cellsOf);
      const width = rows[0].length;
      /** 먼저 만들고 나중에 지운다 — 중간에 끊겨도 내용이 남는다 */
      await api(`/blocks/${PAGE}/children`, {
        method: 'PATCH',
        body: JSON.stringify({
          after: img.id,
          children: [
            {
              object: 'block',
              type: 'column_list',
              column_list: {
                children: [
                  {
                    object: 'block',
                    type: 'column',
                    column: {
                      width_ratio: 0.8,
                      children: [
                        {
                          object: 'block',
                          type: 'table',
                          table: {
                            table_width: width,
                            has_column_header: false,
                            has_row_header: false,
                            children: rows.map((c) => ({
                              object: 'block',
                              type: 'table_row',
                              table_row: { cells: c.map(rich) },
                            })),
                          },
                        },
                      ],
                    },
                  },
                  {
                    object: 'block',
                    type: 'column',
                    column: {
                      width_ratio: 0.2,
                      children: [
                        { object: 'block', type: 'image', image: { type: 'external', external: { url } } },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      await api(`/blocks/${img.id}`, { method: 'DELETE' });
      await api(`/blocks/${tbl.id}`, { method: 'DELETE' });
      did.push('사진 2단 배치');
    }
  }

  /* ── 2. 큰 절 앞에 구분선 ── */
  const fresh = (await api(`/blocks/${PAGE}/children?page_size=100`)).results;
  let added = 0;
  for (const [i, b] of fresh.entries()) {
    if (b.type !== 'heading_2' || i === 0) continue;
    if (fresh[i - 1]?.type === 'divider') continue;
    await api(`/blocks/${PAGE}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ after: fresh[i - 1].id, children: [{ object: 'block', type: 'divider', divider: {} }] }),
    });
    added += 1;
  }
  if (added) did.push(`구분선 ${added}개`);

  console.log(`  ${name}: ${did.length ? did.join(' · ') : '바꿀 것 없음'}`);
}

if (!WRITE) {
  console.log('대상 페이지:', TARGETS.map((t) => (Array.isArray(t) ? t[0] : t)).join(', '));
  console.log('※ dry-run 입니다. 고치려면 -- --write');
  process.exit(0);
}

console.log('이력서 페이지를 정돈합니다');
for (const t of TARGETS) {
  const [name, id] = Array.isArray(t) ? t : ['page', t];
  await tidy(name, id);
}
console.log('✓ 완료');
