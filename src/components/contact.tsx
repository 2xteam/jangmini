'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';

/**
 * 연락 방법. `getContact` tool 이 DB(kind: 'profile')의 links 를 읽어 온다.
 * 원본은 원작자의 이메일·전화·SNS 가 하드코딩돼 있었다.
 */

type ContactData = { links?: { label: string; url: string }[]; note?: string } | undefined;

export function Contact({ data }: { data?: ContactData }) {
  const links = data?.links ?? [];

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
      className="mx-auto w-full max-w-5xl"
    >
      <Card className="w-full border-none px-0 shadow-none">
        <CardHeader className="px-0 pb-1">
          <CardTitle className="text-primary px-0 text-3xl font-bold">연락</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-0">
          {links.length ? (
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-accent/50 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    <span className="truncate">{l.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">연락처 정보를 불러오지 못했습니다.</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
