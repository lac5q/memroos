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

describe("agent-memory-continuity batch22d — capture health and parseJson", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b22d-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("captureCodingAgentSession redacts HIGH severity matches in decision intent", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Token in summary",
      decisionIntent: { token: "ghp_123456789012345678901234567890123456" },
    });
    expect(captured.captureHealth).toBe("redacted");
    expect(captured.redactions.length).toBeGreaterThan(0);
  });

  it("buildCodingAgentHandoffPack parseJson returns fallback for corrupt files_json", () => {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      taskId,
      summary: "Corrupt json columns",
    });
    db.prepare(`UPDATE agent_session_captures SET files_json = ? WHERE id = ?`).run("{bad", capture.id);
    const pack = buildCodingAgentHandoffPack(db, { taskId });
    expect(pack.contextPack.captures[0]?.files).toEqual([]);
  });
});
