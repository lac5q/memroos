// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ingestFile } from "../db-ingest";

const ROOT = path.join(os.tmpdir(), `db-ingest-b36-${randomUUID()}`);

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

describe("db-ingest batch36", () => {
  it("ingestFile skips entries with unsupported role type (195)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    fs.mkdirSync(ROOT, { recursive: true });
    const filePath = path.join(ROOT, `tool-only-b36-${randomUUID().slice(0, 6)}.jsonl`);
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ type: "tool_result", message: { role: "tool", content: "ignored b36" } })}\n`,
    );
    expect(ingestFile(db, filePath, "proj-b36")).toBe(0);
    db.close();
  });

  it("ingestAllSessions continues when Claude project listing throws (565)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const claude = path.join(ROOT, "claude");
    fs.mkdirSync(claude, { recursive: true });
    const goodProject = path.join(claude, `good-b36-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(goodProject, { recursive: true });
    fs.writeFileSync(
      path.join(goodProject, "chat.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hello batch36" } })}\n`,
    );
    const blockedProject = path.join(claude, `blocked-b36-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(blockedProject, { recursive: true });
    const realReaddir = fs.readdirSync.bind(fs);
    vi.spyOn(fs, "readdirSync").mockImplementation((p, options) => {
      const target = String(p);
      if (target === blockedProject) {
        throw new Error("readdir blocked batch36");
      }
      return realReaddir(p, options as never);
    });

    const db = new Database(":memory:");
    initSchema(db);
    const mod = await loadIngest({
      claude,
      qwen: path.join(ROOT, "qwen-missing-b36"),
      hermes: path.join(ROOT, "hermes-missing-b36"),
      codex: path.join(ROOT, "codex-missing-b36"),
    });
    const summary = mod.ingestAllSessions(db);
    expect(summary.rowsInserted).toBeGreaterThanOrEqual(1);
    vi.restoreAllMocks();
    db.close();
  });
});
