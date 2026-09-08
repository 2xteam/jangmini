'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';

/**
 * 회사 경력. `getExperience` tool 이 DB(kind: 'experience')에서 읽어 온다.
 * 원본에는 이 컴포넌트가 없었다 — 원작자는 경력 대신 인턴십 카드 하나만 있었다.
 */

type ExperienceItem = {
  company: string;
  title: string;
  period: string | null;
  highlights: string[];
};
type ExperienceData = { experiences?: ExperienceItem[] } | undefined;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.19, 1, 0.22, 1] } },
};

export default function Experience({ data }: { data?: ExperienceData }) {
  const items = data?.experiences ?? [];
  if (!items.length) {
    return <div className="text-muted-foreground px-1 py-6">경력 정보를 불러오지 못했습니다.</div>;
  }

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
      className="mx-auto w-full max-w-5xl"
    >
      <Card className="w-full border-none px-0 pb-8 shadow-none">
        <CardHeader className="px-0 pb-1">
          <CardTitle className="text-primary px-0 text-4xl font-bold">경력</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <motion.ol
            className="relative space-y-6 border-l pl-5"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {items.map((e) => (
              <motion.li key={e.title} variants={itemVariants} className="relative">
                <span className="bg-primary absolute -left-[1.4rem] top-2 h-2 w-2 rounded-full" />
                <div className="text-muted-foreground text-xs">{e.period}</div>
                <h3 className="mt-0.5 font-semibold">{e.title}</h3>
                {e.highlights.length > 0 && (
                  <ul className="text-muted-foreground mt-1.5 list-disc space-y-0.5 pl-4 text-sm">
                    {e.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                )}
              </motion.li>
            ))}
          </motion.ol>
        </CardContent>
      </Card>
    </motion.div>
  );
}
