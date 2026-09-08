'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { Code, Cpu, Database, Globe, Terminal, Wrench } from 'lucide-react';

/**
 * 스킬은 `getSkills` tool 이 DB 에서 읽어 온 것을 그린다.
 * 원본은 배열이 이 파일에 하드코딩돼 있었다.
 *
 * 분류가 두 갈래로 섞여 있다 — 노션 리소스 DB 는 `소프트웨어 / 언어` 로,
 * 이력서 스킬셋 표는 `Programming Languages / Framework / Library / …` 로
 * 적혀 있다. 둘을 강제로 통일하지 않고 **원본 분류를 그대로 보여준다.**
 * 합치려면 어느 한쪽 표기를 버려야 하고, 그건 데이터를 고치는 일이다.
 */

type SkillItem = { name: string; level: number | null };
type SkillGroup = { category: string; items: SkillItem[] };
type SkillsData = { groups?: SkillGroup[] } | undefined;

const ICONS: { match: RegExp; icon: React.ReactNode }[] = [
  { match: /language|언어/i, icon: <Globe className="h-5 w-5" /> },
  { match: /framework|library/i, icon: <Code className="h-5 w-5" /> },
  { match: /cloud|infra/i, icon: <Cpu className="h-5 w-5" /> },
  { match: /tooling|devops/i, icon: <Wrench className="h-5 w-5" /> },
  { match: /^db$|database/i, icon: <Database className="h-5 w-5" /> },
  { match: /environment/i, icon: <Terminal className="h-5 w-5" /> },
];
const iconFor = (category: string) =>
  ICONS.find((i) => i.match.test(category))?.icon ?? <Code className="h-5 w-5" />;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.19, 1, 0.22, 1] } },
};
const badgeVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: 'easeOut' } },
};

/** 숙련도가 없는 항목이 절반이다. **추측해서 채우지 않는다** */
function LevelDots({ level }: { level: number | null }) {
  if (level == null) return null;
  const filled = Math.round(level * 5);
  return (
    <span className="ml-1.5 inline-flex gap-0.5 align-middle" aria-label={`숙련도 ${filled}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            i < filled ? 'bg-current opacity-80' : 'bg-current opacity-20'
          }`}
        />
      ))}
    </span>
  );
}

const Skills = ({ data }: { data?: SkillsData }) => {
  const groups = data?.groups ?? [];

  if (!groups.length) {
    return (
      <Card className="w-full border-none shadow-none">
        <CardContent className="text-muted-foreground px-0 py-6">
          기술 스택 정보를 불러오지 못했습니다.
        </CardContent>
      </Card>
    );
  }

  const hasAnyLevel = groups.some((g) => g.items.some((i) => i.level != null));

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.19, 1, 0.22, 1] }}
      className="mx-auto w-full max-w-5xl rounded-4xl"
    >
      <Card className="w-full border-none px-0 pb-12 shadow-none">
        <CardHeader className="px-0 pb-1">
          <CardTitle className="text-primary px-0 text-4xl font-bold">기술 스택</CardTitle>
          {hasAnyLevel && (
            <p className="text-muted-foreground mt-2 text-sm">
              점은 숙련도입니다. 기록이 없는 항목은 표시하지 않습니다.
            </p>
          )}
        </CardHeader>

        <CardContent className="px-0">
          <motion.div
            className="space-y-8 px-0"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {groups.map((group) => (
              <motion.div key={group.category} className="space-y-3 px-0" variants={itemVariants}>
                <div className="flex items-center gap-2">
                  {iconFor(group.category)}
                  <h3 className="text-accent-foreground text-lg font-semibold">
                    {group.category}
                  </h3>
                  <span className="text-muted-foreground text-sm">{group.items.length}</span>
                </div>

                <motion.div
                  className="flex flex-wrap gap-2"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {group.items.map((item) => (
                    <motion.div
                      key={item.name}
                      variants={badgeVariants}
                      whileHover={{ scale: 1.04, transition: { duration: 0.2 } }}
                    >
                      <Badge className="border px-3 py-1.5 font-normal">
                        {item.name}
                        <LevelDots level={item.level} />
                      </Badge>
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>
            ))}
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default Skills;
