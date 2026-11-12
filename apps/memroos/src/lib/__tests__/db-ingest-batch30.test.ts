// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const ROOT = path.join(os.tmpdir(), `db-ingest-b30-${randomUUID()}`);

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

describe("db-ingest batch30 — role guard and ingestAllSessions branches", () => {
  it("ingestFile skips jsonl entries whose type is not user or assistant (line 195)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const filePath = path.join(ROOT, "tool-only.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ type: "tool", message: { role: "tool", content: "ignored" } })}\n`,
    );

    const db = new Database(":memory:");
    initSchema(db);
    const { ingestFile } = await loadIngest({
      claude: ROOT,
      qwen: path.join(ROOT, "qwen"),
      hermes: path.join(ROOT, "hermes"),
      codex: path.join(ROOT, "codex"),
    });
    expect(ingestFile(db, filePath, "proj-b30")).toBe(0);
    db.close();
  });

  it("ingestAllSessions continues when claude project statSync throws (lines 563-565)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const claude = path.join(ROOT, "claude");
    fs.mkdirSync(claude, { recursive: true });
    const ghostProject = path.join(claude, "ghost-proj");
    fs.mkdirSync(ghostProject, { recursive: true });
    const goodProject = path.join(claude, "good-proj");
    fs.mkdirSync(goodProject, { recursive: true });
    const jsonl = path.join(goodProject, "chat.jsonl");
    fs.writeFileSync(
      jsonl,
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hello b30" } })}\n`,
    );

    const realStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, opts?: Parameters<typeof fs.statSync>[1]) => {
      if (String(target) === ghostProject) throw new Error("stat ghost project");
      return realStat(target, opts as never);
    }) as typeof fs.statSync);

    const db = new Database(":memory:");
    initSchema(db);
    const { ingestAllSessions } = await loadIngest({
      claude,
      qwen: path.join(ROOT, "qwen-empty"),
      hermes: path.join(ROOT, "hermes-empty"),
      codex: path.join(ROOT, "codex-empty"),
    });
    const stats = ingestAllSessions(db);
    expect(stats.filesProcessed).toBeGreaterThanOrEqual(1);
    expect(stats.rowsInserted).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
    db.close();
  });

  it("ingestAllSessions skips qwen chats paths that fail statSync (lines 577-579)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const qwen = path.join(ROOT, "qwen");
    const project = path.join(qwen, "proj-b30");
    const chats = path.join(project, "chats");
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(
      path.join(chats, "thread.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "qwen b30" } })}\n`,
    );
    fs.mkdirSync(path.join(qwen, "no-chats-proj"), { recursive: true });

    const realStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, opts?: Parameters<typeof fs.statSync>[1]) => {
      const targetPath = String(target);
      if (targetPath.endsWith(`${path.sep}no-chats-proj${path.sep}chats`) || targetPath.endsWith("no-chats-proj/chats")) {
        throw new Error("missing chats dir");
      }
      return realStat(target, opts as never);
    }) as typeof fs.statSync);

    const db = new Database(":memory:");
    initSchema(db);
    const { ingestAllSessions } = await loadIngest({
      claude: path.join(ROOT, "claude-empty"),
      qwen,
      hermes: path.join(ROOT, "hermes-empty"),
      codex: path.join(ROOT, "codex-empty"),
    });
    const stats = ingestAllSessions(db);
    expect(stats.filesProcessed).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
    db.close();
  });
});
