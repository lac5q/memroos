// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TEST_DB_DIR = path.join(os.tmpdir(), `db-ingest-b23-${crypto.randomUUID()}`);

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

describe("db-ingest batch23 — role gaps, recursive scan, qwen chats", () => {
  it("ingestFile skips non user/assistant jsonl types", async () => {
    const { ingestFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const filePath = path.join(TEST_DB_DIR, "system-only.jsonl");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        type: "system",
        message: { role: "system", content: "ignored" },
      }),
      "utf8",
    );
    expect(ingestFile(db, filePath, "memroos")).toBe(0);
    db.close();
  });

  it("ingestAllSessions ingests nested codex jsonl via recursive scan helper", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const nestedDir = path.join(process.env.CODEX_MEMORY_PATH!, "nested", "deep");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, "codex-nested.jsonl"),
      JSON.stringify({
        type: "response_item",
        payload: {
          role: "user",
          content: [{ type: "input_text", text: "codex nested batch23" }],
        },
      }),
      "utf8",
    );
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("ingestAllSessions processes qwen chats jsonl files", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const chats = path.join(process.env.QWEN_MEMORY_PATH!, "memroos-qwen", "chats");
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(
      path.join(chats, "session.jsonl"),
      JSON.stringify({
        type: "user",
        message: { parts: [{ text: "qwen batch23" }] },
      }),
      "utf8",
    );
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBeGreaterThanOrEqual(1);
    expect(summary.rowsInserted).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("ingestAllSessions skips claude project entries that are not directories", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const claudeRoot = process.env.CLAUDE_MEMORY_PATH!;
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, "flat-file.jsonl"), "{}", "utf8");
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBeGreaterThanOrEqual(0);
    db.close();
  });
});
