import { tool } from 'ai';
import { z } from 'zod';
import { getSkillGroups } from '@/lib/portfolio';

export const getSkills = tool({
  description:
    '장민의 기술 스택을 분류별로 가져온다. 숙련도는 노션에 기록된 것만 있고 없는 항목도 있다. ' +
    '기술·언어·도구 역량을 물었을 때 쓴다.',
  parameters: z.object({}),
  execute: async () => {
    const groups = await getSkillGroups();
    return {
      groups,
      note:
        '숙련도(level)는 0~1 이고 노션에 기록된 항목만 있다. ' +
        'level 이 null 인 것은 이력서에만 있는 항목이며 **숙련도를 추측해서 말하지 않는다.**',
    };
  },
});
