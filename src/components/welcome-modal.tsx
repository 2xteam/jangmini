'use client';

import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { dismissWelcome, isWelcomeDismissed } from '@/lib/client-id';

/**
 * 첫 진입 안내 모달.
 *
 * 원본은 영문에 자리표시자가 그대로 남아 있었다 — 제목이
 * "Welcome to AI Portfolio", 소제목이 `What's ????` 와 `Why ???` 였다.
 * "Contact me" 링크는 영문 질의를 챗으로 보내는 것이었는데, 문서 페이지가
 * 생긴 뒤로는 여기서 바로 보내는 편이 낫다.
 *
 * Phase 5 에서 여기에 두 가지가 더 붙는다 —
 *   · "다시 보지 않기" (localStorage, 접근 자체가 throw 할 수 있어 try/catch)
 *   · reader 계정 안내 (관리자가 발급한 id/password 가 있는지 묻는 자리)
 */
interface WelcomeModalProps {
  trigger?: React.ReactNode;
  /** 첫 방문이면 자동으로 띄운다. 랜딩에서만 켠다 */
  autoOpen?: boolean;
}

export default function WelcomeModal({ trigger, autoOpen = false }: WelcomeModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  /**
   * 첫 방문 자동 표시. **마운트 후에** 판단한다 — localStorage 는 SSR 에
   * 없고, 접근 자체가 throw 할 수 있다(프라이빗 모드) → src/lib/client-id.ts
   */
  useEffect(() => {
    if (autoOpen && !isWelcomeDismissed()) setIsOpen(true);
  }, [autoOpen]);

  const closeForever = () => {
    dismissWelcome();
    setIsOpen(false);
  };

  const defaultTrigger = (
    <Button
      variant="ghost"
      className="h-auto w-auto cursor-pointer rounded-2xl bg-white/30 p-3 shadow-lg backdrop-blur-lg hover:bg-white/60 focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
      onClick={() => setIsOpen(true)}
      aria-label="jangmini 소개 열기"
    >
      <BrandMark className="w-6 md:w-8" />
    </Button>
  );

  return (
    <>
      {trigger ? <div onClick={() => setIsOpen(true)}>{trigger}</div> : defaultTrigger}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-background z-52 max-h-[85vh] overflow-auto rounded-2xl border-none p-4 py-6 shadow-xl sm:max-w-[85vw] md:max-w-[80vw] lg:max-w-[720px]">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex h-full flex-col"
          >
            <DialogHeader className="relative flex flex-row items-start justify-between px-4 pt-4 pb-4 md:px-8 md:pt-8">
              <div>
                <DialogTitle className="text-2xl font-bold tracking-tight md:text-3xl">
                  장민의 포트폴리오입니다
                </DialogTitle>
                <DialogDescription className="mt-2 text-base">
                  묻고 싶은 걸 물어보셔도 되고, 문서로 바로 보셔도 됩니다.
                </DialogDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="sticky top-0 right-0 cursor-pointer rounded-full bg-black p-2 text-white hover:bg-black/90 hover:text-white"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-5 w-5" />
                <span className="sr-only">닫기</span>
              </Button>
            </DialogHeader>

            <div className="space-y-4 overflow-y-auto px-2 py-2 md:px-8">
              <section className="bg-accent w-full space-y-5 rounded-2xl p-5 md:p-7">
                <div className="space-y-2">
                  <h3 className="text-primary text-lg font-semibold">두 가지 방법으로 볼 수 있어요</h3>
                  <p className="text-accent-foreground text-sm leading-relaxed">
                    <strong>AI에게 묻기</strong> — 경력·프로젝트·기술을 대화로 찾아볼 수 있습니다.
                    <br />
                    <strong>문서로 보기</strong> — 훑어보거나 링크로 공유하기 좋습니다.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-primary text-lg font-semibold">답변의 근거</h3>
                  <p className="text-accent-foreground text-sm leading-relaxed">
                    답변은 <strong>기록된 이력과 프로젝트 문서</strong>에서만 가져옵니다.
                    기록에 없는 내용은 지어내지 않고 &quot;기록에 없다&quot;고 말합니다.
                    급여·개인 연락처·재직 중 회사의 내부 정보는 답하지 않습니다.
                  </p>
                </div>
              </section>
            </div>

            <div className="flex flex-col items-center gap-4 px-4 pt-4 pb-2 md:px-8 md:pb-6">
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setIsOpen(false)} className="h-auto rounded-full px-5 py-2.5" size="sm">
                  물어보기
                </Button>
                <Button asChild variant="outline" className="h-auto rounded-full px-5 py-2.5" size="sm">
                  <Link href="/resume" onClick={() => setIsOpen(false)}>
                    이력서 문서로 보기
                  </Link>
                </Button>
              </div>
              <Link
                href="/faq"
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground text-sm hover:underline"
              >
                무엇을 물어볼 수 있는지 보기 →
              </Link>
              {/*
               * "다시 보지 않기" 를 눌러도 우상단 버튼으로 언제든 다시 열 수
               * 있다 — 그래서 이 버튼이 정보를 영구히 감추지 않는다.
               */}
              <button
                type="button"
                onClick={closeForever}
                className="text-muted-foreground/70 hover:text-muted-foreground text-xs underline underline-offset-4"
              >
                다시 보지 않기
              </button>
            </div>
          </motion.div>
        </DialogContent>
      </Dialog>
    </>
  );
}
