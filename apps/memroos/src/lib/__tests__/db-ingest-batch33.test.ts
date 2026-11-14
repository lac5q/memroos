// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const ROOT = path.join(os.tmpdir(), `db-ingest-b33-${randomUUID()}`);

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

describe("db-ingest batch33 — role skip and ingestAllSessions guards", () => {
  it("ingestFile ignores non user/assistant jsonl types (195)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const filePath = path.join(ROOT, "tool-only-b33.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ type: "tool", message: { role: "tool", content: "ignored b33" } })}\n`,
    );
    const db = new Database(":memory:");
    initSchema(db);
    const { ingestFile } = await loadIngest({
      claude: ROOT,
      qwen: path.join(ROOT, "qwen"),
      hermes: path.join(ROOT, "hermes"),
      codex: path.join(ROOT, "codex"),
    });
    expect(ingestFile(db, filePath, "proj-b33")).toBe(0);
    db.close();
  });

  it("ingestAllSessions skips claude project dirs that fail statSync (565)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const claude = path.join(ROOT, "claude");
    fs.mkdirSync(claude, { recursive: true });
    const badProject = path.join(claude, "bad-b33");
    fs.mkdirSync(badProject, { recursive: true });
    const goodProject = path.join(claude, "good-b33");
    fs.mkdirSync(goodProject, { recursive: true });
    fs.writeFileSync(
      path.join(goodProject, "chat.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hello b33" } })}\n`,
    );

    const realStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, opts?: Parameters<typeof fs.statSync>[1]) => {
      if (String(target) === badProject) throw new Error("stat failed b33");
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
    expect(stats.rowsInserted).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
    db.close();
  });

  it("ingestAllSessions skips qwen chat folders failing statSync (579)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const qwen = path.join(ROOT, "qwen");
    const project = path.join(qwen, "proj-b33");
    const chats = path.join(project, "chats");
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(
      path.join(chats, "thread.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "qwen b33" } })}\n`,
    );
    fs.mkdirSync(path.join(qwen, "no-chats-b33"), { recursive: true });

    const realStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, opts?: Parameters<typeof fs.statSync>[1]) => {
      const targetPath = String(target);
      if (targetPath.endsWith(`${path.sep}no-chats-b33${path.sep}chats`) || targetPath.endsWith("no-chats-b33/chats")) {
        throw new Error("missing chats dir b33");
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
