// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TEST_DB_DIR = path.join(os.tmpdir(), `db-ingest-b29-${randomUUID()}`);

beforeAll(() => {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "ingest.db");
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe("db-ingest batch29 — ingestAllSessions branches (549,563,565,577,579)", () => {
  it("processFile returns early when stat fails (line 549)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const claudeRoot = path.join(TEST_DB_DIR, `claude-stat-${randomUUID().slice(0, 8)}`);
    process.env.CLAUDE_MEMORY_PATH = claudeRoot;
    process.env.QWEN_MEMORY_PATH = path.join(TEST_DB_DIR, `qwen-empty-${randomUUID().slice(0, 8)}`);
    process.env.HERMES_MEMORY_PATH = path.join(TEST_DB_DIR, `hermes-empty-${randomUUID().slice(0, 8)}`);
    process.env.CODEX_MEMORY_PATH = path.join(TEST_DB_DIR, `codex-empty-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(claudeRoot, { recursive: true });
    const projectDir = path.join(claudeRoot, "proj-stat-b29");
    fs.mkdirSync(projectDir, { recursive: true });
    const jsonl = path.join(projectDir, "gone-b29.jsonl");
    fs.writeFileSync(
      jsonl,
      `${JSON.stringify({
        type: "user",
        message: { role: "user", content: "batch29 stat miss" },
      })}\n`,
      "utf8",
    );
    fs.unlinkSync(jsonl);
    vi.resetModules();
    const { ingestAllSessions } = await import("../db-ingest");
    expect(ingestAllSessions(db).filesProcessed).toBe(0);
    db.close();
  });

  it("skips claude project paths that are not directories (lines 563–565)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const claudeRoot = path.join(TEST_DB_DIR, `claude-file-${randomUUID().slice(0, 8)}`);
    process.env.CLAUDE_MEMORY_PATH = claudeRoot;
    process.env.QWEN_MEMORY_PATH = path.join(TEST_DB_DIR, `qwen-empty-${randomUUID().slice(0, 8)}`);
    process.env.HERMES_MEMORY_PATH = path.join(TEST_DB_DIR, `hermes-empty-${randomUUID().slice(0, 8)}`);
    process.env.CODEX_MEMORY_PATH = path.join(TEST_DB_DIR, `codex-empty-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, "not-a-dir-b29"), "{}", "utf8");
    vi.resetModules();
    const { ingestAllSessions } = await import("../db-ingest");
    expect(ingestAllSessions(db).filesProcessed).toBe(0);
    db.close();
  });

  it("skips qwen chats when folder missing or not a directory (lines 577–579)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const qwenRoot = path.join(TEST_DB_DIR, `qwen-b29-${randomUUID().slice(0, 8)}`);
    process.env.CLAUDE_MEMORY_PATH = path.join(TEST_DB_DIR, `claude-empty-${randomUUID().slice(0, 8)}`);
    process.env.QWEN_MEMORY_PATH = qwenRoot;
    process.env.HERMES_MEMORY_PATH = path.join(TEST_DB_DIR, `hermes-empty-${randomUUID().slice(0, 8)}`);
    process.env.CODEX_MEMORY_PATH = path.join(TEST_DB_DIR, `codex-empty-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(qwenRoot, { recursive: true });
    fs.mkdirSync(path.join(qwenRoot, "proj-no-chats"), { recursive: true });
    fs.writeFileSync(path.join(qwenRoot, "flat-chats-b29"), "{}", "utf8");
    fs.mkdirSync(path.join(qwenRoot, "proj-bad-chats", "chats"), { recursive: true });
    fs.writeFileSync(path.join(qwenRoot, "proj-bad-chats", "chats", "not-a-dir"), "{}", "utf8");
    vi.resetModules();
    const { ingestAllSessions } = await import("../db-ingest");
    expect(ingestAllSessions(db).filesProcessed).toBe(0);
    db.close();
  });
});
