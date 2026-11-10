// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const ROOT = path.join(os.tmpdir(), `db-ingest-b29e-${randomUUID()}`);

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/constants");
  fs.rmSync(ROOT, { recursive: true, force: true });
});

async function loadIngest(paths: {
  claude: string;
  qwen: string;
  hermes: string;
  codex: string;
}) {
  vi.resetModules();
  vi.doMock("@/lib/constants", () => ({
    CLAUDE_MEMORY_PATH: paths.claude,
    QWEN_MEMORY_PATH: paths.qwen,
    HERMES_MEMORY_PATH: paths.hermes,
    CODEX_MEMORY_PATH: paths.codex,
  }));
  return import("../db-ingest");
}

describe("db-ingest batch29e — mocked constants for ingestAllSessions branches", () => {
  it("processFile returns early when statSync throws after readdir (line 549)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const claude = path.join(ROOT, "claude");
    const project = path.join(claude, "proj");
    fs.mkdirSync(project, { recursive: true });
    const jsonl = path.join(project, "gone.jsonl");
    fs.writeFileSync(jsonl, `${JSON.stringify({ type: "user", message: { role: "user", content: "x" } })}\n`);

    const realStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike, opts?: Parameters<typeof fs.statSync>[1]) => {
      if (String(p) === jsonl) throw new Error("stat gone");
      return realStat(p, opts as never);
    }) as typeof fs.statSync);

    const db = new Database(":memory:");
    initSchema(db);
    const { ingestAllSessions } = await loadIngest({
      claude,
      qwen: path.join(ROOT, "qwen-empty"),
      hermes: path.join(ROOT, "hermes-empty"),
      codex: path.join(ROOT, "codex-empty"),
    });
    expect(ingestAllSessions(db).filesProcessed).toBe(0);
    spy.mockRestore();
    db.close();
  });

  it("skips non-directory claude projects and continues (lines 563–565)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const claude = path.join(ROOT, "claude-mix");
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(path.join(claude, "not-a-dir.json"), "{}");
    const good = path.join(claude, "good-proj");
    fs.mkdirSync(good, { recursive: true });
    // empty dir — readdir ok, no jsonl

    const db = new Database(":memory:");
    initSchema(db);
    const { ingestAllSessions } = await loadIngest({
      claude,
      qwen: path.join(ROOT, "qwen-empty"),
      hermes: path.join(ROOT, "hermes-empty"),
      codex: path.join(ROOT, "codex-empty"),
    });
    expect(ingestAllSessions(db).filesProcessed).toBe(0);
    db.close();
  });

  it("skips qwen chats that are missing or not directories (lines 577–579)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const qwen = path.join(ROOT, "qwen");
    fs.mkdirSync(path.join(qwen, "proj-no-chats"), { recursive: true });
    fs.mkdirSync(path.join(qwen, "proj-file-chats"), { recursive: true });
    fs.writeFileSync(path.join(qwen, "proj-file-chats", "chats"), "not-dir");

    const db = new Database(":memory:");
    initSchema(db);
    const { ingestAllSessions } = await loadIngest({
      claude: path.join(ROOT, "claude-empty"),
      qwen,
      hermes: path.join(ROOT, "hermes-empty"),
      codex: path.join(ROOT, "codex-empty"),
    });
    expect(ingestAllSessions(db).filesProcessed).toBe(0);
    db.close();
  });
});
