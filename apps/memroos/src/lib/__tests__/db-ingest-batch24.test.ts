// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TEST_DB_DIR = path.join(os.tmpdir(), `db-ingest-b24-${randomUUID()}`);

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

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of [
    "CLAUDE_MEMORY_PATH",
    "QWEN_MEMORY_PATH",
    "HERMES_MEMORY_PATH",
    "CODEX_MEMORY_PATH",
  ] as const) {
    const root = process.env[key];
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
});

describe("db-ingest batch24 — role branches, hermes, stat failures", () => {
  it("ingestFile ingests assistant-typed jsonl lines", async () => {
    const { ingestFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const filePath = path.join(TEST_DB_DIR, "assistant-line.jsonl");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "assistant batch24" }],
        },
      }),
      "utf8",
    );
    expect(ingestFile(db, filePath, "memroos")).toBe(1);
    db.close();
  });

  it("ingestAllSessions ingests hermes session jsonl files", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    fs.mkdirSync(process.env.HERMES_MEMORY_PATH!, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.HERMES_MEMORY_PATH!, "hermes-b24.jsonl"),
      JSON.stringify({
        role: "user",
        content: "hermes batch24",
      }),
      "utf8",
    );
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBeGreaterThanOrEqual(1);
    expect(summary.rowsInserted).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("ingestAllSessions skips qwen chats directories that fail statSync", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const qwenRoot = process.env.QWEN_MEMORY_PATH!;
    const projectDir = path.join(qwenRoot, "proj-qwen-stat");
    const chatsPath = path.join(projectDir, "chats");
    fs.mkdirSync(chatsPath, { recursive: true });
    fs.writeFileSync(path.join(chatsPath, "session.jsonl"), "{}", "utf8");
    const originalStat = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation((targetPath, options?) => {
      if (String(targetPath) === chatsPath) {
        throw new Error("stat failed batch24");
      }
      return originalStat(targetPath, options);
    });
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBe(0);
    db.close();
  });

  it("scanJsonlFiles skips unreadable directory entries during recursive codex scan", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const nested = path.join(process.env.CODEX_MEMORY_PATH!, "2026", "01", "31");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "codex-b24.jsonl"),
      JSON.stringify({
        type: "response_item",
        payload: { role: "user", content: [{ type: "input_text", text: "codex b24" }] },
      }),
      "utf8",
    );
    const ghost = path.join(process.env.CODEX_MEMORY_PATH!, "ghost-entry");
    fs.mkdirSync(path.dirname(ghost), { recursive: true });
    fs.writeFileSync(ghost, "", "utf8");
    const originalStat = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation((targetPath, options?) => {
      if (String(targetPath) === ghost) {
        throw new Error("ghost stat batch24");
      }
      return originalStat(targetPath, options);
    });
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
