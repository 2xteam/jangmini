/**
 * 이력서 .docx → tmp-ingest/resume.txt
 *
 *   pnpm fetch:resume
 *
 * Notion 에 **없는 것**을 보강하는 원본이다 — 학력 상세·자격증 취득일·
 * 대외활동 9건·병역·자기소개. 프로젝트 본문은 Notion 이 원본이다
 * → my-obsidian-vault / 10-Projects/jangmini.md
 *
 * .docx 는 zip 이고 본문은 word/document.xml 하나에 들어 있다. 의존성을 더하지
 * 않으려고 zip 을 직접 읽는다 — 중앙 디렉터리에서 그 항목만 찾아 inflateRaw 한다.
 *
 * 파일 위치는 RESUME_DOCX 로 바꿀 수 있다. 기본값은 사용자가 알려준 경로다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

const DEFAULT_DOCX = 'C:/Users/Tracxlogis/Downloads/newenw/장민_이력서_경력기술서_자기소개서.docx';
const OUT_DIR = 'tmp-ingest';

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

const docxPath = process.env.RESUME_DOCX || DEFAULT_DOCX;

if (!existsSync(docxPath)) {
  console.error(
    `✗ 이력서 파일이 없습니다:\n  ${docxPath}\n\n` +
      `  옮기셨다면 .env.local 에 경로를 넣어 주세요:\n` +
      `    RESUME_DOCX=C:/경로/이력서.docx`,
  );
  process.exit(1);
}

/** zip 에서 이름이 일치하는 항목 하나를 꺼낸다 */
function readZipEntry(buf, wantName) {
  /** End of Central Directory 를 뒤에서 찾는다 */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다 (EOCD 없음)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('중앙 디렉터리가 손상됐습니다');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    if (name === wantName) {
      /** 로컬 헤더의 가변 길이를 다시 읽어 데이터 시작점을 구한다 */
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wantName} 을 찾지 못했습니다`);
}

try {
  const buf = readFileSync(docxPath);
  const xml = readZipEntry(buf, 'word/document.xml').toString('utf8');

  /** 단락은 줄바꿈으로, 탭·줄바꿈 태그를 살린 뒤 남은 태그를 걷어낸다 */
  let text = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '');

  /** Word 가 남기는 HYPERLINK 필드 코드를 정리한다 */
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'resume.txt'), text, 'utf8');
  /** 원본도 함께 둔다 — 원본이 사라져 재추출이 막히는 일을 겪었다 (2026-09-08) */
  copyFileSync(docxPath, path.join(OUT_DIR, 'resume.docx'));

  const lines = text.split('\n');
  console.log(`✓ ${OUT_DIR}/resume.txt  ${text.length}자 / ${lines.length}줄`);
  console.log(`✓ ${OUT_DIR}/resume.docx  원본 사본`);

  console.log('\n핵심 섹션 확인');
  for (const key of ['기술48895257810스택', '경력 사항', '학력', '자격증', '교육 및 대외활동', '병역', '자기 소개', '지원 동기']) {
    const hit = text.includes(key);
    console.log(`  ${hit ? '✓' : '✗'} ${key}`);
  }
  console.log('\n다음:  pnpm ingest');
} catch (err) {
  console.error('✗ 추출 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
