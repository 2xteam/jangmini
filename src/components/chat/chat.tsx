'use client';
import { useChat } from '@ai-sdk/react';
import { AnimatePresence, motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

// Component imports
import ChatBottombar from '@/components/chat/chat-bottombar';
import ChatLanding from '@/components/chat/chat-landing';
import ChatMessageContent from '@/components/chat/chat-message-content';
import { SimplifiedChatView } from '@/components/chat/simple-chat-view';
import {
  ChatBubble,
  ChatBubbleMessage,
} from '@/components/ui/chat/chat-bubble';
import WelcomeModal from '@/components/welcome-modal';
import HelperBoost from './HelperBoost';
import { getClientId } from '@/lib/client-id';
import { findSuggestion } from '@/lib/suggestions';
import { SiteMenu } from '@/components/site-menu';
import { ReaderLogin } from '@/components/reader-login';

// ClientOnly component for client-side rendering
//@ts-ignore
const ClientOnly = ({ children }) => {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return null;
  }

  return <>{children}</>;
};

// Define Avatar component props interface
interface AvatarProps {
  hasActiveTool: boolean;
  isTalking: boolean;
}

// Dynamic import of Avatar component
const Avatar = dynamic<AvatarProps>(
  () =>
    Promise.resolve(({ hasActiveTool, isTalking }: AvatarProps) => {
      // This function will only execute on the client
      const isIOS = () => {
        // Multiple detection methods
        const userAgent = window.navigator.userAgent;
        const platform = window.navigator.platform;
        const maxTouchPoints = window.navigator.maxTouchPoints || 0;

        // UserAgent-based check
        const isIOSByUA =
          //@ts-ignore
          /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;

        // Platform-based check
        const isIOSByPlatform = /iPad|iPhone|iPod/.test(platform);

        // iPad Pro check
        const isIPadOS =
          //@ts-ignore
          platform === 'MacIntel' && maxTouchPoints > 1 && !window.MSStream;

        // Safari check
        const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);

        return isIOSByUA || isIOSByPlatform || isIPadOS || isSafari;
      };

      // Conditional rendering based on detection
      return (
        <div
          className={`flex items-center justify-center rounded-full transition-all duration-300 ${hasActiveTool ? 'h-20 w-20' : 'h-28 w-28'}`}
        >
          <div
            className="relative cursor-pointer"
            onClick={() => (window.location.href = '/')}
          >
            {/*
             * 원본은 여기서 메모지 **영상**(webm/mp4)을 재생하고, 답변 중일 때
             * 재생·정지로 "말하는" 느낌을 줬다. 그 세 파일을 지웠으므로 404 를
             * 네 번 받고 있었고, 영상의 play/pause 가 AbortError 를 냈다.
             *
             * 지금은 정지 이미지 두 장으로 같은 효과를 낸다 — 답변 중에는
             * 윙크 버전으로 바꾼다. 사용자가 준 메모지가 두 표정이라 가능하다.
             */}
            <img
              src={isTalking ? '/avatar-wink.png' : '/avatar.png'}
              alt="장민"
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      );
    }),
  { ssr: false }
);

const MOTION_CONFIG = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
  transition: {
    duration: 0.3,
    ease: 'easeOut',
  },
};

const Chat = () => {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('query');
  /**
   * `?q=<key>` 는 추천 질문의 고정 key 다. FAQ·랜딩에서 이걸 보내면 캐시가
   * 맞는다. `?query=<문장>` 은 자유 입력이라 캐시를 타지 않는다.
   */
  const initialKey = searchParams.get('q');
  const initialSuggestion = initialKey ? findSuggestion(initialKey) : null;
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  /**
   * localStorage 접근이 throw 할 수 있어(프라이빗 모드) 마운트 후에 읽는다.
   * SSR 에서 읽으면 hydration 이 어긋난다.
   */
  const [clientId, setClientId] = useState('unknown');
  useEffect(() => setClientId(getClientId()), []);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [isTalking, setIsTalking] = useState(false);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    stop,
    setMessages,
    setInput,
    reload,
    addToolResult,
    append,
  } = useChat({
    /**
     * 익명 제한(L2)에 쓰는 식별자. 약한 값이라 서버가 IP 해시와 함께
     * 본다 → src/lib/guard.ts
     */
    body: { clientId },
    onResponse: (response) => {
      if (response) {
        setLoadingSubmit(false);
        setIsTalking(true);
      }
    },
    onFinish: () => {
      setLoadingSubmit(false);
      setIsTalking(false);
    },
    onError: (error) => {
      setLoadingSubmit(false);
      setIsTalking(false);
      console.error('Chat error:', error.message, error.cause);
      toast.error(`Error: ${error.message}`);
    },
    onToolCall: (tool) => {
      const toolName = tool.toolCall.toolName;
      console.log('Tool call:', toolName);
    },
  });

  const { currentAIMessage, latestUserMessage, hasActiveTool } = useMemo(() => {
    const latestAIMessageIndex = messages.findLastIndex(
      (m) => m.role === 'assistant'
    );
    const latestUserMessageIndex = messages.findLastIndex(
      (m) => m.role === 'user'
    );

    const result = {
      currentAIMessage:
        latestAIMessageIndex !== -1 ? messages[latestAIMessageIndex] : null,
      latestUserMessage:
        latestUserMessageIndex !== -1 ? messages[latestUserMessageIndex] : null,
      hasActiveTool: false,
    };

    if (result.currentAIMessage) {
      result.hasActiveTool =
        result.currentAIMessage.parts?.some(
          (part) =>
            part.type === 'tool-invocation' &&
            part.toolInvocation?.state === 'result'
        ) || false;
    }

    if (latestAIMessageIndex < latestUserMessageIndex) {
      result.currentAIMessage = null;
    }

    return result;
  }, [messages]);

  const isToolInProgress = messages.some(
    (m) =>
      m.role === 'assistant' &&
      m.parts?.some(
        (part) =>
          part.type === 'tool-invocation' &&
          part.toolInvocation?.state !== 'result'
      )
  );

  /**
   * `suggestionKey` 를 함께 보내면 서버가 **사전 생성 답변 캐시**를 조회한다
   * (첫 턴에서만). 캐시가 맞으면 OpenAI 를 호출하지 않는다.
   * 자유 입력은 key 가 없으므로 캐시를 타지 않는다 — 텍스트를 해시하면
   * 거의 안 맞고 방문자가 캐시를 채울 수 있다 → src/lib/suggestions.ts
   */
  const submitQuery = (query: string, suggestionKey?: string) => {
    if (!query.trim() || isToolInProgress) return;

    setLoadingSubmit(true);
    append(
      { role: 'user', content: query },
      suggestionKey ? { body: { clientId, suggestionKey } } : undefined
    );
  };

  useEffect(() => {
    
    if (initialSuggestion && !autoSubmitted) {
      setAutoSubmitted(true);
      setInput('');
      submitQuery(initialSuggestion.question, initialSuggestion.key);
    } else if (initialQuery && !autoSubmitted) {
      setAutoSubmitted(true);
      setInput('');
      submitQuery(initialQuery);
    }
  }, [initialQuery, initialSuggestion, autoSubmitted]);


  //@ts-ignore
  const onSubmit = (e) => {
    e.preventDefault();
    
    if (!input.trim() || isToolInProgress) return;
    submitQuery(input);
    setInput('');
  };

  const handleStop = () => {
    stop();
    setLoadingSubmit(false);
    setIsTalking(false);
  };

  // Check if this is the initial empty state (no messages)
  const isEmptyState =
    !currentAIMessage && !latestUserMessage && !loadingSubmit;

  // Calculate header height based on hasActiveTool
  const headerHeight = hasActiveTool ? 100 : 180;

  return (
    <div className="relative h-screen overflow-hidden">
      <div className="absolute top-6 right-6 z-51 flex items-center gap-1 md:right-8">
        {/*
          * 랜딩과 같은 순서·같은 모양이다 — 안내(i) · 로그인 · 메뉴.
          * 원본은 여기만 커스텀 trigger 를 넘겨 랜딩과 생김새가 달랐다.
          */}
        <WelcomeModal />
        <ReaderLogin />
        <SiteMenu />
      </div>

      {/* Fixed Avatar Header with Gradient */}
      <div
        className="fixed top-0 right-0 left-0 z-50"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.95) 30%, rgba(255, 255, 255, 0.8) 50%, rgba(255, 255, 255, 0) 100%)',
        }}
      >
        <div
          className={`transition-all duration-300 ease-in-out ${hasActiveTool ? 'pt-6 pb-0' : 'py-6'}`}
        >
          <div className="flex justify-center">
            <ClientOnly>
              <Avatar
                hasActiveTool={hasActiveTool}
                isTalking={isTalking}
              />
            </ClientOnly>
          </div>

          <AnimatePresence>
            {latestUserMessage && !currentAIMessage && (
              <motion.div
                {...MOTION_CONFIG}
                className="mx-auto flex max-w-3xl px-4"
              >
                <ChatBubble variant="sent">
                  <ChatBubbleMessage>
                    <ChatMessageContent
                      message={latestUserMessage}
                      isLast={true}
                      isLoading={false}
                      reload={() => Promise.resolve(null)}
                    />
                  </ChatBubbleMessage>
                </ChatBubble>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="container mx-auto flex h-full max-w-3xl flex-col">
        {/* Scrollable Chat Content */}
        <div
          className="flex-1 overflow-y-auto px-2"
          style={{ paddingTop: `${headerHeight}px` }}
        >
          <AnimatePresence mode="wait">
            {isEmptyState ? (
              <motion.div
                key="landing"
                className="flex min-h-full items-center justify-center"
                {...MOTION_CONFIG}
              >
                <ChatLanding submitQuery={submitQuery} />
              </motion.div>
            ) : currentAIMessage ? (
              <div className="pb-4">
                <SimplifiedChatView
                  message={currentAIMessage}
                  isLoading={isLoading}
                  reload={reload}
                  addToolResult={addToolResult}
                />
              </div>
            ) : (
              loadingSubmit && (
                <motion.div
                  key="loading"
                  {...MOTION_CONFIG}
                  className="px-4 pt-18"
                >
                  <ChatBubble variant="received">
                    <ChatBubbleMessage isLoading />
                  </ChatBubble>
                </motion.div>
              )
            )}
          </AnimatePresence>
        </div>

        {/* Fixed Bottom Bar */}
        <div className="sticky bottom-0 bg-white px-2 pt-3 md:px-0 md:pb-4">
          <div className="relative flex flex-col items-center gap-3">
            <HelperBoost submitQuery={submitQuery} setInput={setInput} />
            <ChatBottombar
              input={input}
              handleInputChange={handleInputChange}
              handleSubmit={onSubmit}
              isLoading={isLoading}
              stop={handleStop}
              isToolInProgress={isToolInProgress}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;
