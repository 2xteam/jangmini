'use client';

import { Suspense } from 'react';
import Chat from '@/components/chat/chat';

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="text-muted-foreground flex h-screen items-center justify-center text-sm">
          불러오는 중…
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}