// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TEST_DB_DIR = path.join(os.tmpdir(), `db-ingest-b22c-${crypto.randomUUID()}`);

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

describe("db-ingest batch22c — user message gaps and ingestAllSessions branches", () => {
  it("extractContent returns null when user message is missing", async () => {
    const { extractContent } = await import("../db-ingest");
    expect(extractContent({ type: "user" })).toBeNull();
  });

  it("ingestFile skips entries that extractContent cannot map to a role", async () => {
    const { ingestFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const filePath = path.join(TEST_DB_DIR, "role-gap.jsonl");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        type: "system",
        message: { role: "system", content: "ignored system line" },
      }),
      "utf8",
    );
    expect(ingestFile(db, filePath, "memroos")).toBe(0);
    db.close();
  });

  it("ingestQwenFile and ingestCodexFile skip malformed json lines", async () => {
    const { ingestQwenFile, ingestCodexFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const qwenPath = path.join(TEST_DB_DIR, "qwen-broken.jsonl");
    fs.writeFileSync(qwenPath, "{bad-json\n", "utf8");
    expect(ingestQwenFile(db, qwenPath, "memroos")).toBe(0);
    const codexPath = path.join(TEST_DB_DIR, "codex-broken.jsonl");
    fs.writeFileSync(codexPath, "not-json", "utf8");
    expect(ingestCodexFile(db, codexPath, "codex-session-b22c")).toBe(0);
    db.close();
  });

  it("ingestAllSessions skips non-directories and missing chat folders", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const claudeRoot = process.env.CLAUDE_MEMORY_PATH!;
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, "not-a-dir.jsonl"), "{}", "utf8");
    const qwenProject = path.join(process.env.QWEN_MEMORY_PATH!, "memroos");
    fs.mkdirSync(qwenProject, { recursive: true });
    fs.writeFileSync(path.join(qwenProject, "readme.txt"), "no chats dir", "utf8");
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBe(0);
    expect(summary.filesSkipped).toBe(0);
    db.close();
  });

  it("ingestAllSessions records skip when ingest_meta matches file stat", async () => {
    const { ingestAllSessions, ingestFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const projectDir = path.join(process.env.CLAUDE_MEMORY_PATH!, "memroos-skip");
    fs.mkdirSync(projectDir, { recursive: true });
    const filePath = path.join(projectDir, "cached.jsonl");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "user", message: { role: "user", content: "cached once" } }),
      "utf8",
    );
    ingestFile(db, filePath, "memroos-skip");
    const stat = fs.statSync(filePath);
    db.prepare(
      `INSERT OR REPLACE INTO ingest_meta (file_path, mtime_ms, file_size, row_count, ingested_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(filePath, Math.round(stat.mtimeMs), stat.size, 1, new Date().toISOString());
    const summary = ingestAllSessions(db);
    expect(summary.filesSkipped).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
