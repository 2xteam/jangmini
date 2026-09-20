'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 본문을 그대로 그려 놓고 **채울 자리에 입력칸을 꽂는다.**
 *
 * 처음에는 채울 자리만 카드 하나씩 보여 줬는데, "당시 팀 규모" 같은 힌트만
 * 봐서는 무엇을 써야 할지 정할 수가 없었다. 어느 프로젝트의 어느 대목인지,
 * 앞뒤로 무슨 말을 했는지가 보여야 문장이 맞는다.
 *
 * 그래서 문서를 통째로 읽기 전용으로 깔고, 빈 자리에만 입력칸을 둔다.
 * `다음 →` 이 아직 안 채운 자리로 데려가고 화면을 거기로 굴린다.
 *
 * 쓰기는 **Notion 으로 간다.** 사이트 DB 에만 채우면 인사담당자에게 건네는
 * PDF 는 빈 채로 남는다 → lib/notion-write.ts
 */

type Todo = { section: string; hint: string; kindLabel: string; line: string; whole: boolean };
type Doc = {
  slug: string;
  title: string;
  tier: string | null;
  editable: boolean;
  body: string;
  todos: Todo[];
};
type Data = { docs: Doc[]; total: number };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json?.code === 'STEP_UP_REQUIRED') {
      window.location.reload();
      throw new Error('재확인 필요');
    }
    throw new Error(json?.error ?? `요청 실패 (${res.status})`);
  }
  return json;
}

const PH = /\\?\[(?:숫자|한계|이유|결정)[^\]]*\\?\]/;

export function TodosTab() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [docAt, setDocAt] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const refs = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(async () => {
    try {
      const d = (await api('/api/admin/todos')) as Data;
      setData(d);
      setDocAt((i) => Math.min(i, Math.max(0, d.docs.length - 1)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const docs = data?.docs ?? [];
  const doc = docs[docAt];

  /** 문서 안에서 아직 안 채운 자리들. `다음 →` 이 이 순서로 돈다 */
  const openLines = useMemo(() => (doc?.todos ?? []).map((t) => t.line), [doc]);

  const scrollTo = useCallback((line: string) => {
    setFocus(line);
    requestAnimationFrame(() => {
      const el = refs.current.get(line);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector<HTMLInputElement>('input')?.focus();
    });
  }, []);

  /** 다음 빈 자리 — 이 문서에 없으면 남은 자리가 있는 다음 문서로 넘어간다 */
  const next = useCallback(() => {
    if (!doc) return;
    const i = focus ? openLines.indexOf(focus) : -1;
    const after = openLines[i + 1];
    if (after) return scrollTo(after);
    const nextDoc = docs.findIndex((d, n) => n > docAt && d.todos.length > 0);
    const wrap = nextDoc >= 0 ? nextDoc : docs.findIndex((d) => d.todos.length > 0);
    if (wrap >= 0 && wrap !== docAt) {
      setDocAt(wrap);
      setFocus(null);
    } else if (openLines[0]) {
      scrollTo(openLines[0]);
    }
  }, [doc, docs, docAt, focus, openLines, scrollTo]);

  const save = async (todo: Todo, action: 'fill' | 'drop', value: string) => {
    if (!doc) return;
    setErr(null);
    await api('/api/admin/todos', {
      method: 'PATCH',
      body: JSON.stringify({ slug: doc.slug, line: todo.line, action, value }),
    });
    setDone((n) => n + 1);
    const wasAt = openLines.indexOf(todo.line);
    await load();
    /** 저장하면 그 다음 자리로 데려간다 — 손이 멈추지 않게 */
    const following = openLines[wasAt + 1];
    if (following) scrollTo(following);
    else setFocus(null);
  };

  if (!data) return <p className="text-muted-foreground p-6 text-sm">불러오는 중…</p>;

  if (!data.total) {
    return (
      <div className="rounded-2xl border p-8 text-center">
        <p className="text-lg font-semibold">남은 자리가 없습니다.</p>
        <p className="text-muted-foreground mt-2 text-sm">
          채울 곳을 모두 처리했습니다. Notion 에 새로 <code>[숫자: …]</code> 를 적으면 다음 수집
          때 여기 다시 나타납니다.
        </p>
        {done > 0 && (
          <p className="text-brand mt-3 text-sm font-medium">이번에 {done}곳을 처리했습니다.</p>
        )}
      </div>
    );
  }

  const total = data.total + done;
  const pct = Math.round((done / Math.max(total, 1)) * 100);

  return (
    <div className="space-y-4">
      {/* ── 얼마나 남았나 ─────────────────────────── */}
      <div className="bg-background/95 sticky top-0 z-10 space-y-3 border-b pb-3 pt-1 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            남은 자리 <span className="text-brand tabular-nums">{data.total}</span>곳
            {done > 0 && <span className="text-muted-foreground"> · 이번에 {done}곳 처리</span>}
          </p>
          <Button size="sm" onClick={next} disabled={!data.total}>
            다음 수정할 곳 →
          </Button>
        </div>
        <div className="bg-accent h-1.5 overflow-hidden rounded-full">
          <div className="bg-brand h-full transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {docs.map((d, i) => (
            <button
              key={d.slug}
              onClick={() => {
                setDocAt(i);
                setFocus(null);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                i === docAt
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              {d.title.length > 20 ? `${d.title.slice(0, 20)}…` : d.title}
              <span className="ml-1 opacity-60">{d.todos.length}</span>
            </button>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* ── 본문 ─────────────────────────────────── */}
      {doc && (
        <article className="rounded-2xl border p-5 sm:p-6">
          <div className="text-muted-foreground mb-1 text-xs">
            <a
              href={`/projects/${doc.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              /projects/{doc.slug}
            </a>
          </div>
          <h2 className="text-xl font-bold tracking-[-0.02em]">{doc.title}</h2>
          {!doc.editable && (
            <p className="mt-2 text-xs text-amber-600">
              Notion 문서가 아니라 여기서 고칠 수 없습니다.
            </p>
          )}

          <BodyEditor
            doc={doc}
            focus={focus}
            refs={refs}
            onSave={save}
            onFocusLine={(l) => setFocus(l)}
          />
        </article>
      )}
    </div>
  );
}

/* ══════════════ 본문 ══════════════ */

/**
 * 본문을 줄 단위로 그린다.
 *
 * 마크다운 전체를 해석하지 않는다 — 이 본문은 우리가 만든 5절 양식이라
 * `## 제목`, `- 불릿`, 문단 셋뿐이다. 라이브러리를 들이면 채울 자리에
 * 입력칸을 꽂기 위해 렌더러를 다시 뜯어야 한다.
 */
function BodyEditor({
  doc,
  focus,
  refs,
  onSave,
  onFocusLine,
}: {
  doc: Doc;
  focus: string | null;
  refs: React.RefObject<Map<string, HTMLDivElement>>;
  onSave: (t: Todo, a: 'fill' | 'drop', v: string) => Promise<void>;
  onFocusLine: (line: string) => void;
}) {
  const todoByLine = new Map(doc.todos.map((t) => [t.line.trim(), t]));

  return (
    <div className="mt-4 space-y-1 text-[15px] leading-[1.9]">
      {doc.body.split('\n').map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} className="h-2" />;

        const heading = /^#{1,3}\s+(.+)$/.exec(line);
        if (heading) {
          return (
            <h3
              key={i}
              className="mt-6 border-t pt-4 text-base font-bold tracking-[-0.01em] first:mt-0 first:border-t-0 first:pt-0"
            >
              {heading[1]}
            </h3>
          );
        }

        const todo = todoByLine.get(line);
        if (todo) {
          return (
            <div
              key={i}
              ref={(el) => {
                if (el) refs.current?.set(todo.line, el);
                else refs.current?.delete(todo.line);
              }}
            >
              <TodoLine
                todo={todo}
                active={focus === todo.line}
                disabled={!doc.editable}
                onSave={onSave}
                onFocusLine={onFocusLine}
              />
            </div>
          );
        }

        const bullet = /^[-*]\s+(.+)$/.exec(line);
        return bullet ? (
          <p key={i} className="text-muted-foreground flex gap-2 pl-1">
            <span className="select-none opacity-50">·</span>
            <span>{strip(bullet[1])}</span>
          </p>
        ) : (
          <p key={i} className="text-muted-foreground">
            {strip(line)}
          </p>
        );
      })}
    </div>
  );
}

/** `**굵게**` 와 Notion 이 붙인 이스케이프를 걷어낸다 — 읽기용이라 서식은 버린다 */
const strip = (s: string) => s.replace(/\*\*/g, '').replace(/\\([[\]])/g, '$1');

/* ══════════════ 채울 자리 한 줄 ══════════════ */

function TodoLine({
  todo,
  active,
  disabled,
  onSave,
  onFocusLine,
}: {
  todo: Todo;
  active: boolean;
  disabled: boolean;
  onSave: (t: Todo, a: 'fill' | 'drop', v: string) => Promise<void>;
  onFocusLine: (line: string) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bare = todo.line.replace(/^\s*[-*]\s*/, '');
  const [before, after] = bare.split(PH);

  const run = async (action: 'fill' | 'drop') => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave(todo, action, value);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`my-1.5 rounded-lg border-l-2 py-2 pl-3 transition-colors ${
        active ? 'border-brand bg-brand/5' : 'border-amber-400/70 bg-amber-50/40'
      }`}
    >
      <div className="text-muted-foreground mb-1.5 flex items-center gap-2 text-[11px]">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">
          {todo.kindLabel}
        </span>
        <span>{strip(todo.hint)}</span>
      </div>

      {/* 문장 한가운데면 앞뒤를 그대로 두고 그 자리에만 칸을 넣는다 */}
      <p className="flex flex-wrap items-baseline gap-x-1 gap-y-1.5 text-[15px] leading-[1.9]">
        {!todo.whole && before && <span>{strip(before)}</span>}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => onFocusLine(todo.line)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              e.preventDefault();
              void run('fill');
            }
          }}
          disabled={busy || disabled}
          placeholder={todo.whole ? '이 자리에 들어갈 문장' : '값만'}
          size={todo.whole ? 48 : Math.max(10, value.length + 4)}
          className="border-brand/50 focus:border-brand min-w-[8rem] max-w-full flex-1 rounded border-b-2 border-x-0 border-t-0 bg-transparent px-1 py-0.5 text-[15px] outline-none disabled:opacity-50"
        />
        {!todo.whole && after && <span>{strip(after)}</span>}
      </p>

      {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => run('fill')} disabled={busy || !value.trim() || disabled}>
          저장
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (confirm('Notion 에서 이 줄을 지웁니다. 되돌리려면 Notion 의 기록을 쓰세요.')) {
              void run('drop');
            }
          }}
          disabled={busy || disabled}
          className="text-muted-foreground h-7 text-xs hover:text-red-600"
        >
          이 줄 지우기
        </Button>
        <span className="text-muted-foreground text-[11px]">
          모르는 숫자는 지우는 편이 낫습니다 · Enter 로 저장
        </span>
      </div>
    </div>
  );
}
