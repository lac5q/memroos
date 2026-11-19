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

describe("agent-memory-continuity batch26 — sanitize depth, object errors, handoff pack", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b26-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captureCodingAgentSession sanitizes nested objects in errors arrays", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Nested error object batch26",
      errors: [{ message: "timeout", detail: { code: 504 } }] as unknown as [],
    });
    const row = db
      .prepare(`SELECT errors_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { errors_json: string };
    const parsed = JSON.parse(row.errors_json) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
  });

  it("captureCodingAgentSession compacts non-string summary fragments from object verification", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Verification object batch26",
      verification: [{ step: "typecheck", ok: true }] as unknown as [],
    });
    expect(captured.id).toBeTruthy();
    const row = db
      .prepare(`SELECT verification_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { verification_json: string };
    expect(JSON.parse(row.verification_json)).toEqual([{ step: "typecheck", ok: true }]);
  });

  it("buildCodingAgentHandoffPack returns pack when captures exist for task id", () => {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      taskId,
      summary: "Handoff pack batch26 capture",
    });
    const pack = buildCodingAgentHandoffPack(db, { taskId, tokenBudget: 2000 });
    expect(pack.taskId).toBe(taskId);
    expect(pack.title.length).toBeGreaterThan(0);
  });

  it("captureCodingAgentSession redacts sk- secrets in summary text", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Leaked ghp_1234567890123456789012345678901234 token",
    });
    const row = db
      .prepare(`SELECT summary FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { summary: string };
    expect(row.summary).not.toContain("ghp_1234567890123456789012345678901234");
    expect(row.summary).toContain("[REDACTED]");
    expect(captured.captureHealth).toBe("redacted");
  });
});
