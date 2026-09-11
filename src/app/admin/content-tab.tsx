'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { FieldSpec } from '@/lib/overrides';

/**
 * 이력 문서를 손으로 고치는 탭.
 *
 * ⚠️ **고친 값은 원본을 덮지 않는다.** `overrides` 에만 쌓이고, 화면은
 * override 가 있으면 그것을 먼저 본다. 그래서 Notion 을 다시 수집해도
 * 고친 값이 살아남고, "되돌리기" 한 번으로 원본이 돌아온다.
 * → lib/overrides.ts
 *
 * 왼쪽이 목록, 오른쪽이 편집이다. 102건을 한 화면에 펼치면 무엇을 고치는
 * 중인지 잃어버린다.
 *
 * **종류를 칩으로 꺼내 둔다.** 셀렉트에 넣으면 열어 보기 전에는 무엇이
 * 몇 건인지 알 수 없다. 종류마다 2차 분류가 다시 붙는다 — 기술은 노션의
 * 분류(8종), 활동도 분류, 프로젝트 46건은 소속이 실제 구분선이다.
 */

type Row = {
  slug: string;
  kind: string;
  title: string;
  summary: string | null;
  company: string | null;
  period: string | null;
  visibility: string;
  featured: boolean;
  editedCount: number;
};

type Field = FieldSpec & { original: unknown; override: unknown; edited: boolean };

const KIND_LABEL: Record<string, string> = {
  profile: '소개',
  experience: '경력',
  project: '프로젝트',
  skill: '기술',
  education: '학력',
  certificate: '자격',
  activity: '활동',
  essay: '자기소개서',
};

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

/** 화면에 보여줄 문자열로 만든다. 목록형은 줄바꿈으로 편집한다 */
function toText(spec: FieldSpec, v: unknown): string {
  if (v == null) return '';
  if (spec.type === 'list') return Array.isArray(v) ? v.join('\n') : String(v);
  return String(v);
}

/** 목록에 나오는 순서. 자주 고치는 것부터 */
const KIND_ORDER = ['project', 'experience', 'skill', 'profile', 'activity', 'essay', 'education', 'certificate'];

const total0 = (g: { n: number }[]) => g.reduce((a, b) => a + b.n, 0);

function Chip({
  on,
  onClick,
  label,
  n,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  n: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        on ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'
      }`}
    >
      {label} <span className="opacity-60 tabular-nums">{n}</span>
    </button>
  );
}

export function ContentTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [kind, setKind] = useState('');
  const [group, setGroup] = useState('');
  const [groups, setGroups] = useState<{ value: string; label: string; n: number }[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (kind) p.set('kind', kind);
      if (group) p.set('group', group);
      if (q.trim()) p.set('q', q.trim());
      const d = await api(`/api/admin/content?${p}`);
      setRows(d.rows);
      setCounts(d.counts);
      setGroups(d.groups ?? []);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [kind, group, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  /** 종류를 바꾸면 2차 선택은 의미가 없어진다 — 같이 비운다 */
  const pick = (k: string) => {
    setKind(k);
    setGroup('');
  };

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* 1차 — 종류 */}
      <div className="flex flex-wrap gap-1.5">
        <Chip on={!kind} onClick={() => pick('')} label="전체" n={total} />
        {KIND_ORDER.filter((k) => counts[k]).map((k) => (
          <Chip
            key={k}
            on={kind === k}
            onClick={() => pick(k)}
            label={KIND_LABEL[k] ?? k}
            n={counts[k]}
          />
        ))}
      </div>

      {/* 2차 — 기술·활동은 분류, 프로젝트는 소속 */}
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-l-2 pl-3">
          <Chip on={!group} onClick={() => setGroup('')} label="전부" n={total0(groups)} />
          {groups.map((g) => (
            <Chip
              key={g.value}
              on={group === g.value}
              onClick={() => setGroup(g.value)}
              label={g.label}
              n={g.n}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="제목·슬러그·소속으로 찾기"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56 rounded-xl border px-3 py-2 text-sm"
        />
        <span className="text-muted-foreground text-xs">{rows.length}건</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="max-h-[34rem] divide-y overflow-y-auto rounded-xl border">
          {rows.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => setSel(r.slug)}
              className={`hover:bg-accent/50 block w-full px-3 py-2.5 text-left transition-colors ${
                sel === r.slug ? 'bg-accent' : ''
              }`}
            >
              <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                {r.featured && <span className="text-brand font-semibold">대표</span>}
                {r.visibility === 'private' && <span className="text-red-600">비공개</span>}
                {r.editedCount > 0 && <span className="text-brand">· 고침 {r.editedCount}</span>}
              </div>
              <div className="truncate text-sm font-medium">{r.title}</div>
              <div className="text-muted-foreground truncate text-[11px]">
                {[r.period, r.company].filter(Boolean).join(' · ') || r.slug}
              </div>
            </button>
          ))}
          {rows.length === 0 && (
            <p className="text-muted-foreground p-4 text-sm">해당하는 문서가 없습니다.</p>
          )}
        </div>

        {sel ? (
          <Editor slug={sel} onSaved={load} />
        ) : (
          <p className="text-muted-foreground rounded-xl border p-4 text-sm">
            왼쪽에서 문서를 고르면 여기서 고칠 수 있습니다.
          </p>
        )}
      </div>
    </div>
  );
}

function Editor({ slug, onSaved }: { slug: string; onSaved: () => void }) {
  const [fields, setFields] = useState<Field[] | null>(null);
  const [meta, setMeta] = useState<{ kind: string; source?: { type?: string } } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFields(null);
    try {
      const d = await api(`/api/admin/content?slug=${encodeURIComponent(slug)}`);
      setFields(d.fields);
      setMeta(d.doc);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    onSaved();
    void load();
  }, [onSaved, load]);

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!fields) return <p className="text-muted-foreground text-sm">불러오는 중…</p>;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <code className="text-foreground">{slug}</code>
        <span>· {KIND_LABEL[meta?.kind ?? ''] ?? meta?.kind}</span>
        <span>· 출처 {meta?.source?.type}</span>
      </div>

      {/*
        이 안내는 지워도 되는 문장이 아니다. 여기서 고친 값이 원본을 덮지
        않는다는 것을 모르면, 재수집 뒤 "왜 안 지워졌지" 를 찾게 된다.
      */}
      <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-xs leading-relaxed">
        고친 값은 원본과 <strong className="text-foreground">따로</strong> 저장됩니다. Notion 을
        다시 수집해도 살아남고, 되돌리기를 누르면 원본이 다시 보입니다.
      </p>

      {fields.map((f) => (
        <FieldRow key={f.key} slug={slug} field={f} onSaved={refresh} />
      ))}
    </div>
  );
}

function FieldRow({ slug, field, onSaved }: { slug: string; field: Field; onSaved: () => void }) {
  const current = field.edited ? field.override : field.original;
  const [text, setText] = useState(() => toText(field, current));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setText(toText(field, field.edited ? field.override : field.original));
  }, [field]);

  const dirty = text !== toText(field, current);
  const typed = field.type === 'text' || field.type === 'longtext' || field.type === 'list' || field.type === 'number';

  async function save(value: unknown) {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/admin/content', {
        method: 'PATCH',
        body: JSON.stringify({ slug, key: field.key, value }),
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium">{field.label}</span>
        <code className="text-muted-foreground text-[10.5px]">{field.key}</code>
        {field.edited && <span className="text-brand text-[10.5px] font-semibold">고침</span>}
      </div>

      {field.type === 'bool' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(current)}
            disabled={busy}
            onChange={(e) => void save(e.target.checked)}
          />
          {String(Boolean(current))}
        </label>
      ) : field.type === 'select' ? (
        <select
          value={String(current ?? '')}
          disabled={busy}
          onChange={(e) => void save(e.target.value)}
          className="rounded-xl border px-3 py-2 text-sm"
        >
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === 'longtext' || field.type === 'list' ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={field.type === 'longtext' ? 12 : 4}
          className="w-full rounded-xl border px-3 py-2 font-mono text-xs leading-relaxed"
        />
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-xl border px-3 py-2 text-sm"
        />
      )}

      {field.hint && <p className="text-muted-foreground mt-1 text-[11px]">{field.hint}</p>}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}

      {typed && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !dirty}
            onClick={() => void save(field.type === 'list' ? text.split('\n') : text)}
          >
            저장
          </Button>
          {field.edited && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              되돌리기
            </Button>
          )}
          {field.edited && (
            <span className="text-muted-foreground truncate text-[11px]">
              원본: {toText(field, field.original).slice(0, 60) || '(비어 있음)'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
