import { tool } from 'ai';
import { z } from 'zod';
import { getProjectList } from '@/lib/portfolio';

/**
 * 원본은 짧은 문자열만 돌려주고 컴포넌트가 하드코딩 데이터를 그렸다. 그래서
 * **모델이 실제 프로젝트를 보지 못해** "위에 있어요"만 말할 수 있었고,
 * "React Native 쓴 프로젝트가 뭐야" 같은 후속 질문에 답할 근거가 없었다.
 *
 * 여기서는 DB 를 조회해 데이터를 돌려준다. 반환값이 그대로 모델의 컨텍스트로
 * 들어가므로 **본문은 담지 않고 요약만** 담는다 (45건 본문 전체는 수만 토큰이다).
 * 기본은 대표 프로젝트만 — 전체를 매번 실으면 요청 단가가 올라간다.
 */
export const getProjects = tool({
  description:
    '장민의 프로젝트 목록을 가져온다. 기본은 대표 프로젝트만 반환한다. ' +
    '특정 기술(tech)이나 회사(company)로 좁힐 수 있고, all=true 면 전체를 반환한다. ' +
    '프로젝트 개수·경험한 기술·특정 기술을 쓴 프로젝트를 물었을 때 쓴다.',
  parameters: z.object({
    tech: z
      .string()
      .optional()
      .describe('기술 태그로 좁힌다. 예: React-Native, NEXT.JS, ASP.NET, openAI, MongoDB'),
    company: z
      .string()
      .optional()
      .describe('회사로 좁힌다. 트랙스로지스 · 설로인 · 큐텐테크놀로지 · 엑스오비스 · 개인 프로젝트'),
    all: z.boolean().optional().describe('true 면 대표만이 아니라 전체 45건을 반환한다'),
  }),
  execute: async ({ tech, company, all }) => {
    const filtered = Boolean(tech || company);
    const projects = await getProjectList({
      /** 필터가 있으면 대표 제한을 풀어야 결과가 나온다 */
      featuredOnly: !all && !filtered,
      tech,
      company,
    });
    const total = await getProjectList({});
    return {
      projects,
      shown: projects.length,
      totalPublic: total.length,
      note:
        !all && !filtered
          ? `대표 프로젝트 ${projects.length}건이다. 전체는 ${total.length}건이며 all=true 로 받을 수 있다.`
          : `조건에 맞는 ${projects.length}건이다.`,
    };
  },
});
