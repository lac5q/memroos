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

describe("agent-memory-continuity batch23 — sanitize helpers and warning health", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b23-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("captureCodingAgentSession coerces non-array projections and warning-level matches", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Summary with email contact ops@example.com for follow-up",
      decisionIntent: { note: "plain intent" },
      files: "not-an-array" as unknown as [],
      sources: [{ note: "inline object source" }],
    });
    expect(typeof captured.captureHealth).toBe("string");
    expect(["ok", "warning", "redacted"]).toContain(captured.captureHealth);
    expect(captured.candidateCount).toBeGreaterThan(0);
  });

  it("buildCodingAgentHandoffPack parseJson uses fallback on invalid verification_json", () => {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      taskId,
      summary: "Handoff pack",
      verification: [{ check: "lint" }],
    });
    db.prepare(`UPDATE agent_session_captures SET verification_json = ? WHERE id = ?`).run("{bad-json", capture.id);
    const pack = buildCodingAgentHandoffPack(db, { taskId });
    expect(pack.contextPack.captures[0]?.verification).toEqual([]);
  });
});
