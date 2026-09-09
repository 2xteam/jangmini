/**
 * 추천 질문의 답변을 미리 만들어 `answers` 에 넣는다. **비용 방어 L0.**
 *
 *   pnpm warm             무엇을 만들지만 보여준다 (dry-run, 기본)
 *   pnpm warm -- --write  실제로 OpenAI 를 호출하고 저장한다
 *   pnpm warm -- --write --lang=ko    한국어만
 *   pnpm warm -- --write --key=skills 한 건만
 *   pnpm warm -- --write --force      이미 있는 것도 다시 만든다
 *
 * ## 왜 미리 만드나
 *
 * 추천 질문은 방문자가 누를 확률이 가장 높은 질문이다. 미리 만들어 두면
 *   · 그 질문들은 **OpenAI 호출이 0회** 다 (첫 방문자에게도)
 *   · 채용 담당자가 볼 확률이 가장 높은 답변을 **사람이 검수한 문장**으로 고정한다
 *   · 응답이 즉시 나온다
 *
 * `reviewed: true` 인 답변은 건너뛴다 — 손으로 고친 문장을 덮지 않는다.
 * (`--force` 를 주면 덮는다)
 *
 * ## 프롬프트는 챗 라우트와 같은 것을 쓴다
 *
 * `src/app/api/chat/prompt.ts` 의 `SYSTEM_PROMPT_TEXT` 를 읽어 온다. 여기에
 * 복사본을 두면 프롬프트를 고칠 때 한쪽만 바뀌어, 캐시된 답변과 실시간
 * 답변의 말투가 갈린다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const DB_NAME = 'jangmini';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const FORCE = argv.includes('--force');
const ONLY_LANG = (argv.find((a) => a.startsWith('--lang=')) ?? '').split('=')[1] ?? '';
const ONLY_KEY = (argv.find((a) => a.startsWith('--key=')) ?? '').split('=')[1] ?? '';

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(path.join(process.cwd(), file), 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
      }
    } catch {
      /* 없으면 넘어간다 */
    }
  }
}
loadEnv();

const { MONGO_URI, OPENAI_API_KEY } = process.env;
if (!MONGO_URI) {
  console.error('✗ MONGO_URI 가 없습니다.');
  process.exit(1);
}
if (WRITE && !OPENAI_API_KEY) {
  console.error('✗ OPENAI_API_KEY 가 없습니다.');
  process.exit(1);
}

/**
 * TS 파일에서 값을 뽑아 온다. 스크립트는 순수 node 라 TS 를 import 할 수 없다.
 *
 * 파싱이 아니라 **정규식으로 긁는다** — 두 파일의 모양이 단순하고 고정이라
 * 여기에 빌드 단계를 하나 더 두는 것이 과하다. 대신 못 찾으면 멈춘다
 * (조용히 빈 목록으로 진행하면 답변이 0건인데 성공처럼 보인다).
 */
function readSuggestions() {
  const src = readFileSync('src/lib/suggestions.ts', 'utf8');
  const out = [];
  const re =
    /\{\s*key:\s*'([^']+)',\s*category:\s*'([^']+)',\s*question:\s*'([^']+)'(?:,\s*primary:\s*(true|false))?\s*,?\s*\}/g;
  for (const m of src.matchAll(re)) {
    out.push({ key: m[1], category: m[2], question: m[3], primary: m[4] === 'true' });
  }
  /** 줄바꿈이 들어간 항목은 위 정규식에 안 걸린다. 개별로 한 번 더 긁는다 */
  const re2 = /key:\s*'([^']+)',\s*\n\s*category:\s*'([^']+)',\s*\n\s*question:\s*'([^']+)'/g;
  for (const m of src.matchAll(re2)) {
    if (!out.some((o) => o.key === m[1])) {
      out.push({ key: m[1], category: m[2], question: m[3], primary: /primary:\s*true/.test(src.slice(m.index, m.index + 260)) });
    }
  }
  if (!out.length) {
    console.error('✗ src/lib/suggestions.ts 에서 항목을 읽지 못했습니다. 형식이 바뀌었는지 확인해 주세요.');
    process.exit(1);
  }
  return out;
}

function readSystemPrompt() {
  const src = readFileSync('src/app/api/chat/prompt.ts', 'utf8');
  /** `const X = \`...\`.trim();` 형태의 절들을 순서대로 이어 붙인다 */
  const names = ['CHARACTER', 'TONE', 'RESPONSE_STRUCTURE', 'BACKGROUND', 'TOOL_USAGE', 'RULES'];
  const parts = [];
  for (const n of names) {
    const m = new RegExp('const ' + n + " = `([\\s\\S]*?)`\\.trim\\(\\)").exec(src);
    if (!m) {
      console.error(`✗ prompt.ts 에서 ${n} 을 읽지 못했습니다.`);
      process.exit(1);
    }
    parts.push(m[1].trim());
  }
  return parts.join('\n\n');
}

const SUGGESTIONS = readSuggestions();
const SYSTEM_PROMPT = readSystemPrompt();

const LANGS = ONLY_LANG ? [ONLY_LANG] : ['ko', 'en'];
const TARGETS = SUGGESTIONS.filter((s) => !ONLY_KEY || s.key === ONLY_KEY);

/**
 * tool 을 붙이지 않는다.
 *
 * 사전 생성은 **서버 라우트 밖**에서 돌므로 tool 의 DB 조회를 그대로 쓸 수
 * 없다. 대신 프로젝트·경력·스킬 요약을 프롬프트에 함께 넣어 같은 사실을
 * 보게 한다 — 답변 내용이 실시간 답변과 어긋나지 않는 것이 중요하다.
 */
async function buildFacts(db) {
  const col = db.collection('portfolio');
  const [profile, exps, featured, skills, edu, certs] = await Promise.all([
    col.findOne({ kind: 'profile' }),
    col.find({ kind: 'experience' }).sort({ order: 1 }).toArray(),
    col.find({ kind: 'project', featured: true }).sort({ order: 1 }).toArray(),
    col.find({ kind: 'skill' }).toArray(),
    col.find({ kind: 'education' }).toArray(),
    col.find({ kind: 'certificate' }).toArray(),
  ]);
  const allProjects = await col.countDocuments({ kind: 'project' });

  const skillByCat = {};
  for (const s of skills) (skillByCat[s.category ?? '기타'] ??= []).push(s.title);

  return [
    '# 사실 (이 범위 안에서만 답한다)',
    '',
    /**
     * ⚠️ 실제 라우트를 적어 준다. 안 적으면 **없는 경로를 지어낸다** —
     * contact 답변이 `/contact` 를 안내했고 그런 페이지는 없다.
     */
    '## 이 사이트에 있는 페이지 (여기 없는 경로를 안내하지 않는다)',
    '- /resume  이력서 문서 (경력·대표 프로젝트·기술·학력)',
    '- /projects  프로젝트 전체 목록. /projects/<slug> 가 상세',
    '- /faq  자주 묻는 것',
    '- /chat  이 대화 화면',
    '',
    `## 프로필\n${profile?.title} · ${profile?.summary}\n${(profile?.body ?? '').slice(0, 700)}`,
    '',
    /**
     * 링크를 빠뜨렸더니 연락처 답변이 "이력서에 기재된 이메일로" 라고만 하고
     * **정작 주소를 주지 못했다.**
     */
    '## 연락 수단 (이 목록에 있는 것만 알려준다)',
    ...(profile?.links ?? []).map((l) => `- ${l.label} → ${l.url}`),
    '',
    '## 경력',
    ...exps.map((e) => `- ${e.period?.label ?? ''} ${e.title}\n  ${(e.highlights ?? []).join(' / ')}`),
    '',
    `## 대표 프로젝트 (전체 ${allProjects}건 중 ${featured.length}건)`,
    ...featured.map(
      (p) =>
        `- ${p.period?.label ?? ''} [${p.company ?? ''}] ${p.title} (/projects/${p.slug})\n` +
        `  ${p.summary ?? ''}\n  기술: ${(p.techStack ?? []).join(', ')}\n` +
        `  성과: ${(p.highlights ?? []).slice(0, 3).join(' / ')}`,
    ),
    '',
    '## 기술 스택',
    ...Object.entries(skillByCat).map(([c, list]) => `- ${c}: ${list.join(', ')}`),
    '',
    '## 학력·자격',
    ...edu.map((e) => `- ${e.summary ?? ''} ${e.title}`),
    ...certs.map((e) => `- ${e.summary ?? ''} ${e.title}`),
  ].join('\n');
}

const LANG_RULE = {
  ko: '한국어로 답한다.',
  en: 'Answer in English.',
};

async function callOpenAI({ system, question, model }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question },
      ],
      max_tokens: 800,
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return {
    answer: json.choices?.[0]?.message?.content?.trim() ?? '',
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
  };
}

const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 20000 });

try {
  await client.connect();
  const db = client.db(DB_NAME);

  /* ── suggestions 컬렉션 동기화 ────────────────────────────
   * 문장의 원본은 src/lib/suggestions.ts 다. 여기서는 운영 상태(enabled·
   * order·hits)를 유지하며 문장만 갱신한다.
   */
  let syncedNew = 0;
  for (const [i, s] of SUGGESTIONS.entries()) {
    const r = await db.collection('suggestions').updateOne(
      { key: s.key },
      {
        $set: {
          category: s.category,
          question: s.question,
          primary: s.primary,
          order: i,
          updatedAt: new Date(),
        },
        $setOnInsert: { enabled: true, hits: 0, createdAt: new Date() },
      },
      { upsert: true },
    );
    if (r.upsertedCount) syncedNew += 1;
  }
  console.log(`suggestions  ${SUGGESTIONS.length}건 동기화 (신규 ${syncedNew})\n`);

  const settings = await db.collection('settings').findOne({ _id: 'content.sourceVersion' });
  const sourceVersion = Number(settings?.value ?? 1);
  const modelDoc = await db.collection('settings').findOne({ _id: 'chat.model' });
  const model = String(modelDoc?.value ?? 'gpt-4o-mini');

  const facts = await buildFacts(db);
  console.log(`모델 ${model} · sourceVersion ${sourceVersion} · 사실 블록 ${facts.length}자\n`);

  /* ── 만들 목록 ──────────────────────────────────────────── */
  const plan = [];
  for (const s of TARGETS) {
    for (const lang of LANGS) {
      const existing = await db
        .collection('answers')
        .findOne({ key: s.key, lang, sourceVersion });
      if (existing && !FORCE) {
        plan.push({ ...s, lang, skip: existing.reviewed ? '검수됨' : '이미 있음' });
        continue;
      }
      if (existing?.reviewed && !FORCE) {
        plan.push({ ...s, lang, skip: '검수됨' });
        continue;
      }
      plan.push({ ...s, lang, skip: null });
    }
  }

  const todo = plan.filter((p) => !p.skip);
  console.log(`─── 계획 ─── 만들 것 ${todo.length} · 건너뜀 ${plan.length - todo.length}`);
  for (const p of plan) {
    console.log(
      `  ${p.lang}  ${p.key.padEnd(20)} ${p.skip ? '건너뜀(' + p.skip + ')' : '생성'}  ${p.question.slice(0, 34)}`,
    );
  }

  if (!WRITE) {
    console.log(
      `\n※ dry-run 입니다. OpenAI 호출 ${todo.length}회가 발생합니다.\n` +
        `   실제로 만들려면:  pnpm warm -- --write`,
    );
    process.exit(0);
  }

  /* ── 생성 ───────────────────────────────────────────────── */
  console.log('');
  let made = 0;
  let failed = 0;
  let tokIn = 0;
  let tokOut = 0;

  for (const p of todo) {
    const system = `${SYSTEM_PROMPT}\n\n${facts}\n\n## 이 답변의 언어\n${LANG_RULE[p.lang]}`;
    try {
      const r = await callOpenAI({ system, question: p.question, model });
      if (!r.answer) throw new Error('빈 답변');
      await db.collection('answers').updateOne(
        { key: p.key, lang: p.lang, sourceVersion },
        {
          $set: {
            answer: r.answer,
            model,
            tokensIn: r.tokensIn,
            tokensOut: r.tokensOut,
            updatedAt: new Date(),
          },
          /** 사람이 검수했는지는 유지한다 — 재생성이 reviewed 를 지우면 안 된다 */
          $setOnInsert: { reviewed: false, hits: 0, createdAt: new Date() },
        },
        { upsert: true },
      );
      made += 1;
      tokIn += r.tokensIn;
      tokOut += r.tokensOut;
      console.log(`  ✓ ${p.lang} ${p.key.padEnd(20)} ${r.answer.length}자 (in ${r.tokensIn} / out ${r.tokensOut})`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${p.lang} ${p.key.padEnd(20)} ${err instanceof Error ? err.message : err}`);
    }
    /** 사전 생성이라 급할 것이 없다. rate limit 을 피해 여유를 둔다 */
    await new Promise((r) => setTimeout(r, 400));
  }

  const total = await db.collection('answers').countDocuments({ sourceVersion });
  console.log('\n─── 요약 ───');
  console.log(`  생성 ${made} · 실패 ${failed}`);
  console.log(`  토큰 in ${tokIn} / out ${tokOut}`);
  console.log(`  answers 총 ${total}건 (sourceVersion ${sourceVersion})`);
  console.log(`\n  검수: /admin/suggestions 에서 문장을 고치고 reviewed 를 켠다`);
  if (failed) process.exitCode = 1;
} catch (err) {
  console.error('\n✗ 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
