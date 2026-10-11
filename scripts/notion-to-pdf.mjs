/**
 * Notion 페이지를 인쇄용 HTML 로 뽑고 PDF 로 변환한다.
 *
 *   node scripts/notion-to-pdf.mjs <페이지id> "<출력파일 이름>"
 *   pnpm pdf:one          ONE 이력서를 이력서 폴더에 PDF 로 (scripts/files-dir.mjs)
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
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { FILES_DIR, ORIGIN_PDF } from './files-dir.mjs';

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

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PAGE = (args[0] ?? '3f3dca69-72b8-8025-9dc1-c3f6e71665e8').replace(/-/g, '');
const NAME = args[1] ?? '장민_이력서_ONE';

/**
 * `--no-header` 는 머리글을 얹지 않고 자리만 비워 둔 채로 끝낸다.
 *
 * Word 로 바꿀 때 쓴다. 머리글은 벡터라서 Word 가 도형 수천 개로 풀어 놓느라
 * 변환이 끝나지 않는다 (CPU 3분을 넘겨도 저장이 안 됐다). 본문만 바꾼 뒤
 * 머리글은 그림 한 장으로 얹는 쪽이 빠르고 결과도 깔끔하다.
 */
const NO_HEADER = process.argv.includes('--no-header');

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


/**
 * 사진을 인쇄 크기로 줄인다.
 *
 * 원본이 2MB 넘는 PNG 라 그대로 넣으면 PDF 가 3MB 가 된다. 26mm 로 찍힐
 * 그림에 그만한 화소가 필요 없고, 메일 첨부로 보내는 문서다.
 *
 * Node 에 이미지 라이브러리가 없어 **.NET System.Drawing** 을 쓴다 —
 * 윈도우에 기본으로 있고 의존성을 더하지 않는다. 한 번 줄이면 캐시한다.
 */
async function shrink(url) {
  if (!/^https?:/.test(url)) return url;
  const out = path.resolve('tmp-form', 'photo-print.jpg');
  if (existsSync(out)) return `file:///${out.replace(/\\/g, '/')}`;
  try {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const src = path.resolve('tmp-form', 'photo-src.bin');
    writeFileSync(src, buf);
    const ps = `Add-Type -AssemblyName System.Drawing
$i = [System.Drawing.Image]::FromFile('${src}')
$w = 420; $h = [int]($i.Height * $w / $i.Width)
$b = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($b)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($i, 0, 0, $w, $h)
$b.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose(); $b.Dispose(); $i.Dispose()`;
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    if (existsSync(out)) return `file:///${out.replace(/\\/g, '/')}`;
  } catch {
    /* 줄이기에 실패하면 원본 URL 을 그대로 쓴다 — 크기만 커질 뿐 결과는 나온다 */
  }
  return url;
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
      case 'column_list': {
        /**
         * 2단. Notion 에서 인적사항 표와 증명사진을 나란히 두는 데 쓴다.
         * 인쇄에서는 flex 한 줄로 그리고, 칼럼 비율을 그대로 폭에 반영한다.
         */
        const { results: cols = [] } = await api(`/blocks/${b.id}/children?page_size=20`);
        const cells = [];
        for (const col of cols) {
          const ratio = col.column?.width_ratio ?? 1 / cols.length;
          cells.push(`<div class="col" style="flex:${ratio}">${await render(col.id)}</div>`);
        }
        out.push(`<div class="cols">${cells.join('')}</div>`);
        break;
      }
      case 'image': {
        /**
         * 증명사진. 오른쪽으로 띄워 인적사항 표가 그 옆으로 흐르게 한다.
         * Notion 이 보관한 파일은 만료되는 서명 URL 이라 external 을 먼저 본다 —
         * 만료된 URL 은 PDF 에서 빈칸으로 찍히고 알아채기 어렵다.
         */
        const url = body.type === 'external' ? body.external?.url : body.file?.url;
        if (url) out.push(`<img class="photo" src="${esc(await shrink(url))}" alt="">`);
        break;
      }
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

/**
 * 옛 이력서 PDF 1쪽에서 머리글이 차지하는 네모.
 *
 * 쪽 왼쪽 아래를 원점으로 한 **PDF 포인트**다 (A4 = 595.28 × 841.89pt).
 * 눈대중이 아니라 1쪽을 2000px 로 렌더링해 흰 줄을 찾아 **재서** 얻었다 —
 *   powershell -NoProfile -File scripts/forms/header-image.ps1
 * 이 스크립트가 `x 118~1874 · y 136~624` (2000×2827px) 를 찍어 준다.
 * 아래 경계는 측정값(624)보다 올린 540 이다 — 624 로 자르면 다음 절 제목
 * (소개 / About Me)이 함께 딸려 온다.
 * 원본 PDF 를 다시 뽑았다면 그것을 돌려 이 값을 고친다.
 */
const A4_W = 595.28;
const A4_H = 841.89;
const PT_PER_PX = A4_W / 2000;
const HEAD_BOX = {
  left: 118 * PT_PER_PX,
  right: 1874 * PT_PER_PX,
  top: A4_H - 136 * PT_PER_PX,
  bottom: A4_H - 540 * PT_PER_PX,
};
/** 본문이 머리글 아래에서 시작하도록 비워 둘 높이. 위 여백 15mm 를 뺀 값이다 */
const HEAD_SPACE_MM = Math.round(((A4_H - HEAD_BOX.bottom) / 72) * 25.4 - 15 + 4);

let content = await render(PAGE);

/**
 * 머리글은 **옛 이력서 PDF 에서 그대로 떼어 온다.**
 *
 * 이름 / 직함 / Birthday / Contact / 증명사진이 들어간 그 머리글을 CSS 로 두
 * 번 흉내 냈지만 두 번 다 "비슷하지만 다른" 것이 나왔다. 글꼴(HY헤드라인M)이
 * 이 PC 에 없고, 색도 Word COM 이 BGR 로 돌려줘 한 번 틀렸다.
 *
 * 그래서 여기서는 **자리만 비워 두고**, PDF 를 만든 뒤 원본 1쪽의 그 영역을
 * 벡터째 얹는다(아래 overlayHeader). 글자가 그림이 되지 않아 선택·검색이
 * 그대로 되고, 어긋날 자리가 없다.
 *
 * Notion 에는 인적사항이 표로 들어 있으므로, 머리글로 올라간 세 줄
 * (이름·생년월일·연락처)은 표에서 빼고 나머지만 아래 표로 남긴다.
 * 같은 내용이 두 번 나오지 않는다.
 *
 * Notion 블록은 건드리지 않는다 — 화면에서는 지금 2단 모양이 보기 좋다.
 */
const HEAD = /<div class="cols"><div class="col"[^>]*>([\s\S]*?)<\/div><div class="col"[^>]*>([\s\S]*?)<\/div><\/div>/;
{
  const m = HEAD.exec(content);
  const head = m ? content.slice(0, m.index) : '';
  const img = m ? /<img[^>]*>/.exec(m[2])?.[0] : null;
  const rows = m ? [...m[1].matchAll(/<tr><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)] : [];

  if (m && img && rows.length && /<h1>/.test(head)) {
    /** 머리글로 올라간 줄은 아래 표에서 뺀다 — 이름·생년월일·연락처 */
    const MOVED = ['성명', '이름', '생년월일', '출생년도', '연락처'];
    const rest = rows.filter((r) => !MOVED.includes(r[1].replace(/\s/g, '')));
    const table = rest.length ? `<table>${rest.map((r) => r[0]).join('')}</table>` : '';

    content = `<div class="head-space"></div>${table}` + content.slice(m.index + m[0].length);
  }
}

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
  /*
   * 2026년 이전 이력서(장민_이력서_경력기술서_자기소개서.docx)의 서식을 옮겼다.
   * 그 문서에서 뽑은 값 —
   *   이름 26pt / 직함 18pt, 색 #156082 (진한 청록)  본문 10pt 맑은 고딕 #141515
   *
   * ⚠️ Word COM 의 Font.Color 는 **BGR** 순서다. 처음에 #826015(골드)로 읽고
   *    그대로 썼는데 실제 색은 그 역순인 #156082 였다. 색은 .docx 의
   *    word/document.xml 에서 w:color w:val 로 직접 확인하는 편이 안전하다.
   *   절 제목 11pt 굵게, 아래 여백 6pt          표 머리글 음영 #D9D9D9
   *
   * HY헤드라인M 은 이 PC 에 없다. 같은 무게의 HYGothic-Extra 로 대체하고,
   * 없으면 맑은 고딕 굵게로 떨어진다.
   */
  @page { size: A4; margin: 15mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Malgun Gothic", "맑은 고딕", sans-serif;
    font-size: 10pt; line-height: 1.6; color: #141515; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* 이름과 직함 — 문서의 얼굴 */
  h1 {
    font-family: "HYGothic-Extra", "HYGothic-Medium", "Malgun Gothic", sans-serif;
    font-size: 26pt; font-weight: 700; color: #156082;
    margin: 0 0 2pt; letter-spacing: -.01em; break-after: avoid;
  }
  h1 + p {
    font-family: "HYGothic-Extra", "HYGothic-Medium", "Malgun Gothic", sans-serif;
    font-size: 18pt; color: #156082; margin: 0 0 8pt; break-after: avoid;
  }

  h2 {
    font-size: 11pt; font-weight: 700; color: #141515;
    margin: 14pt 0 6pt; break-after: avoid; clear: both;
  }
  h3 { font-size: 10.5pt; font-weight: 700; color: #4a4330; margin: 10pt 0 3pt; break-after: avoid; }
  p { margin: 2.5pt 0; }
  ul { margin: 2.5pt 0 5pt; padding-left: 14pt; }
  li { margin: 1pt 0; break-inside: avoid; }
  a { color: #156082; text-decoration: none; }
  code { background: #f2f1ec; padding: 0 2pt; border-radius: 2pt; font-size: 9.5pt; }
  blockquote { margin: 5pt 0; padding-left: 7pt; border-left: 2pt solid #cfc6ab; color: #5c5647; }

  /* 절 구분선 — 원본은 빈 줄로 띄웠지만 인쇄에서는 가는 선이 읽기 쉽다 */
  hr { border: 0; border-top: .5pt solid #d9d9d9; margin: 11pt 0 0; clear: both; }

  .callout {
    background: #faf8f2; border: .5pt solid #e3ddc9; border-radius: 2pt;
    padding: 5pt 7pt; margin: 5pt 0; font-size: 9.5pt; break-inside: avoid;
  }

  table { width: 100%; border-collapse: collapse; margin: 4pt 0 7pt; font-size: 9.5pt; }
  th, td { border: .5pt solid #bfbfbf; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #D9D9D9; font-weight: 700; }
  tr { break-inside: avoid; }
  table td:first-child, table th:first-child { width: 26%; }

  .photo { width: 100%; max-width: 30mm; }
  .cols { display: flex; gap: 10pt; align-items: flex-start; break-inside: avoid; }
  .cols .col { min-width: 0; }
  .cols .photo { float: none; margin: 0; }

  /*
   * 머리글 자리. 여기는 비워 두고, PDF 를 만든 뒤 옛 이력서 1쪽의 머리글을
   * 벡터째 얹는다. 높이는 HEAD_BOX 에서 계산해 넣는다.
   */
  .head-space { height: ${HEAD_SPACE_MM}mm; }

</style>
${content}
`;

mkdirSync('tmp-form', { recursive: true });
const htmlPath = path.resolve('tmp-form', `${NAME}.html`);
writeFileSync(htmlPath, html, 'utf8');

const outDir = FILES_DIR;
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

const before = existsSync(pdfPath) ? statSync(pdfPath).mtimeMs : 0;
execFileSync(edge, [
  '--headless=new',
  '--disable-gpu',
  `--print-to-pdf=${pdfPath}`,
  '--print-to-pdf-no-header',
  '--no-pdf-header-footer',
  `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'ignore' });

/**
 * ⚠️ `execFileSync` 가 돌아왔다고 PDF 가 다 쓰인 것이 아니다.
 *
 * Edge 는 실제 작업을 자식 프로세스에 넘기고 먼저 끝난다. 그래서 바로 뒤에서
 * 파일을 읽어 고쳐 쓰면, **그 뒤에 Edge 가 원래 파일로 덮어쓴다** — 머리글을
 * 얹어 저장했는데 결과물에는 없는 일이 벌어진다. 한참 헤맸다.
 *
 * 크기가 더 이상 변하지 않을 때까지 기다린다.
 */
async function waitForPdf(file, since) {
  const deadline = Date.now() + 60_000;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const st = existsSync(file) ? statSync(file) : null;
    if (st && st.mtimeMs > since && st.size > 0) {
      stable = st.size === last ? stable + 1 : 0;
      last = st.size;
      if (stable >= 3) return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
if (!(await waitForPdf(pdfPath, before))) {
  console.log(`⚠ Edge 가 PDF 를 다 쓰지 못했습니다: ${pdfPath}`);
  process.exit(1);
}

/**
 * 옛 이력서 1쪽의 머리글을 **벡터째** 1쪽 위에 얹는다.
 *
 * `embedPage` 는 그 영역을 Form XObject 로 들여온다 — 글자가 그림이 되지
 * 않으므로 선택·검색이 그대로 되고, 글꼴이 없어도 원본이 품고 있는 것을
 * 쓴다. 래스터로 뜨면 인쇄에서 가장자리가 뭉개진다.
 */
const ORIGIN = path.join(FILES_DIR, ORIGIN_PDF);
if (NO_HEADER) {
  console.log(`✓ ${pdfPath}`);
  console.log('  --no-header — 머리글 자리를 비워 두었습니다 (Word 변환용)');
  process.exit(0);
}
if (!existsSync(ORIGIN)) {
  console.log(`⚠ 옛 이력서 PDF 가 없어 머리글을 얹지 못했습니다: ${ORIGIN}`);
  console.log(`✓ ${pdfPath} (머리글 자리 비어 있음)`);
  process.exit(0);
}

const { PDFDocument } = await import('pdf-lib');
const body = await PDFDocument.load(readFileSync(pdfPath));
const src = await PDFDocument.load(readFileSync(ORIGIN));

/**
 * Edge 가 만든 쪽에 **덧그리면 안 된다.** 그 쪽의 그래픽 상태(변환·클립)가
 * 남아 있어 나중에 그린 것이 묻힌다 — 자원에는 들어가는데 화면에는 안 나와서
 * 한참 헤맸다. 그래서 빈 문서를 새로 만들고 본문 쪽과 머리글을 **둘 다
 * 얹는다.** 각자 제 좌표계를 들고 오므로 서로 간섭하지 않는다.
 */
const out = await PDFDocument.create();
const bodyPages = await out.embedPages(body.getPages());
/** 네모를 함께 넘기면 그 영역만 잘라서 들여온다 */
const stamp = await out.embedPage(src.getPage(0), HEAD_BOX);

bodyPages.forEach((bp, i) => {
  const page = out.addPage([A4_W, A4_H]);
  page.drawPage(bp, { x: 0, y: 0, width: A4_W, height: A4_H });
  if (i === 0) {
    page.drawPage(stamp, {
      x: HEAD_BOX.left,
      y: HEAD_BOX.bottom,
      width: HEAD_BOX.right - HEAD_BOX.left,
      height: HEAD_BOX.top - HEAD_BOX.bottom,
    });
  }
});
writeFileSync(pdfPath, await out.save());

console.log(`✓ ${pdfPath}`);
console.log(`  머리글은 옛 이력서 PDF 1쪽에서 그대로 가져왔습니다 (벡터)`);
