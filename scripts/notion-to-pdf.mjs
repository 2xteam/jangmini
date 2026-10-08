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

let content = await render(PAGE);

/**
 * 머리글을 옛 이력서의 띠 모양 그대로 만든다.
 *
 * 원본은 회색 띠 안에 **이름 / 직함 / Birthday / Contact** 네 줄이 왼쪽에,
 * 증명사진이 오른쪽 끝에 붙어 있다. 표가 아니다.
 *
 * Notion 에는 인적사항이 표로 들어 있으므로 여기서 그 표를 읽어
 * 생년월일·연락처만 띠로 올리고, 남은 행(지원 포지션·주소·학력 …)은
 * 띠 아래 표로 내린다. 같은 내용이 두 번 나오지 않는다.
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
    /** 페이지마다 라벨이 조금씩 다르다 — ONE 은 '생년월일', 위존은 '출생년도' */
    const pick = (...keys) =>
      keys.map((k) => rows.find((r) => r[1].replace(/\s/g, '') === k)?.[2].trim()).find(Boolean) ?? '';
    /** 연락처 한 칸에 메일과 전화가 '/' 로 붙어 있다. 원본은 메일이 앞이다 */
    const parts = pick('연락처').split('/').map((t) => t.trim()).filter(Boolean);
    const mail = parts.find((t) => t.includes('@')) ?? '';
    const tel = parts.find((t) => !t.includes('@')) ?? '';
    const contact = [mail && `<a href="mailto:${esc(mail)}">${mail}</a>`, tel].filter(Boolean).join(' / ');

    const lines = [
      pick('생년월일', '출생년도') &&
        `<div class="line"><b>Birthday</b> : ${pick('생년월일', '출생년도').replace(/\.\s+/g, '.')}</div>`,
      contact && `<div class="line"><b>Contact</b> : ${contact}</div>`,
    ].filter(Boolean);

    /** 띠로 올라간 세 줄은 아래 표에서 뺀다 */
    const MOVED = ['성명', '이름', '생년월일', '출생년도', '연락처'];
    const rest = rows.filter((r) => !MOVED.includes(r[1].replace(/\s/g, '')));
    const table = rest.length ? `<table>${rest.map((r) => r[0]).join('')}</table>` : '';

    content =
      `<div class="band"><div class="txt">` +
      head.replace(/<h2>[^<]*<\/h2>\s*/g, '').replace(/<hr\s*\/?>/g, '') +
      `${lines.join('')}</div>${img}</div>${table}` +
      content.slice(m.index + m[0].length);
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
   * 머리글 띠 — 옛 이력서의 얼굴이다.
   *
   * 좌우만 여백 밖으로 번지게 한다. 위로도 당기면(-15mm) 내용이 페이지
   * 영역 밖으로 밀려 인쇄에서 잘린다 — 화면 미리보기에서만 멀쩡해 보인다.
   */
  .band {
    display: flex; align-items: center; gap: 10pt;
    background: #F2F2F2; break-inside: avoid;
    margin: 0 -16mm 11pt; padding: 7mm 16mm;
  }
  .band .txt { flex: 1; min-width: 0; }
  .band h1 { margin: 0 0 3pt; }
  .band h1 + p { margin: 0 0 9pt; }
  .band .line { font-size: 9.5pt; line-height: 1.75; margin: 0; padding-left: 2pt; color: #141515; }
  .band .line b { font-weight: 700; }
  .band .photo { flex: 0 0 auto; width: 33mm; max-width: 33mm; align-self: center; }

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
