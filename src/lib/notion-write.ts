/**
 * Notion 되쓰기 — admin 의 '채울 자리' 탭이 쓴다.
 *
 * **왜 DB 가 아니라 Notion 인가.**
 *
 * `[숫자: …]` 는 Notion 원본에 있다. 그리고 그 문서는 사이트만 먹이는 게
 * 아니라 **인사담당자에게 건네는 PDF 의 원본**이다. 사이트 DB 에만 채우면
 * Notion 은 빈 채로 남고, PDF 를 뽑는 순간 다시 구멍이 보인다. 같은 값을 두
 * 곳에 두면 반드시 어긋난다 — 이 저장소에서 이미 두 번 겪었다
 * (profile-manual.json 의 소개, PINNED 의 대표 여부).
 *
 * 그래서 쓰기는 Notion 한 곳으로 가고, 사이트는 따라온다.
 *
 * ⚠️ **이 파일은 서버에서만 쓴다.** `process.env.NOTION_TOKEN` 은 `NEXT_PUBLIC_`
 * 접두사가 없어 클라이언트 번들에 값이 들어가지 않지만, 그렇더라도 이 모듈을
 * 클라이언트 컴포넌트에서 import 하지 않는다 — 부르는 곳은 API 라우트뿐이다.
 */

const NOTION_VERSION = '2022-06-28';

type RichText = { plain_text: string };
type Block = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

function headers() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN 이 없습니다. 서버 환경 변수를 확인하세요.');
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function notion(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: headers(),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${json?.message ?? '알 수 없는 오류'}`);
  }
  return json;
}

const textOf = (b: Block) => {
  const body = b[b.type] as { rich_text?: RichText[] } | undefined;
  return (body?.rich_text ?? []).map((t) => t.plain_text).join('');
};

/**
 * `**굵게**` 를 Notion 리치 텍스트로. 나머지는 평문으로 둔다.
 *
 * 사람이 admin 입력칸에 쓰는 것은 대개 한 문장이다. 마크다운 전체를
 * 해석하려 들면 예상 못 한 곳에서 서식이 깨진다 — 굵게 하나면 충분하다.
 */
function rich(text: string) {
  const out: unknown[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = part.startsWith('**') && part.endsWith('**');
    out.push({
      type: 'text',
      text: { content: bold ? part.slice(2, -2) : part },
      ...(bold ? { annotations: { bold: true } } : {}),
    });
  }
  return out.length ? out : [{ type: 'text', text: { content: text } }];
}

/**
 * 페이지 안의 모든 블록을 평평하게 훑는다.
 *
 * 다단(`column_list`) 안에 들어 있는 문단을 놓치면 소개 절을 못 고친다.
 * 깊이는 3 으로 끊는다 — 그 아래까지 내려가는 구조를 쓰지 않는다.
 */
async function flatten(blockId: string, depth = 0): Promise<Block[]> {
  if (depth > 3) return [];
  const { results = [] } = (await notion(`/blocks/${blockId}/children?page_size=100`)) as {
    results: Block[];
  };
  const out: Block[] = [];
  for (const b of results) {
    out.push(b);
    if (b.has_children) out.push(...(await flatten(b.id, depth + 1)));
  }
  return out;
}

/**
 * 채울 자리가 든 블록을 찾는다.
 *
 * Notion 은 대괄호를 `\[` 로 이스케이프해 **마크다운으로 내려줄 때만** 그렇게
 * 준다. 블록 API 의 `plain_text` 에는 역슬래시가 없다. 그래서 저장해 둔
 * `line` 을 그대로 비교하면 하나도 안 걸린다 — 역슬래시를 걷고 맞춘다.
 */
const normalize = (s: string) =>
  s
    .replace(/\\/g, '')
    .replace(/^\s*[-*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

export const PLACEHOLDER_RE = /\[(?:숫자|한계|이유|결정)[^\]]*\]/;

export type FoundBlock = { id: string; type: string; text: string };

export async function findPlaceholderBlock(
  pageId: string,
  line: string,
): Promise<FoundBlock | null> {
  const want = normalize(line);
  const blocks = await flatten(pageId);
  for (const b of blocks) {
    const text = textOf(b);
    if (!text) continue;
    if (normalize(text) === want) return { id: b.id, type: b.type, text };
  }
  /** 정확히 안 맞으면 채울 자리 조각으로 한 번 더 — 사람이 앞뒤를 손봤을 수 있다 */
  const hint = (want.match(PLACEHOLDER_RE) ?? [])[0];
  if (hint) {
    for (const b of blocks) {
      const text = textOf(b);
      if (text && normalize(text).includes(hint)) return { id: b.id, type: b.type, text };
    }
  }
  return null;
}

/**
 * 채운 값을 Notion 에 쓴다.
 *
 * `whole` 이면 줄 전체가 채울 자리였으므로 통째로 바꾸고, 아니면 문장 속
 * `[숫자: …]` 조각만 갈아 끼운다. 조각만 바꿔야 "관리 포인트를 6개 구역에서
 * 1개로 줄였습니다" 처럼 원래 문장이 살아난다.
 */
export async function fillPlaceholder(opts: {
  pageId: string;
  line: string;
  whole: boolean;
  value: string;
}): Promise<{ blockId: string; before: string; after: string }> {
  const found = await findPlaceholderBlock(opts.pageId, opts.line);
  if (!found) throw new Error('Notion 에서 그 줄을 찾지 못했습니다. 이미 고치셨을 수 있습니다.');

  const after = opts.whole
    ? opts.value
    : found.text.replace(PLACEHOLDER_RE, opts.value).replace(/\s{2,}/g, ' ').trim();

  await notion(`/blocks/${found.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ [found.type]: { rich_text: rich(after) } }),
  });
  return { blockId: found.id, before: found.text, after };
}

/**
 * 그 줄을 지운다.
 *
 * 숫자를 모르거나 공개하기 어려우면 **지우는 것이 맞는 선택**이다. 어림값을
 * 넣으면 면접에서 그 숫자 하나 때문에 나머지 숫자까지 의심받는다.
 */
export async function dropPlaceholderLine(pageId: string, line: string) {
  const found = await findPlaceholderBlock(pageId, line);
  if (!found) throw new Error('Notion 에서 그 줄을 찾지 못했습니다. 이미 지우셨을 수 있습니다.');
  await notion(`/blocks/${found.id}`, { method: 'DELETE' });
  return { blockId: found.id, before: found.text };
}
