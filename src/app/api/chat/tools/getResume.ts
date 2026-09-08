import { tool } from 'ai';
import { z } from 'zod';
import { getByKind } from '@/lib/portfolio';

export const getResume = tool({
  description:
    '학력·자격증·대외활동을 가져온다. 학교·전공·자격증·봉사·어학연수를 물었을 때 쓴다.',
  parameters: z.object({}),
  execute: async () => {
    const [education, certificates, activities] = await Promise.all([
      getByKind('education'),
      getByKind('certificate'),
      getByKind('activity'),
    ]);
    const pick = (d: { title: string; summary?: string; category?: string; company?: string }) => ({
      title: d.title,
      period: d.summary ?? null,
      category: d.category ?? null,
      org: d.company ?? null,
    });
    return {
      education: education.map(pick),
      certificates: certificates.map(pick),
      activities: activities.map(pick),
    };
  },
});
