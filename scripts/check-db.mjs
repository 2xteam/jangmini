/**
 * MongoDB 연결·DB 이름·컬렉션·인덱스를 점검한다.
 *
 *   pnpm db:check              현재 상태만 본다
 *   pnpm db:check -- --ensure  빠진 컬렉션과 인덱스를 만든다
 *
 * TypeLog 의 같은 스크립트를 본떴으나 두 곳이 다르다.
 *
 *  1. DB 이름을 **환경 변수에서 읽지 않는다.** TypeLog 판은
 *     `process.env.MONGO_DB ?? "type"` 인데, 2026-09-04 사고가 정확히 그
 *     구조에서 났다 — 2hbk 의 .env.local 을 복사할 때 MONGO_DB=hamhibokka 가
 *     따라와 TypeLog 문서 33건이 남의 DB 에 들어갔다.
 *     → my-obsidian-vault / 40-Infra/MongoDB Atlas.md
 *  2. 공용 회원 DB(`user`)를 보지 않는다. 이 앱은 회원을 공유하지 않는다.
 *     로그인은 이 DB 의 `readers` 로만 한다 → 10-Projects/jangmini.md
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { MongoClient } from "mongodb";

dns.setDefaultResultOrder("ipv4first");

/**
 * 이 앱의 DB 이름. lib/db.ts 와 같아야 한다.
 * **상수다.** 환경 변수로 바꿀 수 없다 — 위 주석 1번 참고.
 */
const DB_NAME = "jangmini";

/**
 * 기대하는 컬렉션과 인덱스. models/*.ts 의 선언과 짝이다.
 * mongoose 가 첫 사용 때 만들지만 드리프트는 조용하므로 여기서 대조한다.
 */
const EXPECTED = {
  portfolio: [
    { name: "slug_1", key: { slug: 1 }, unique: true },
    { name: "kind_1_order_1", key: { kind: 1, order: 1 } },
    { name: "visibility_1_kind_1", key: { visibility: 1, kind: 1 } },
    /** 재수집 멱등성. 같은 Notion 페이지를 두 번 넣지 않는다 */
    {
      name: "source.type_1_source.id_1",
      key: { "source.type": 1, "source.id": 1 },
      unique: true,
    },
  ],
  /** _id 가 설정 키다. 별도 인덱스가 필요 없다 */
  settings: [],
  readers: [{ name: "readerId_1", key: { readerId: 1 }, unique: true }],
  readers_history: [
    /** 익명 카운터 — clientId 와 ipHash 중 엄격한 쪽을 적용한다 */
    { name: "clientId_1_createdAt_-1", key: { clientId: 1, createdAt: -1 } },
    { name: "ipHash_1_createdAt_-1", key: { ipHash: 1, createdAt: -1 } },
    { name: "readerId_1_createdAt_-1", key: { readerId: 1, createdAt: -1 } },
    /**
     * 90일 뒤 자동 삭제. 질문 로그를 무기한 들고 있지 않는다.
     * 전역 일일 캡은 이 컬렉션이 아니라 usage 집계로 판정하므로,
     * 오래된 문서가 사라져도 캡 계산에 영향이 없다.
     */
    { name: "createdAt_1", key: { createdAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 90 },
  ],
  /**
   * 로그인 실패 기록. readers_history 에 섞지 않는다 —
   * 섞으면 질문 수를 세는 쿼리가 로그인 실패까지 세어 버린다.
   */
  login_attempts: [
    { name: "ipHash_1_createdAt_-1", key: { ipHash: 1, createdAt: -1 } },
    { name: "createdAt_1", key: { createdAt: 1 }, expireAfterSeconds: 60 * 60 },
  ],
  suggestions: [
    { name: "key_1", key: { key: 1 }, unique: true },
    { name: "enabled_1_order_1", key: { enabled: 1, order: 1 } },
  ],
  answers: [
    {
      name: "key_1_lang_1_sourceVersion_1",
      key: { key: 1, lang: 1, sourceVersion: 1 },
      unique: true,
    },
  ],
  /** _id 가 날짜(YYYY-MM-DD)다 */
  usage: [],
};

/** .env.local 을 직접 읽는다 — 표준 node 실행에는 Next 의 로더가 없다 */
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        if (process.env[m[1]] !== undefined) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    } catch {
      /* 없으면 넘어간다 */
    }
  }
}

function uriDbName(uri) {
  try {
    const afterHost = uri.split("://")[1]?.split("/").slice(1).join("/") ?? "";
    return afterHost.split("?")[0] || null;
  } catch {
    return null;
  }
}

loadEnv();

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("✗ MONGO_URI 가 없습니다. .env.example 을 보고 .env.local 을 채워 주세요.");
  process.exit(1);
}
if (!uri.startsWith("mongodb+srv://")) {
  /**
   * 로컬에서는 이게 정상일 수 있다. 이 PC 의 Node DNS 리졸버가 127.0.0.1 로
   * 잡혀 있어 SRV 조회가 ECONNREFUSED 로 실패한다 — 한 줄로 확인된다:
   *   node -e "const d=require('dns');console.log(d.getServers())"
   * 8.8.8.8 로 물으면 3건이 정상으로 온다. 즉 Atlas 문제가 아니다.
   *
   * 그래서 로컬은 표준 URI, **Vercel 은 mongodb+srv://** 로 나눠 쓴다.
   * 서버는 SRV 에 문제가 없고, 표준 URI 는 Atlas 가 클러스터를 이전하면
   * 샤드 호스트명이 바뀌어 조용히 끊긴다.
   */
  console.warn(
    "! 표준 URI 입니다 (로컬은 정상 — 이 PC 는 Node 에서 SRV 조회가 안 됩니다).\n" +
      "  Vercel 환경 변수에는 반드시 mongodb+srv:// 를 넣으세요.",
  );
}

const ensure = process.argv.includes("--ensure");
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });

try {
  await client.connect();
  console.log("✓ 연결됐습니다.");

  const inUri = uriDbName(uri);
  console.log("\nDB 이름");
  console.log(`  코드가 쓰는 이름   ${DB_NAME}   ← 상수. 이게 이깁니다`);
  console.log(`  URI 경로의 이름    ${inUri ?? "(없음 — 이게 좋습니다)"}`);
  if (inUri && inUri !== DB_NAME) {
    console.log(
      `  ! 둘이 다릅니다. 코드가 이기므로 데이터는 "${DB_NAME}" 에 쌓입니다.\n` +
        "    다른 앱의 연결 문자열을 복사한 것이 아닌지 확인해 주세요.",
    );
  }

  const db = client.db(DB_NAME);
  const existing = (await db.listCollections().toArray()).map((c) => c.name);
  console.log(`\n컬렉션 (${DB_NAME})`);
  if (!existing.length) {
    console.log(
      `  (없음) — Atlas 에 "${DB_NAME}" DB 가 아직 없습니다.\n` +
        `    Atlas 는 빈 DB 를 만들 수 없으니 Create Database 로\n` +
        `    DB "${DB_NAME}" + 컬렉션 "portfolio" 를 함께 만들어 주세요.`,
    );
  }

  for (const [name, expected] of Object.entries(EXPECTED)) {
    if (!existing.includes(name)) {
      if (!ensure) {
        console.log(`  ${name.padEnd(16)} 없음`);
        continue;
      }
      await db.createCollection(name);
      console.log(`  ${name.padEnd(16)} 없음 → 만들었습니다`);
    }
    const col = db.collection(name);
    const count = await col.countDocuments();
    const have = await col.indexes();
    const haveNames = new Set(have.map((i) => i.name));
    const missing = expected.filter((e) => !haveNames.has(e.name));
    console.log(
      `  ${name.padEnd(16)} 문서 ${String(count).padStart(5)} · 인덱스 ${have.length}` +
        (missing.length ? `  ! 빠짐: ${missing.map((m) => m.name).join(", ")}` : "  ✓"),
    );
    if (missing.length && ensure) {
      for (const m of missing) {
        const { name: idxName, key, ...opts } = m;
        await col.createIndex(key, { name: idxName, ...opts });
        console.log(`    → ${idxName} 만들었습니다`);
      }
    }
  }

  const extra = existing.filter((n) => !(n in EXPECTED));
  if (extra.length) {
    console.log(`\n  ! 기대 목록에 없는 컬렉션: ${extra.join(", ")}`);
    console.log("    mongoose 가 이름을 복수로 바꿔 만든 것이 아닌지 확인해 주세요");
    console.log("    (Portfolio→portfolios · ReaderHistory→readerhistories)");
  }

  console.log("\n환경 변수 — 있어야 하는 것");
  for (const [key, note] of [
    ["MONGO_URI", "로컬은 표준 URI, Vercel 은 mongodb+srv://"],
    ["SESSION_SECRET", "reader 쿠키 서명용. myjane 것과 다른 값이어야 합니다"],
    ["IP_HASH_SALT", "원문 IP 를 저장하지 않기 위한 salt"],
    ["OPENAI_API_KEY", "jangmini 전용 프로젝트 키를 권합니다"],
  ]) {
    const v = process.env[key];
    const ok = Boolean(v) && (/SECRET|SALT/.test(key) ? v.length >= 16 : true);
    console.log(
      `  ${ok ? "✓" : "✗"} ${key.padEnd(18)} ${v ? `길이 ${v.length}` : "없음"}  — ${note}`,
    );
  }

  console.log("\n환경 변수 — 있으면 안 되는 것");
  for (const [key, why] of [
    ["MONGO_DB", "DB 이름은 상수다. 두면 다른 앱 값이 복사돼 들어온다"],
    ["NEXT_PUBLIC_COOKIE_DOMAIN", "두면 reader 쿠키가 .myjane.co.kr 로 퍼진다"],
  ]) {
    const v = process.env[key];
    console.log(`  ${v ? "✗ 있습니다 — 지워 주세요" : "✓ 없습니다"}  ${key}  — ${why}`);
  }

  if (!ensure) console.log("\n빠진 것을 만들려면:  pnpm db:check -- --ensure");
} catch (err) {
  console.error("\n✗ 실패했습니다:", err instanceof Error ? err.message : err);
  console.error(
    "\n확인할 것\n" +
      "  · Atlas 클러스터가 Paused 상태가 아닌지 (무료 M0 는 미사용 시 자동 정지)\n" +
      "  · Network Access 에 0.0.0.0/0 이 있는지 (Vercel 은 고정 IP 가 없습니다)\n" +
      "  · DB 사용자가 jangmini DB 에 readWrite 권한이 있는지",
  );
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
