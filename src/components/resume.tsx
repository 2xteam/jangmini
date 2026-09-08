'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import Link from 'next/link';

/**
 * 학력·자격증·대외활동. `getResume` tool 이 DB 에서 읽어 온다.
 * 원본은 원작자 이력서 PDF(resume_giraud.pdf)를 띄우는 컴포넌트였다.
 */

type Entry = {
  title: string;
  period: string | null;
  category: string | null;
  org: string | null;
};
type ResumeData =
  | { education?: Entry[]; certificates?: Entry[]; activities?: Entry[] }
  | undefined;

function Section({ label, items }: { label: string; items: Entry[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-accent-foreground text-lg font-semibold">{label}</h3>
      <ul className="space-y-1.5">
        {items.map((e) => (
          <li key={e.title} className="text-sm">
            <span className="text-muted-foreground mr-2 inline-block min-w-[9.5rem] tabular-nums">
              {e.period ?? '—'}
            </span>
            <span>{e.title}</span>
            {e.org && <span className="text-muted-foreground"> · {e.org}</span>}
            {e.category && (
              <span className="text-muted-foreground ml-1 text-xs">({e.category})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Resume({ data }: { data?: ResumeData }) {
  const education = data?.education ?? [];
  const certificates = data?.certificates ?? [];
  const activities = data?.activities ?? [];
  const empty = !education.length && !certificates.length && !activities.length;

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
      className="mx-auto w-full max-w-5xl"
    >
      <Card className="w-full border-none px-0 pb-8 shadow-none">
        <CardHeader className="px-0 pb-1">
          <CardTitle className="text-primary px-0 text-3xl font-bold">학력 · 자격 · 활동</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 px-0">
          {empty ? (
            <p className="text-muted-foreground text-sm">정보를 불러오지 못했습니다.</p>
          ) : (
            <>
              <Section label="학력" items={education} />
              <Section label="자격증" items={certificates} />
              <Section label="교육 및 대외활동" items={activities} />
              <Link href="/resume" className="inline-block text-sm underline underline-offset-4">
                이력서 전체를 문서로 보기 →
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
