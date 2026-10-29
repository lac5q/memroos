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

describe("agent-memory-continuity batch21 — sanitize and parseJson", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b21-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("captureCodingAgentSession stringifies numeric decision intent fields", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Numeric metadata",
      decisionIntent: { priority: 42, nested: { ok: true } },
    });
    expect(captured.captureHealth).toBe("ok");
    expect(captured.candidateCount).toBeGreaterThan(0);
  });

  it("buildCodingAgentHandoffPack falls back when stored JSON columns are corrupt", () => {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      taskId,
      summary: "Handoff corrupt json",
    });
    db.prepare(`UPDATE agent_session_captures SET files_json = ? WHERE id = ?`).run("{bad", capture.id);
    const pack = buildCodingAgentHandoffPack(db, { taskId });
    expect(pack.contextPack.captures.length).toBeGreaterThan(0);
  });
});
