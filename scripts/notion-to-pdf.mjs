/**
 * Notion 페이지를 인쇄용 HTML 로 뽑고 PDF 로 변환한다.
 *
 *   node scripts/notion-to-pdf.mjs <페이지id> "<출력파일 이름>"
 *   pnpm pdf:one          ONE 이력서를 ~/Downloads 에 PDF 로
 *
 * ## 왜 직접 만드나
 *
 * Notion 의 PDF 내보내기는 브라우저 UI 를 거쳐야 하고, 여백·글꼴·표 폭이
 * 이력서로 쓰기엔 성기다. 블록을 읽어 직접 조판하면 **A4 한 장에 들어가는 양**을
 * 통제할 수 있다. 서류심사는 첫 페이지에서 갈린다.
 *
 * 변환은 Edge 헤드리스(`--print-to-pdf`)를 쓴다. 윈도우에 기본으로 깔려 있고
 * 한글 글꼴을 그대로 쓴다. Word COM 으로도 되지만 표 폭이 자주 깨진다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

const PAGE = (process.argv[2] ?? '3f3dca69-72b8-8025-9dc1-c3f6e71665e8').replace(/-/g, '');
const NAME = process.argv[3] ?? '장민_이력서_ONE';

const H = {
  Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
};

async function api(p) {
  const r = await fetch(`https://api.notion.com/v1${p}`, { headers: H });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${j.message ?? ''}`);
  return j;
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Notion 리치 텍스트 → HTML. 굵게와 링크만 살린다 */
function rt(arr) {
  return (arr ?? [])
    .map((t) => {
      let s = esc(t.plain_text);
      if (t.annotations?.code) s = `<code>${s}</code>`;
      if (t.annotations?.bold) s = `<strong>${s}</strong>`;
      if (t.href) s = `<a href="${esc(t.href)}">${s}</a>`;
      return s;
    })
    .join('');
}

async function render(blockId) {
  const { results = [] } = await api(`/blocks/${blockId}/children?page_size=100`);
  const out = [];
  let listBuf = [];
  const flush = () => {
    if (listBuf.length) {
      out.push(`<ul>${listBuf.join('')}</ul>`);
      listBuf = [];
    }
  };

  for (const b of results) {
    const body = b[b.type] ?? {};
    if (b.type === 'bulleted_list_item') {
      listBuf.push(`<li>${rt(body.rich_text)}</li>`);
      continue;
    }
    flush();
    switch (b.type) {
      case 'heading_1':
        out.push(`<h1>${rt(body.rich_text)}</h1>`);
        break;
      case 'heading_2':
        out.push(`<h2>${rt(body.rich_text)}</h2>`);
        break;
      case 'heading_3':
        out.push(`<h3>${rt(body.rich_text)}</h3>`);
        break;
      case 'paragraph': {
        const t = rt(body.rich_text);
        if (t.trim()) out.push(`<p>${t}</p>`);
        break;
      }
      case 'callout':
        out.push(`<div class="callout">${rt(body.rich_text).replace(/\n/g, '<br>')}</div>`);
        break;
      case 'quote':
        out.push(`<blockquote>${rt(body.rich_text)}</blockquote>`);
        break;
      case 'divider':
        out.push('<hr>');
        break;
      case 'table': {
        const { results: rows = [] } = await api(`/blocks/${b.id}/children?page_size=100`);
        const head = body.has_column_header;
        const html = rows
          .map((r, i) => {
            const tag = head && i === 0 ? 'th' : 'td';
            const cells = r.table_row.cells.map((c) => `<${tag}>${rt(c)}</${tag}>`).join('');
            return `<tr>${cells}</tr>`;
          })
          .join('');
        out.push(`<table>${html}</table>`);
        break;
      }
      default:
        if (body.rich_text) {
          const t = rt(body.rich_text);
          if (t.trim()) out.push(`<p>${t}</p>`);
        }
    }
  }
  flush();
  return out.join('\n');
}

const page = await api(`/pages/${PAGE}`);
const title =
  Object.values(page.properties ?? {})
    .find((v) => v?.type === 'title')
    ?.title?.map((t) => t.plain_text)
    .join('') ?? '이력서';

const content = await render(PAGE);

/**
 * 인쇄 조판.
 *
 * 10.5pt / 1.55 로 잡으면 A4 한 장에 들어가는 양이 확 늘어난다. 이력서는
 * 빽빽해 보이는 것보다 **넘겨야 하는 장수가 적은 것**이 낫다.
 * 절 제목은 페이지 끝에 혼자 남지 않게 `break-after: avoid`.
 */
const html = `<!doctype html>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Malgun Gothic", "맑은 고딕", -apple-system, sans-serif;
    font-size: 10.5pt; line-height: 1.55; color: #16181d; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 16pt; margin: 0 0 6pt; letter-spacing: -.02em; break-after: avoid; }
  h2 { font-size: 12.5pt; margin: 16pt 0 5pt; padding-bottom: 3pt;
       border-bottom: 1.2pt solid #16181d; letter-spacing: -.02em; break-after: avoid; }
  h3 { font-size: 11pt; margin: 11pt 0 3pt; color: #1f3a66; break-after: avoid; }
  p { margin: 3pt 0; }
  ul { margin: 3pt 0 6pt; padding-left: 15pt; }
  li { margin: 1.5pt 0; break-inside: avoid; }
  hr { border: 0; border-top: .6pt solid #d6d9e0; margin: 11pt 0 0; }
  a { color: #1f3a66; text-decoration: none; }
  code { background: #f1f2f5; padding: 0 2pt; border-radius: 2pt; font-size: 9.5pt; }
  blockquote { margin: 6pt 0; padding-left: 8pt; border-left: 2pt solid #c8ccd4; color: #555b66; }
  .callout {
    background: #f4f6fa; border: .6pt solid #d6dbe6; border-radius: 3pt;
    padding: 6pt 8pt; margin: 6pt 0; font-size: 9.8pt; break-inside: avoid;
  }
  table { width: 100%; border-collapse: collapse; margin: 5pt 0 8pt; font-size: 9.6pt; }
  th, td { border: .6pt solid #ccd1da; padding: 3.5pt 5pt; text-align: left; vertical-align: top; }
  th { background: #eef1f6; font-weight: 700; }
  tr { break-inside: avoid; }
  /* 첫 표(보유 기술)와 요건 표는 첫 열을 좁게 */
  table td:first-child, table th:first-child { width: 26%; }
</style>
${content}
`;

mkdirSync('tmp-form', { recursive: true });
const htmlPath = path.resolve('tmp-form', `${NAME}.html`);
writeFileSync(htmlPath, html, 'utf8');

const outDir = path.join(process.env.USERPROFILE ?? '.', 'Downloads');
const pdfPath = path.join(outDir, `${NAME}.pdf`);

const edges = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = edges.find((p) => existsSync(p));
if (!edge) {
  console.log(`HTML 만 만들었습니다 (Edge 를 못 찾음): ${htmlPath}`);
  process.exit(0);
}

execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  `--print-to-pdf=${pdfPath}`,
  '--print-to-pdf-no-header',
  '--no-pdf-header-footer',
  `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'ignore' });

console.log(`✓ ${pdfPath}`);
