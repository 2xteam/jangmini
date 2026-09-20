import { connectDb } from '@/lib/db';
import { Portfolio } from '@/models/Portfolio';
import { requireAdmin } from '@/lib/admin-auth';
import { fillPlaceholder, dropPlaceholderLine } from '@/lib/notion-write';

/**
 * 못 채운 자리를 모아 주고, 채운 값을 Notion 에 되쓴다.
 *
 * GET                                   문서별 본문 + 남은 자리
 * PATCH { slug, line, action, value }   채우거나(fill) 지운다(drop)
 *
 * **쓰기는 Notion 으로 간다.** 사이트 DB 에만 채우면 Notion 은 빈 채로 남고,
 * 인사담당자에게 건네는 PDF 에 구멍이 그대로 보인다 → lib/notion-write.ts
 *
 * Notion 에 쓴 뒤 DB 도 바로 맞춰 둔다. 다음 `pnpm ingest` 까지 기다리면
 * "저장했는데 사이트가 그대로" 로 보인다.
 */

export const dynamic = 'force-dynamic';

type Todo = {
  section: string;
  hint: string;
  kindLabel: string;
  line: string;
  whole: boolean;
};

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  await connectDb();

  const docs = await Portfolio.find({ 'todos.0': { $exists: true } })
    .select('slug title kind tier todos rawBody order source.id source.type')
    .sort({ order: 1 })
    .lean<
      {
        slug: string;
        title: string;
        kind: string;
        tier?: string;
        todos: Todo[];
        rawBody?: string | null;
        source?: { id?: string; type?: string };
      }[]
    >();

  /**
   * **본문을 통째로 준다.**
   *
   * 채울 자리만 따로 보여 주면 무엇을 써야 할지 정할 수가 없다 — "당시 팀
   * 규모" 라는 힌트만 봐서는 어느 프로젝트의 어느 대목인지 감이 안 온다.
   * 앞뒤 문장이 보여야 한다. 그래서 화면은 본문을 그대로 그려 놓고 그 자리에
   * 입력칸을 꽂는다.
   */
  return Response.json({
    docs: docs.map((d) => ({
      slug: d.slug,
      title: d.title,
      tier: d.tier ?? null,
      /** Notion 페이지가 아니면 되쓸 곳이 없다. 화면에서 안내만 한다 */
      editable: d.source?.type === 'notion',
      body: d.rawBody ?? '',
      todos: d.todos ?? [],
    })),
    total: docs.reduce((n, d) => n + (d.todos ?? []).length, 0),
  });
}

export async function PATCH(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  let payload: { slug?: string; line?: string; action?: string; value?: string };
  try {
    payload = await req.json();
  } catch {
    return bad('본문을 읽지 못했습니다.');
  }

  const { slug, line, action } = payload;
  const value = (payload.value ?? '').trim();
  if (!slug || !line) return bad('slug 와 line 이 필요합니다.');
  if (action !== 'fill' && action !== 'drop') return bad("action 은 'fill' 또는 'drop' 입니다.");
  if (action === 'fill' && !value) return bad('채울 내용을 적어 주세요.');
  if (value.length > 600) return bad('600자를 넘습니다. 한 줄로 줄여 주세요.');

  await connectDb();
  const doc = await Portfolio.findOne({ slug }).lean<{
    _id: unknown;
    body?: string;
    rawBody?: string | null;
    todos?: Todo[];
    source?: { id?: string; type?: string };
  }>();
  if (!doc) return bad('없는 문서입니다.', 404);
  if (doc.source?.type !== 'notion' || !doc.source?.id) {
    return bad('이 문서는 Notion 에서 오지 않아 여기서 고칠 수 없습니다.');
  }

  const todo = (doc.todos ?? []).find((t) => t.line === line);
  if (!todo) return bad('이미 처리된 자리입니다. 목록을 새로 고쳐 주세요.');

  /* ── 1. Notion 에 쓴다 (실패하면 DB 는 손대지 않는다) ── */
  let after = '';
  try {
    if (action === 'fill') {
      const r = await fillPlaceholder({
        pageId: doc.source.id,
        line: todo.line,
        whole: todo.whole,
        value,
      });
      after = r.after;
    } else {
      await dropPlaceholderLine(doc.source.id, todo.line);
    }
  } catch (err) {
    return bad(err instanceof Error ? err.message : 'Notion 쓰기에 실패했습니다.', 502);
  }

  /* ── 2. DB 를 맞춘다 ── */
  const nextTodos = (doc.todos ?? []).filter((t) => t.line !== line);
  const nextBody =
    action === 'fill' ? insertIntoSection(doc.body ?? '', todo.section, after) : (doc.body ?? '');

  /**
   * 편집용 본문도 같이 고친다 — 화면이 이걸 그린다. 안 고치면 방금 채운
   * 자리에 입력칸이 그대로 남아 "저장이 안 된 건가" 로 보인다.
   */
  const rawLines = (doc.rawBody ?? '').split('\n');
  const hitAt = rawLines.findIndex((l) => l.trim() === todo.line.trim());
  if (hitAt >= 0) {
    if (action === 'drop') rawLines.splice(hitAt, 1);
    else rawLines[hitAt] = (todo.whole ? '- ' : '') + after;
  }
  const nextRaw = nextTodos.length ? rawLines.join('\n') : null;

  await Portfolio.updateOne(
    { slug },
    { $set: { todos: nextTodos, body: nextBody, rawBody: nextRaw, updatedAt: new Date() } },
  );

  return Response.json({ ok: true, left: nextTodos.length, after });
}

/**
 * 채운 줄을 본문의 제 절에 꽂아 넣는다.
 *
 * 적재할 때 채울 자리가 든 줄은 본문에서 **빠진 상태**라, 채웠으면 다시
 * 넣어 줘야 한다. 절 안의 마지막 불릿 뒤에 붙인다 — 원래 순서를 정확히
 * 되살리지는 못하지만, 다음 `pnpm ingest` 가 Notion 순서대로 다시 맞춘다.
 *
 * 절을 못 찾으면 본문 끝에 붙이지 않고 **그대로 둔다.** 엉뚱한 곳에 나타나는
 * 것보다 잠깐 안 보이는 편이 낫다 (재적재하면 제자리에 들어간다).
 */
function insertIntoSection(body: string, section: string, text: string) {
  if (!body || !section) return body;
  const lines = body.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#{1,3}\\s+${escapeRegex(section)}\\s*$`).test(l));
  if (start < 0) return body;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  /** 절 안의 마지막 내용 줄 뒤 */
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at -= 1;

  const asBullet = lines.slice(start + 1, end).some((l) => /^\s*[-*]\s+/.test(l));
  lines.splice(at, 0, asBullet ? `- ${text}` : text);
  return lines.join('\n');
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
