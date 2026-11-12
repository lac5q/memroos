// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { extractContent } from "../db-ingest";

const ROOT = path.join(os.tmpdir(), `db-ingest-b34-${randomUUID()}`);

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

describe("db-ingest batch34", () => {
  it("extractContent ignores non-text assistant blocks (118)", () => {
    const content = extractContent({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", text: "hidden b34" },
          { type: "text", text: "visible b34" },
        ],
      },
    });
    expect(content).toBe("visible b34");
  });

  it("extractContent returns null for empty user text blocks (115)", () => {
    const content = extractContent({
      type: "user",
      message: { content: [{ type: "text", text: "" }] },
    });
    expect(content).toBeNull();
  });

  it("ingestFile skips lines with unsupported types (195)", async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const filePath = path.join(ROOT, "system-only-b34.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ type: "system", message: { role: "system", content: "ignored b34" } })}\n`,
    );
    const db = new Database(":memory:");
    initSchema(db);
    const { ingestFile } = await loadIngest({
      claude: ROOT,
      qwen: path.join(ROOT, "qwen"),
      hermes: path.join(ROOT, "hermes"),
      codex: path.join(ROOT, "codex"),
    });
    expect(ingestFile(db, filePath, "proj-b34")).toBe(0);
    db.close();
  });
});
