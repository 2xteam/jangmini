import { tool } from 'ai';
import { z } from 'zod';
import { getByKind } from '@/lib/portfolio';

export const getExperience = tool({
  description:
    '장민의 회사 경력을 가져온다 (재직 기간과 담당 업무). 경력 연차·다닌 회사·직무를 물었을 때 쓴다.',
  parameters: z.object({}),
  execute: async () => {
    const docs = await getByKind('experience');
    return {
      experiences: docs.map((d) => ({
        company: d.company ?? d.title,
        title: d.title,
        period: d.period?.label ?? null,
        highlights: d.highlights ?? [],
      })),
    };
  },
});
