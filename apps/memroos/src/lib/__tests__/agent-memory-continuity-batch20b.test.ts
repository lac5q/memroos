// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCodingAgentHandoffPack, captureCodingAgentSession } from "@/lib/agent-memory-continuity";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;
let vaultRoot: string;

describe("agent-memory-continuity batch20b", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b20b-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("captureCodingAgentSession deduplicates identical summary captures in one session", () => {
    const input = {
      sourceAgentId: "codex",
      runtime: "codex" as const,
      sessionId: "session-dedupe-b20b",
      summary: "Same summary twice",
    };
    const first = captureCodingAgentSession(db, input);
    const second = captureCodingAgentSession(db, input);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("buildCodingAgentHandoffPack embeds capture summaries in contextPack", () => {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: "session-handoff-b20b",
      taskId,
      summary: "Handoff pack batch20b",
    });
    const pack = buildCodingAgentHandoffPack(db, { taskId });
    const captures = pack.contextPack.captures as Array<{ summary?: string }>;
    expect(captures[0]?.summary).toBe("Handoff pack batch20b");
    expect(pack.sourceCaptureIds.length).toBeGreaterThan(0);
  });
});
