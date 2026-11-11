// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TEST_DB_DIR = path.join(os.tmpdir(), `db-ingest-b28d-${randomUUID()}`);

beforeAll(() => {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "ingest.db");
  process.env.CLAUDE_MEMORY_PATH = path.join(TEST_DB_DIR, "claude-projects");
  process.env.QWEN_MEMORY_PATH = path.join(TEST_DB_DIR, "qwen-projects");
  process.env.HERMES_MEMORY_PATH = path.join(TEST_DB_DIR, "hermes-sessions");
  process.env.CODEX_MEMORY_PATH = path.join(TEST_DB_DIR, "codex-sessions");
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe("db-ingest batch28d — role gaps, stat skip, qwen chat sweep", () => {
  it("ingestFile skips jsonl entries whose type is not user or assistant", async () => {
    const { ingestFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const filePath = path.join(TEST_DB_DIR, `tool-role-${randomUUID().slice(0, 8)}.jsonl`);
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ type: "tool", message: { role: "tool", content: "batch28d tool line" } })}\n`,
      "utf8",
    );
    expect(ingestFile(db, filePath, "memroos")).toBe(0);
    db.close();
  });

  it("ingestAllSessions ignores missing file paths during processFile stat", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const claudeRoot = process.env.CLAUDE_MEMORY_PATH!;
    fs.mkdirSync(claudeRoot, { recursive: true });
    const projectDir = path.join(claudeRoot, "ghost-project-b28d");
    fs.mkdirSync(projectDir, { recursive: true });
    const ghostFile = path.join(projectDir, "vanished.jsonl");
    fs.writeFileSync(
      ghostFile,
      JSON.stringify({ type: "user", message: { role: "user", content: "batch28d ghost" } }),
      "utf8",
    );
    fs.unlinkSync(ghostFile);
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBe(0);
    db.close();
  });

  it("ingestAllSessions ingests qwen chats jsonl under project chats folders", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const chatsDir = path.join(process.env.QWEN_MEMORY_PATH!, "proj-b28d", "chats");
    fs.mkdirSync(chatsDir, { recursive: true });
    const qwenFile = path.join(chatsDir, "session-b28d.jsonl");
    fs.writeFileSync(
      qwenFile,
      `${JSON.stringify({
        type: "assistant",
        message: { parts: [{ text: "qwen batch28d reply" }] },
        timestamp: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBeGreaterThanOrEqual(1);
    expect(summary.rowsInserted).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("ingestAllSessions skips claude project entries that are files not directories", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const isolatedRoot = path.join(TEST_DB_DIR, `claude-only-${randomUUID().slice(0, 8)}`);
    process.env.CLAUDE_MEMORY_PATH = isolatedRoot;
    process.env.QWEN_MEMORY_PATH = path.join(TEST_DB_DIR, `qwen-empty-${randomUUID().slice(0, 8)}`);
    process.env.HERMES_MEMORY_PATH = path.join(TEST_DB_DIR, `hermes-empty-${randomUUID().slice(0, 8)}`);
    process.env.CODEX_MEMORY_PATH = path.join(TEST_DB_DIR, `codex-empty-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(isolatedRoot, { recursive: true });
    fs.writeFileSync(path.join(isolatedRoot, "flat-not-dir.jsonl"), "{}", "utf8");
    vi.resetModules();
    const { ingestAllSessions: ingestSweep } = await import("../db-ingest");
    const summary = ingestSweep(db);
    expect(summary.filesProcessed).toBe(0);
    db.close();
  });
});
