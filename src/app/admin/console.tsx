'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 관리 콘솔. 탭 넷 — 사용량 · 설정 · 계정 · 추천질문.
 *
 * 화면을 라우트로 쪼개지 않고 한 페이지에 둔다. 관리자가 한 명이고 각 탭이
 * 목록 하나씩이라, 라우트를 나누면 step-up 검사와 로딩 처리를 네 번 쓰게 된다.
 *
 * `STEP_UP_REQUIRED` 를 받으면 새로 고친다 — 10분 창이 지난 것이므로
 * 서버 컴포넌트가 다시 step-up 폼을 그려야 한다.
 */

type Tab = 'usage' | 'settings' | 'readers' | 'answers';

const TABS: { id: Tab; label: string }[] = [
  { id: 'usage', label: '사용량' },
  { id: 'settings', label: '설정' },
  { id: 'readers', label: '계정' },
  { id: 'answers', label: '추천질문' },
];

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

export function AdminConsole() {
  const [tab, setTab] = useState<Tab>('usage');

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              tab === t.id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-accent/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'usage' && <UsageTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'readers' && <ReadersTab />}
      {tab === 'answers' && <AnswersTab />}
    </div>
  );
}

function Err({ e }: { e: string | null }) {
  if (!e) return null;
  return <p className="mb-3 text-sm text-red-600">{e}</p>;
}

/* ══════════════ 사용량 ═══════════════════════════════════ */

function UsageTab() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api('/api/admin/usage').then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <Err e={err} />;
  if (!data) return <p className="text-muted-foreground text-sm">불러오는 중…</p>;

  const t = data.today;
  const pctReq = t.limitRequests ? Math.round((t.requests / t.limitRequests) * 100) : 0;
  const pctTok = t.limitTokens ? Math.round((t.tokens / t.limitTokens) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="오늘 요청" value={`${t.requests} / ${t.limitRequests}`} sub={`${pctReq}%`} warn={pctReq >= 80} />
        <Stat label="캐시 히트" value={String(t.cacheHits)} sub={`OpenAI 호출 ${t.openaiCalls}`} />
        <Stat label="오늘 토큰" value={t.tokens.toLocaleString()} sub={`${pctTok}% of ${t.limitTokens.toLocaleString()}`} warn={pctTok >= 80} />
        <Stat label="차단" value={String(t.blocked)} sub={`캐시 ${data.cache.answers}건 · v${data.cache.sourceVersion}`} />
      </div>

      <section>
        <h3 className="mb-2 font-semibold">최근 14일</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="py-1.5">날짜</th>
                <th className="py-1.5">요청</th>
                <th className="py-1.5">캐시</th>
                <th className="py-1.5">OpenAI</th>
                <th className="py-1.5">토큰</th>
                <th className="py-1.5">차단</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d: any) => (
                <tr key={d._id} className="border-b last:border-b-0">
                  <td className="py-1.5 tabular-nums">{d._id}</td>
                  <td className="py-1.5 tabular-nums">{d.requests}</td>
                  <td className="py-1.5 tabular-nums">{d.cacheHits}</td>
                  <td className="py-1.5 tabular-nums">{d.openaiCalls}</td>
                  <td className="py-1.5 tabular-nums">{(d.tokensIn + d.tokensOut).toLocaleString()}</td>
                  <td className="py-1.5 tabular-nums">{d.blocked}</td>
                </tr>
              ))}
              {!data.days.length && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground py-3">
                    아직 기록이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">최근 질문 30건</h3>
        <p className="text-muted-foreground mb-2 text-xs">
          방문자 식별자(clientId · IP 해시)는 표시하지 않습니다.
        </p>
        <ul className="space-y-1.5 text-sm">
          {data.recent.map((r: any, i: number) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {new Date(r.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 text-xs ${
                  r.source === 'cache' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {r.source === 'cache' ? '캐시' : 'OpenAI'}
              </span>
              <span className="truncate">{r.question}</span>
            </li>
          ))}
          {!data.recent.length && <li className="text-muted-foreground">아직 없습니다.</li>}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${warn ? 'border-amber-400 bg-amber-50' : ''}`}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

/* ══════════════ 설정 ═══════════════════════════════════ */

function SettingsTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    api('/api/admin/settings')
      .then((d) => setRows(d.settings))
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  async function save(key: string, raw: string, isBool: boolean) {
    setSaving(key);
    setErr(null);
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ key, value: isBool ? raw === 'true' : raw }),
      });
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(null);
    }
  }

  if (err && !rows) return <Err e={err} />;
  if (!rows) return <p className="text-muted-foreground text-sm">불러오는 중…</p>;

  return (
    <div>
      <Err e={err} />
      <p className="text-muted-foreground mb-3 text-xs">
        저장하면 즉시 반영됩니다. 채팅을 켜고 끄는 <code>CHAT_ENABLED</code> 는 여기에 없습니다 —
        환경 변수입니다.
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <SettingRow key={r._id} row={r} saving={saving === r._id} onSave={save} />
        ))}
      </div>
    </div>
  );
}

function SettingRow({
  row,
  saving,
  onSave,
}: {
  row: any;
  saving: boolean;
  onSave: (key: string, raw: string, isBool: boolean) => void;
}) {
  const isBool = typeof row.value === 'boolean';
  const [val, setVal] = useState(String(row.value));
  const dirty = val !== String(row.value);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{row.label}</div>
        <code className="text-muted-foreground text-xs">{row._id}</code>
      </div>
      {isBool ? (
        <select
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="rounded-lg border px-2 py-1"
        >
          <option value="true">켜짐</option>
          <option value="false">꺼짐</option>
        </select>
      ) : (
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-40 rounded-lg border px-2 py-1 tabular-nums"
        />
      )}
      <Button
        size="sm"
        disabled={!dirty || saving}
        onClick={() => onSave(row._id, val, isBool)}
        className="rounded-lg"
      >
        {saving ? '저장 중' : '저장'}
      </Button>
    </div>
  );
}

/* ══════════════ 계정 ═══════════════════════════════════ */

function ReadersTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ readerId: '', password: '', label: '', expiresAt: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/admin/readers')
      .then((d) => setRows(d.readers))
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/admin/readers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ readerId: '', password: '', label: '', expiresAt: '' });
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(readerId: string, body: Record<string, unknown>) {
    setErr(null);
    try {
      await api('/api/admin/readers', { method: 'PATCH', body: JSON.stringify({ readerId, ...body }) });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (!rows) return err ? <Err e={err} /> : <p className="text-muted-foreground text-sm">불러오는 중…</p>;

  return (
    <div className="space-y-6">
      <Err e={err} />

      <section>
        <h3 className="mb-2 font-semibold">발급된 계정</h3>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.readerId} className="rounded-xl border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.readerId}</span>
                {r.role === 'admin' && (
                  <span className="rounded bg-violet-100 px-1.5 text-xs text-violet-800">admin</span>
                )}
                <span className="text-muted-foreground text-xs">
                  {r.expiresAt ? `만료 ${String(r.expiresAt).slice(0, 10)}` : '무기한'}
                  {' · '}
                  {r.dailyCap == null ? '상한 없음' : `일 ${r.dailyCap}회`}
                  {' · '}
                  로그인 {r.loginCount}회
                </span>
                <span className="ml-auto flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => patch(r.readerId, { enabled: !r.enabled })}
                  >
                    {r.enabled ? '중지' : '재개'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => {
                      const pw = window.prompt(`${r.readerId} 의 새 비밀번호 (8자 이상)`);
                      if (pw) patch(r.readerId, { password: pw });
                    }}
                  >
                    비밀번호 변경
                  </Button>
                </span>
              </div>
              {!r.enabled && <p className="mt-1 text-xs text-red-600">사용 중지된 계정입니다.</p>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">새 계정 발급</h3>
        <form onSubmit={create} className="grid max-w-xl gap-2 sm:grid-cols-2">
          <input
            placeholder="아이디 (영문·숫자 3~32자)"
            value={form.readerId}
            onChange={(e) => setForm({ ...form, readerId: e.target.value })}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <input
            placeholder="비밀번호 (8자 이상)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <input
            placeholder="메모 (누구에게 준 계정인지)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={form.expiresAt}
            onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={busy} className="rounded-xl sm:col-span-2">
            {busy ? '발급 중…' : '발급'}
          </Button>
        </form>
        <p className="text-muted-foreground mt-2 text-xs">
          만료일을 비우면 무기한입니다. 새 계정은 비밀번호 8자 이상을 요구합니다.
        </p>
      </section>
    </div>
  );
}

/* ══════════════ 추천질문 ═══════════════════════════════ */

function AnswersTab() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api('/api/admin/answers').then(setData).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  if (!data) return err ? <Err e={err} /> : <p className="text-muted-foreground text-sm">불러오는 중…</p>;

  return (
    <div>
      <Err e={err} />
      <p className="text-muted-foreground mb-3 text-xs">
        캐시 버전 v{data.sourceVersion}. 답변을 고치고 <strong>검수</strong>를 켜면{' '}
        <code>pnpm warm</code> 이 그 답변을 덮지 않습니다.
      </p>
      <div className="space-y-3">
        {data.items.map((it: any) => (
          <AnswerRow key={it.key} item={it} onSaved={load} />
        ))}
      </div>
    </div>
  );
}

function AnswerRow({ item, onSaved }: { item: any; onSaved: () => void }) {
  const [text, setText] = useState(item.answer ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = text !== (item.answer ?? '');

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/admin/answers', {
        method: 'PATCH',
        body: JSON.stringify({ key: item.key, ...(dirty ? { answer: text } : {}), ...extra }),
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.question}</span>
        <code className="text-muted-foreground text-xs">{item.key}</code>
        <span className="text-muted-foreground text-xs">
          클릭 {item.hits} · 캐시히트 {item.answerHits}
        </span>
        {item.reviewed && (
          <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">검수됨</span>
        )}
        {!item.enabled && (
          <span className="rounded bg-neutral-200 px-1.5 text-xs text-neutral-700">숨김</span>
        )}
      </div>

      {item.answer == null ? (
        <p className="mt-2 text-xs text-amber-700">
          이 버전의 캐시된 답변이 없습니다. <code>pnpm warm -- --write --lang=ko</code> 를 돌려 주세요.
        </p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="mt-2 w-full rounded-lg border p-2 text-sm"
          />
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" disabled={!dirty || busy} onClick={() => save()} className="rounded-lg">
              {busy ? '저장 중' : '저장'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => save({ reviewed: !item.reviewed })}
              className="rounded-lg"
            >
              {item.reviewed ? '검수 해제' : '검수 완료로 표시'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => save({ enabled: !item.enabled })}
              className="rounded-lg"
            >
              {item.enabled ? '숨기기' : '보이기'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
