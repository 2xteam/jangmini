/**
 * Notion 이 주는 마크다운을 우리 것으로 정리한다.
 *
 * `/pages/{id}/markdown` 응답에는 Notion 전용 표기가 섞여 있다 —
 * `{color="gray_bg"}` · `<columns>` · `<empty-block/>` · `<mention-page/>` 등.
 * 그대로 저장하면 화면에 그 문자열이 그대로 보인다.
 */

/**
 * 이미지를 떼어낸다.
 *
 * Notion 이 주는 이미지 URL 은 S3 presigned 이고 `X-Amz-Expires=3600` 이다 —
 * **한 시간 뒤 전부 깨진다.** 그래서 본문에 남기지 않고, 몇 장이 있었는지와
 * 원본 URL 만 따로 돌려준다. R2 로 재호스팅하는 단계에서 쓴다.
 */
export function extractImages(md) {
  const images = [];
  /**
   * ⚠️ alt 안에 링크가 중첩된다.
   *
   *   ![[*qoo10.com*](https://qoo10.com)](https://prod-files…)
   *
   * alt 를 `[^\]]*` 로 두면 첫 `]` 에서 끊겨 `](https://prod-files…)` 파편이
   * 남고, 그 파편이 링크로 잡혀 프로필 링크에 `[*qoo10.com*` 이 들어왔다.
   * 그래서 alt 에 **대괄호 한 겹**을 허용한다.
   */
  const body = md.replace(/!\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)]*)\)/g, (_, alt, url) => {
    /**
     * ⚠️ Notion 은 파일이 없는 이미지 블록을 `![]()` 로 준다 — 원본 페이지에
     * 빈 이미지 블록이 남아 있는 경우다(커뮤니티 플렛폼 2건 · 룰렛 플렛폼 1건).
     * 실제 이미지가 아니므로 세지도, 받지도 않는다. 넘기면 R2 이관에서
     * "Failed to parse URL from" 으로 실패한다.
     */
    if (url.trim()) images.push({ alt: cleanInline(alt), notionUrl: url });
    return '';
  });
  return { body, images };
}

/** 인라인 마크다운을 걷어 평문으로 만든다 — 요약·라벨에 쓴다 */
export function cleanInline(text) {
  return String(text ?? '')
    /** [텍스트](url) → 텍스트 */
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/[*`]/g, '')
    .replace(/^\[+|\]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 본문에서 외부 링크만 모은다 (S3 presigned 는 이미 떼어냈다) */
export function extractLinks(md) {
  const links = [];
  const seen = new Set();
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)) {
    const url = m[2];
    if (url.includes('amazonaws.com')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ label: cleanInline(m[1]) || url, url });
  }
  /** mention-page 로 들어온 노션 내부 링크도 참고용으로 담는다 */
  for (const m of md.matchAll(/<mention-page url="([^"]+)"\s*\/>/g)) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ label: 'Notion', url });
  }
  return links;
}

/** Notion 전용 표기를 걷어낸다 */
export function cleanMarkdown(md) {
  return (
    md
      /** 블록 색상 지시 — 헤딩 뒤에 붙어 온다 */
      .replace(/\s*\{color="[^"]*"\}/g, '')
      /** 다단 레이아웃 태그 */
      .replace(/<\/?columns>/g, '')
      .replace(/<column ratio="[^"]*">/g, '')
      .replace(/<\/column>/g, '')
      .replace(/<empty-block\s*\/>/g, '')
      /** 인라인 색상 span 은 내용만 남긴다 */
      .replace(/<span color="[^"]*">([\s\S]*?)<\/span>/g, '$1')
      /** callout 은 인용으로 바꾼다 */
      .replace(/<callout[^>]*>/g, '> ')
      .replace(/<\/callout>/g, '')
      /** 인라인 DB 는 화면에서 따로 그리므로 본문에서 뺀다 */
      .replace(/<database[^>]*>([\s\S]*?)<\/database>/g, '')
      /** 남은 노션 멘션 */
      .replace(/<mention-page url="[^"]*"\s*\/>/g, '')
      /**
       * ⚠️ 헤딩의 들여쓰기를 없앤다.
       *
       * Notion 은 다단 레이아웃(`<columns>`) 안의 내용을 **탭으로 들여써서** 준다.
       * 태그만 지우면 `\t\t### 트랙스로지스 …` 가 남아 `^###` 에 걸리지 않는다.
       * 루트 페이지의 회사 경력이 전부 다단 안에 있어서 경력 파싱이 0건이 됐고,
       * 오류는 나지 않았다 (2026-09-08).
       *
       * 헤딩만 좁혀 처리한다 — 불릿의 들여쓰기는 중첩 목록의 의미가 있어 건드리지 않는다.
       */
      .replace(/^[\t ]+(#{1,6}\s)/gm, '$1')
      /** Notion 이 물결표를 이스케이프해서 준다 */
      .replace(/\\~/g, '~')
      /**
       * 헤딩의 번호와 강조 기호를 정리한다 — "## **3. 성과 및 결과**"
       *
       * 순서가 중요하다. 번호를 떼면서 앞의 `**` 도 함께 사라지므로,
       * **뒤에 남은 `**` 를 따로 떼야 한다** — 안 하면 `## 성과 및 결과**` 가
       * 그대로 저장돼 화면에 별표가 보인다.
       */
      .replace(/^(#{2,4})\s*\*{0,2}\s*\d+\.\s*/gm, '$1 ')
      .replace(/^(#{2,4})\s*\*{2}([^*\n]+)\*{2}\s*$/gm, '$1 $2')
      .replace(/^(#{1,6}\s[^\n]*?)\s*\*{2}\s*$/gm, '$1')
      /** 하위 헤딩의 "-" 접두사 — "### -주요 업무" */
      .replace(/^(#{3,4})\s*-\s*\*{0,2}/gm, '$1 ')
      .replace(/^(#{3,4})\s([^\n]*?)\*{2}\s*$/gm, '$1 $2')
      /** 빈 줄 3개 이상은 2개로 */
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .trim()
  );
}

/**
 * `## 헤딩` 단위로 잘라 { 제목: 본문 } 으로 만든다.
 * 프로젝트 본문이 개요 / 나의 역할 / 성과 및 결과 / 회고 로 일정하므로,
 * 여기서 잘라 두면 필드 추출이 단순해진다.
 */
export function splitSections(md) {
  const out = {};
  const lines = md.split('\n');
  let current = '__intro__';
  let buf = [];
  const flush = () => {
    if (buf.length) out[current] = (out[current] ? out[current] + '\n' : '') + buf.join('\n').trim();
    buf = [];
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1].replace(/\*/g, '').trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** 섹션 안에서 `### 소제목` 아래의 첫 불릿들을 가져온다 */
export function bulletsUnder(sectionText, subHeading) {
  if (!sectionText) return [];
  const lines = sectionText.split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
    const h = /^#{3,4}\s+(.+?)\s*$/.exec(line);
    if (h) {
      inside = h[1].replace(/\*/g, '').trim().includes(subHeading);
      continue;
    }
    if (!inside) continue;
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (b) out.push(b[1].replace(/\*\*/g, '').trim());
    else if (line.trim() === '') continue;
  }
  return out;
}

/** 섹션의 첫 문단 (헤딩·불릿이 아닌 첫 줄) */
export function firstParagraph(sectionText) {
  if (!sectionText) return '';
  for (const line of sectionText.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#') || t.startsWith('-') || t.startsWith('*') || t.startsWith('>')) continue;
    /**
     * 요약은 **평문으로** 저장한다. 마크다운 렌더러를 거치지 않는 자리(카드·
     * 목록·OG description)에 쓰이므로, `[ASP.NET](http://asp.net/)` 같은
     * 인라인 링크가 그대로 화면에 보이는 일이 있었다.
     */
    return cleanInline(t);
  }
  return '';
}

/**
 * 요약으로 쓸 한 문장을 고른다.
 *
 * 45건 중 7건은 개요를 **문단이 아니라 불릿으로** 썼다. 그래서 문단만 찾으면
 * 요약이 빈다. 그런데 첫 불릿이 `**H/W**: Web Cam` 처럼 메타데이터인 경우도
 * 있어서(목포 어린이박물관·용산 전쟁기념관·창원 LED/AR), 단순히 첫 불릿을
 * 쓰면 요약이 "Web Cam" 이 된다.
 *
 * 그래서 **길이 기준**을 둔다 — 30자 이상인 첫 불릿을 고르고, 그런 게 없으면
 * 첫 불릿을 쓴다.
 */
export function pickSummary(...sectionTexts) {
  for (const text of sectionTexts) {
    const p = firstParagraph(text);
    if (p) return p;
  }
  const bullets = [];
  for (const text of sectionTexts) {
    if (!text) continue;
    for (const line of text.split('\n')) {
      const m = /^\s*[-*]\s+(.+)$/.exec(line);
      if (!m) continue;
      /** `**라벨**:` 접두사를 떼고 본문만 본다 */
      const t = cleanInline(m[1].replace(/^\*{2}[^*]+\*{2}\s*:\s*/, ''));
      if (t) bullets.push(t);
    }
  }
  return bullets.find((b) => b.length >= 30) ?? bullets[0] ?? '';
}
