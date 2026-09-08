import { tool } from 'ai';
import { z } from 'zod';
import { getProfile } from '@/lib/portfolio';

export const getPresentation = tool({
  description:
    '장민 본인에 대한 소개를 가져온다. "누구세요", "본인 소개", "어떤 개발자인가요" 같은 질문에 쓴다.',
  parameters: z.object({}),
  execute: async () => {
    const p = await getProfile();
    if (!p) return { error: '프로필 정보를 찾지 못했다.' };
    return {
      name: p.title,
      headline: p.summary ?? null,
      about: p.body ?? null,
      links: p.links ?? [],
    };
  },
});
