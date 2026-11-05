// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TEST_DB_DIR = path.join(os.tmpdir(), `db-ingest-b20-${crypto.randomUUID()}`);

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

describe("db-ingest batch20 — extractContent edges and alternate ingest paths", () => {
  it("extractContent returns null for assistant entries without text blocks", async () => {
    const { extractContent } = await import("../db-ingest");
    expect(
      extractContent({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t1" }] },
      }),
    ).toBeNull();
  });

  it("extractContent joins user array text blocks and ignores non-text parts", async () => {
    const { extractContent } = await import("../db-ingest");
    const text = extractContent({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "line one" },
          { type: "image", source: {} },
          { type: "text", text: "line two" },
        ],
      },
    });
    expect(text).toBe("line one\nline two");
  });

  it("deriveAgentId falls back to the last path segment for shallow project dirs", async () => {
    const { deriveAgentId } = await import("../db-ingest");
    expect(deriveAgentId("memroos")).toBe("memroos");
  });

  it("ingestCodexFile ingests response_item payloads", async () => {
    const { ingestCodexFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const filePath = path.join(TEST_DB_DIR, "codex-ingest.jsonl");
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-01-01T00:00:00.000Z",
          payload: {
            role: "user",
            content: [{ type: "input_text", text: "codex hello" }],
          },
        }),
      ].join("\n"),
      "utf8",
    );
    const inserted = ingestCodexFile(db, filePath, "codex-session-b20");
    expect(inserted).toBe(1);
    db.close();
  });

  it("ingestQwenFile ingests qwen chat jsonl parts", async () => {
    const { ingestQwenFile } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const filePath = path.join(TEST_DB_DIR, "qwen-chat.jsonl");
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { parts: [{ text: "qwen message" }] },
        }),
      ].join("\n"),
      "utf8",
    );
    const inserted = ingestQwenFile(db, filePath, "memroos");
    expect(inserted).toBe(1);
    db.close();
  });

  it("ingestAllSessions skips invalid jsonl lines without failing the sweep", async () => {
    const { ingestAllSessions } = await import("../db-ingest");
    const db = new Database(":memory:");
    initSchema(db);
    const projectDir = path.join(process.env.CLAUDE_MEMORY_PATH!, "memroos");
    fs.mkdirSync(projectDir, { recursive: true });
    const filePath = path.join(projectDir, "broken.jsonl");
    fs.writeFileSync(
      filePath,
      ["{not-json", JSON.stringify({ type: "user", message: { role: "user", content: "ok" } })].join("\n"),
      "utf8",
    );
    const summary = ingestAllSessions(db);
    expect(summary.filesProcessed).toBe(1);
    expect(summary.rowsInserted).toBe(1);
    db.close();
  });
});
