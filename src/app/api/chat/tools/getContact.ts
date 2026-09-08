import { tool } from 'ai';
import { z } from 'zod';
import { getProfile } from '@/lib/portfolio';

export const getContact = tool({
  description: '연락 방법과 외부 링크(GitHub · 블로그 등)를 가져온다.',
  parameters: z.object({}),
  execute: async () => {
    const p = await getProfile();
    return {
      links: p?.links ?? [],
      note: '이메일로 연락받는 것을 선호한다. 휴대폰 번호는 먼저 알려주지 않는다.',
    };
  },
});
