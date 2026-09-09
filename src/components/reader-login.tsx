'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';

/**
 * reader 로그인.
 *
 * **게이트가 아니다.** 익명 방문자도 사이트를 전부 볼 수 있고, 이 로그인은
 * 질문 수 제한을 푸는 용도다 — 채용 담당자는 계정이 없다.
 * 계정은 관리자가 손으로 발급한다 → src/models/Reader.ts
 *
 * myjane 여섯 앱의 로그인과 **아무 관계가 없다.** `user` DB 를 보지 않고
 * `jangmini` DB 의 `readers` 만 본다.
 */

type Me =
  | { loggedIn: false }
  | {
      loggedIn: true;
      readerId: string;
      role: 'reader' | 'admin';
      unlimited: boolean;
      expiresAt: number | null;
    };

/** 만료까지 남은 날. 지났으면 음수 */
function daysLeft(expiresAt: number | null): number | null {
  if (expiresAt == null) return null;
  return Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
}

export function ReaderLogin() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [readerId, setReaderId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch('/api/reader/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ loggedIn: false }));

  useEffect(() => {
    void load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/reader/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readerId: readerId.trim(), password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? '로그인에 실패했습니다.');
        return;
      }
      setPassword('');
      setOpen(false);
      await load();
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/reader/logout', { method: 'POST' }).catch(() => {});
    await load();
  }

  /** 서버 응답 전에는 아무것도 그리지 않는다 — 깜빡임을 막는다 */
  if (!me) return null;

  if (me.loggedIn) {
    const d = daysLeft(me.expiresAt);
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="bg-background/80 flex items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-lg"
          title={me.role === 'admin' ? '관리자' : '무제한 이용'}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {me.readerId}
          {d != null && <span className="text-muted-foreground">· D-{d}</span>}
          {me.expiresAt == null && <span className="text-muted-foreground">· 무기한</span>}
        </span>
        <button
          type="button"
          onClick={logout}
          aria-label="로그아웃"
          className="hover:bg-accent rounded-2xl p-2 transition-colors"
        >
          <LogOut className="text-muted-foreground h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="로그인"
        className="hover:bg-white/60 flex cursor-pointer items-center justify-center rounded-2xl bg-white/30 p-3 shadow-lg backdrop-blur-lg transition-colors"
      >
        <LogIn className="text-accent-foreground h-6 w-6 md:h-8 md:w-8" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-background z-52 rounded-2xl sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>발급받은 계정으로 로그인</DialogTitle>
            <DialogDescription>
              질문 수 제한 없이 이용할 수 있습니다. 계정이 없어도 사이트는 전부 보실 수 있어요.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="rid" className="text-muted-foreground mb-1 block text-xs">
                아이디
              </label>
              <input
                id="rid"
                value={readerId}
                onChange={(e) => setReaderId(e.target.value)}
                autoComplete="username"
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="rpw" className="text-muted-foreground mb-1 block text-xs">
                비밀번호
              </label>
              <input
                id="rpw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full rounded-xl">
              {busy ? '확인 중…' : '로그인'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
