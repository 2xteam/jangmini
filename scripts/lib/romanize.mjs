/**
 * 한글 → 로마자. **슬러그를 만드는 용도**다.
 *
 * 왜 필요한가 — 프로젝트 제목이 대부분 한글이라, ASCII 토큰만 뽑으면
 * "커뮤니티 플렛폼 개발" 같은 제목은 슬러그가 빈 문자열이 된다. 그러면 URL 이
 * `/projects/p-121dca69` 처럼 의미를 잃고 검색에도 안 잡힌다.
 *
 * 한글 음절은 유니코드에서 **산술적으로 분해된다** —
 *   code = 0xAC00 + (초성 * 21 + 중성) * 28 + 종성
 * 그래서 사전 없이 결정적으로 변환할 수 있다.
 *
 * 국어의 로마자 표기법(2000년 고시)의 **음운 변화 규칙은 적용하지 않는다.**
 * 자음 동화·구개음화까지 넣으면 복잡해지고, 슬러그는 사람이 읽고 알아볼 정도면
 * 충분하다. "관리" 가 정확히는 gwalli 지만 여기서는 gwanri 가 된다.
 */

const CHO = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
  'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];

const JUNG = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa',
  'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];

/**
 * 종성 28개. 0 은 종성 없음이다.
 * ㄱㄲㄳ ㄴㄵㄶ ㄷ ㄹㄺㄻㄼㄽㄾㄿㅀ ㅁㅂㅄ ㅅㅆ ㅇ ㅈㅊㅋㅌㅍㅎ
 *
 * ⚠️ 이 표는 **정확히 28개**여야 한다. 한 칸이라도 밀리면 조용히 틀린 글자가
 * 나온다 — 처음에 29개를 넣어 index 14 부터 밀렸고, 배송비가 baesotbi,
 * 창원이 chatwon 으로 나왔다. 오류는 나지 않았다. 그래서 아래에서 길이를 검증한다.
 */
const JONG = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k',
  'm', 'p', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't',
  't', 'ng', 't', 't', 'k', 't', 'p', 'h',
];

if (CHO.length !== 19 || JUNG.length !== 21 || JONG.length !== 28) {
  throw new Error(
    `로마자 표 길이가 틀렸습니다 — 초성 ${CHO.length}/19 · 중성 ${JUNG.length}/21 · 종성 ${JONG.length}/28`,
  );
}

const BASE = 0xac00;
const LAST = 0xd7a3;

/** 한글이 섞인 문자열을 로마자로 바꾼다. 한글이 아닌 문자는 그대로 둔다 */
export function romanize(input) {
  let out = '';
  for (const ch of String(input)) {
    const code = ch.codePointAt(0);
    if (code >= BASE && code <= LAST) {
      const i = code - BASE;
      const cho = Math.floor(i / (21 * 28));
      const jung = Math.floor((i % (21 * 28)) / 28);
      const jong = i % 28;
      out += CHO[cho] + JUNG[jung] + JONG[jong];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * URL 슬러그를 만든다.
 *
 * `maxWords` 로 길이를 제한한다 — 로마자로 풀면 길어지기 때문이다
 * ("배송비 관리 Admin UX 개선 및 정보 구조 재설계" 를 다 풀면 60자가 넘는다).
 */
export function slugify(title, { maxWords = 6, maxLen = 60 } = {}) {
  const words = romanize(title)
    .toLowerCase()
    /** 한글이 아닌 기호는 공백으로 */
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let slug = words.slice(0, maxWords).join('-');
  if (slug.length > maxLen) {
    slug = slug.slice(0, maxLen).replace(/-[^-]*$/, '');
  }
  return slug;
}

/**
 * 겹치는 슬러그에 접미사를 붙인다. `used` 는 호출자가 들고 있는 Set 이다.
 * 접미사를 순번(-2)으로 두는 이유 — Notion 페이지 id 를 붙이면 URL 이
 * 못 읽게 되고, 노션에서 제목을 고쳤을 때 슬러그가 통째로 바뀐다.
 */
export function uniqueSlug(base, used, fallback = 'item') {
  let slug = base || fallback;
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  for (let n = 2; ; n++) {
    const candidate = `${slug}-${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
