// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { extractContent, ingestCodexFile, ingestQwenFile } from "../db-ingest";

const ROOT = path.join(os.tmpdir(), `db-ingest-b35-${randomUUID()}`);

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

describe("db-ingest batch35 — extractContent, qwen/codex guards, scan fallbacks", () => {
  it("extractContent returns null for assistant without text blocks (124, 127)", () => {
    expect(
      extractContent({
        type: "assistant",
        message: { content: [{ type: "tool_use", text: "hidden b35" }] },
      }),
    ).toBeNull();
  });

  it("ingestQwenFile skips empty part text (363)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const filePath = path.join(ROOT, "empty-qwen-b35.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ type: "assistant", message: { parts: [{ text: "" }] } })}\n`,
    );
    const db = new Database(":memory:");
    initSchema(db);
    expect(ingestQwenFile(db, filePath, "proj-b35")).toBe(0);
    db.close();
  });

  it("ingestCodexFile skips non response_item payloads (456)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const filePath = path.join(ROOT, "bad-codex-b35.jsonl");
    fs.writeFileSync(filePath, `${JSON.stringify({ type: "event", payload: { role: "assistant", content: [] } })}\n`);
    const db = new Database(":memory:");
    initSchema(db);
    expect(ingestCodexFile(db, filePath, "proj-b35")).toBe(0);
    db.close();
  });

  it("ingestAllSessions ignores missing roots and bad stat paths (522, 565)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const claude = path.join(ROOT, "claude");
    fs.mkdirSync(claude, { recursive: true });
    const good = path.join(claude, "good-b35");
    fs.mkdirSync(good, { recursive: true });
    fs.writeFileSync(
      path.join(good, "chat.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hello batch35" } })}\n`,
    );

    const realStat = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, opts?: Parameters<typeof fs.statSync>[1]) => {
      const targetPath = String(target);
      if (targetPath.includes("missing-b35")) throw new Error("stat failed batch35");
      return realStat(target, opts as never);
    }) as typeof fs.statSync);

    const db = new Database(":memory:");
    initSchema(db);
    const { ingestAllSessions } = await loadIngest({
      claude,
      qwen: path.join(ROOT, "missing-b35", "qwen"),
      hermes: path.join(ROOT, "missing-b35", "hermes"),
      codex: path.join(ROOT, "missing-b35", "codex"),
    });
    const stats = ingestAllSessions(db);
    expect(stats.rowsInserted).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
    db.close();
  });
});
