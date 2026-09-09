'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * `/admin` 진입 비밀번호 재확인.
 *
 * 로그인 쿠키만으로 관리 화면을 열어 주면, 쿠키가 남은 기기를 누가 쓰기만
 * 해도 관리 화면이 열린다 → src/app/api/reader/stepup/route.ts
 */
export function StepUpForm({ readerId }: { readerId: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reader/stepup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? '확인에 실패했습니다.');
        return;
      }
      /** 서버 컴포넌트가 쿠키를 다시 읽어야 하므로 새로 고친다 */
      window.location.reload();
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-3">
      <p className="text-muted-foreground text-sm">
        <strong>{readerId}</strong> 계정의 비밀번호를 입력해 주세요. 확인 후 10분간 유지됩니다.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        autoFocus
        className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="rounded-xl">
        {busy ? '확인 중…' : '확인'}
      </Button>
    </form>
  );
}
