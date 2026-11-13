// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ingestFile } from "../db-ingest";

const ROOT = path.join(os.tmpdir(), `db-ingest-b35b-${randomUUID()}`);

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

describe("db-ingest batch35b", () => {
  it("ingestFile skips entries whose role cannot be derived (195)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const filePath = path.join(ROOT, "system-only-b35b.jsonl");
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ type: "system", message: { role: "system", content: "ignored b35b" } })}\n`,
    );
    expect(ingestFile(db, filePath, "proj-b35b")).toBe(0);
    db.close();
  });

  it("ingestAllSessions continues when project file listing fails (565, 579)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const claude = path.join(ROOT, "claude");
    const qwen = path.join(ROOT, "qwen");
    fs.mkdirSync(claude, { recursive: true });
    fs.mkdirSync(path.join(claude, "good-proj-b35b"), { recursive: true });
    fs.writeFileSync(
      path.join(claude, "good-proj-b35b", "chat.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hello b35b" } })}\n`,
    );
    fs.mkdirSync(qwen, { recursive: true });
    fs.mkdirSync(path.join(qwen, "broken-proj-b35b"), { recursive: true });
    fs.mkdirSync(path.join(qwen, "broken-proj-b35b", "chats"), { recursive: true });

    const realReaddir = fs.readdirSync.bind(fs);
    vi.spyOn(fs, "readdirSync").mockImplementation((p) => {
      const target = String(p);
      if (target.includes("broken-proj-b35b") && target.endsWith(`${path.sep}chats`)) {
        throw new Error("readdir blocked b35b");
      }
      return realReaddir(p);
    });

    const db = new Database(":memory:");
    initSchema(db);
    const mod = await loadIngest({
      claude,
      qwen,
      hermes: path.join(ROOT, "hermes-missing"),
      codex: path.join(ROOT, "codex-missing"),
    });
    const summary = mod.ingestAllSessions(db);
    expect(summary.rowsInserted).toBeGreaterThanOrEqual(1);
    db.close();
    vi.restoreAllMocks();
  });
});
