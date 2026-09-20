'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 못 채운 자리를 **한 번에 하나씩** 데려가며 채운다.
 *
 * 목록만 주면 실제로는 안 채워진다. 47건 중 어디에 무엇이 비었는지 찾는 일이
 * 채우는 일보다 오래 걸리기 때문이다. 그래서 화면이 다음 자리로 데려가고,
 * 사람은 답만 적는다 — 남은 수가 줄어드는 것이 보여야 끝까지 간다.
 *
 * 쓰기는 **Notion 으로 간다.** 사이트 DB 에만 채우면 인사담당자에게 건네는
 * PDF 는 빈 채로 남는다 → lib/notion-write.ts
 */

type Item = {
  slug: string;
  title: string;
  tier: string | null;
  editable: boolean;
  index: number;
  section: string;
  hint: string;
  kindLabel: string;
  line: string;
  whole: boolean;
};

type Data = { items: Item[]; total: number; byDoc: { slug: string; title: string; left: number }[] };

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

/** 채울 자리 조각만 뽑는다 — 문장 속에 있을 때 앞뒤를 보여주기 위해 */
const PH = /\[(?:숫자|한계|이유|결정)[^\]]*\]/;

export function TodosTab() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const d = (await api('/api/admin/todos')) as Data;
      setData(d);
      setAt((i) => Math.min(i, Math.max(0, d.items.length - 1)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const cur = items[at];

  /** 자리를 옮기면 입력칸을 비우고 초점을 준다 — 바로 타자를 칠 수 있어야 한다 */
  useEffect(() => {
    setValue('');
    setErr(null);
    box.current?.focus();
  }, [at, cur?.line]);

  const go = (d: number) => setAt((i) => (items.length ? (i + d + items.length) % items.length : 0));

  const act = async (action: 'fill' | 'drop') => {
    if (!cur || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/api/admin/todos', {
        method: 'PATCH',
        body: JSON.stringify({ slug: cur.slug, line: cur.line, action, value }),
      });
      setDone((n) => n + 1);
      await load();
      /** 지금 자리가 사라지므로 인덱스는 그대로 두면 자연히 다음 항목이 온다 */
      setAt((i) => Math.min(i, Math.max(0, items.length - 2)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /** ⌘/Ctrl + Enter 로 저장하고 다음 — 손이 입력칸을 떠나지 않게 */
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (value.trim()) void act('fill');
    }
  };

  const grouped = useMemo(() => data?.byDoc.filter((d) => d.left > 0) ?? [], [data]);

  if (!data) return <p className="text-muted-foreground p-6 text-sm">불러오는 중…</p>;

  if (!items.length) {
    return (
      <div className="rounded-2xl border p-8 text-center">
        <p className="text-lg font-semibold">남은 자리가 없습니다.</p>
        <p className="text-muted-foreground mt-2 text-sm">
          채울 곳을 모두 처리했습니다. Notion 에 새로 <code>[숫자: …]</code> 를 적으면 다음
          수집 때 여기 다시 나타납니다.
        </p>
        {done > 0 && (
          <p className="text-brand mt-3 text-sm font-medium">이번에 {done}곳을 처리했습니다.</p>
        )}
      </div>
    );
  }

  const total = items.length + done;
  const pct = Math.round((done / Math.max(total, 1)) * 100);
  const [before, afterText] = cur.whole ? ['', ''] : cur.line.replace(/^\s*[-*]\s*/, '').split(PH);

  return (
    <div className="space-y-5">
      {/* ── 얼마나 남았나 ─────────────────────────── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">
            남은 자리 <span className="text-brand tabular-nums">{items.length}</span>곳
            {done > 0 && (
              <span className="text-muted-foreground"> · 이번에 {done}곳 처리</span>
            )}
          </p>
          <p className="text-muted-foreground font-mono text-xs tabular-nums">
            {at + 1} / {items.length}
          </p>
        </div>
        <div className="bg-accent h-1.5 overflow-hidden rounded-full">
          <div className="bg-brand h-full transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* ── 어느 프로젝트에 몇 곳 남았나 ─────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {grouped.map((g) => {
          const first = items.findIndex((it) => it.slug === g.slug);
          const here = cur.slug === g.slug;
          return (
            <button
              key={g.slug}
              onClick={() => setAt(first)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                here ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              {g.title.length > 22 ? `${g.title.slice(0, 22)}…` : g.title}
              <span className="ml-1 opacity-60">{g.left}</span>
            </button>
          );
        })}
      </div>

      {/* ── 지금 채울 자리 ───────────────────────── */}
      <div className="rounded-2xl border p-5">
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <span className="bg-accent rounded px-1.5 py-0.5 font-medium">{cur.kindLabel}</span>
          <span>{cur.section}</span>
          <span>·</span>
          <a
            href={`/projects/${cur.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {cur.title}
          </a>
        </div>

        <h3 className="mt-3 text-lg font-bold tracking-[-0.02em]">{cur.hint}</h3>

        {/* 문장 한가운데면 앞뒤를 보여준다 — 무엇에 이어 쓰는지 보여야 문장이 맞는다 */}
        {!cur.whole && (
          <p className="bg-accent/40 mt-3 rounded-lg p-3 text-sm leading-relaxed">
            {before}
            <span className="bg-brand/15 text-brand rounded px-1 font-semibold">여기</span>
            {afterText}
          </p>
        )}

        <textarea
          ref={box}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          rows={cur.whole ? 3 : 1}
          disabled={busy || !cur.editable}
          placeholder={
            cur.whole
              ? '이 줄에 들어갈 문장을 적으세요. 예) 전환한 화면은 12개 중 4개입니다.'
              : '들어갈 값만 적으세요. 조사는 원래 문장에 있습니다. 예) 6개 구역에서 1개'
          }
          className="focus:border-foreground mt-3 w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none transition-colors disabled:opacity-50"
        />

        {/*
          문장 속에 끼워 넣을 때는 **결과를 그대로 보여준다.**
          왕복 시험에서 "관리 포인트를 1개로 로 줄였습니다" 가 나왔다 — 사람은
          조사를 붙여 쓰는데 원래 문장에도 조사가 있어서다. 앞뒤만 보여줘서는
          알아차리기 어렵고, 완성된 문장을 보여주면 바로 보인다.
        */}
        {!cur.whole && value.trim() && (
          <p className="mt-3 rounded-lg border border-dashed p-3 text-sm leading-relaxed">
            <span className="text-muted-foreground mr-2 text-xs">결과</span>
            {before}
            <span className="bg-brand/15 text-brand rounded px-1 font-semibold">{value.trim()}</span>
            {afterText}
          </p>
        )}

        <p className="text-muted-foreground mt-2 text-xs">
          모르는 숫자는 <strong>지우는 편이 낫습니다.</strong> 어림값 하나가 무너지면 나머지
          숫자까지 의심받습니다. · <kbd className="bg-accent rounded px-1">⌘/Ctrl</kbd> +{' '}
          <kbd className="bg-accent rounded px-1">Enter</kbd> 로 저장
        </p>

        {!cur.editable && (
          <p className="mt-2 text-xs text-amber-600">
            이 문서는 Notion 에서 오지 않아 여기서 고칠 수 없습니다.
          </p>
        )}

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => act('fill')} disabled={busy || !value.trim() || !cur.editable}>
            저장하고 다음 →
          </Button>
          <Button variant="outline" onClick={() => go(1)} disabled={busy}>
            건너뛰기
          </Button>
          <Button variant="outline" onClick={() => go(-1)} disabled={busy}>
            이전
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm('Notion 에서 이 줄을 지웁니다. 되돌리려면 Notion 의 기록을 쓰세요.')) {
                void act('drop');
              }
            }}
            disabled={busy || !cur.editable}
            className="text-muted-foreground hover:text-red-600"
          >
            이 줄 지우기
          </Button>
        </div>
      </div>

      {/* ── 남은 자리 전체 ───────────────────────── */}
      <details className="rounded-2xl border">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
          남은 자리 전체 보기 ({items.length})
        </summary>
        <ul className="divide-y border-t">
          {items.map((it, i) => (
            <li key={`${it.slug}-${it.line}`}>
              <button
                onClick={() => setAt(i)}
                className={`hover:bg-accent/40 flex w-full items-baseline gap-3 px-5 py-2 text-left text-sm transition-colors ${
                  i === at ? 'bg-accent/60' : ''
                }`}
              >
                <span className="text-muted-foreground w-24 shrink-0 truncate text-xs">
                  {it.section}
                </span>
                <span className="min-w-0 flex-1 truncate">{it.hint}</span>
                <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
                  {it.title.length > 18 ? `${it.title.slice(0, 18)}…` : it.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
