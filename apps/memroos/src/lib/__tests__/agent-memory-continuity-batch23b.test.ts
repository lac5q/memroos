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

describe("agent-memory-continuity batch23b — sanitize depth and redaction health", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b23b-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("captureCodingAgentSession redacts sensitive matches and deep nested objects", () => {
    const deep = { a: { b: { c: { d: { e: { f: "too deep batch23b" } } } } } };
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Contact ops@example.com and SSN 123-45-6789 for follow-up",
      decisionIntent: deep,
      commands: [{ cmd: "npm test" }],
      verification: true as unknown as [],
    });
    expect(["redacted", "warning"]).toContain(captured.captureHealth);
    expect(captured.candidateCount).toBeGreaterThan(0);
  });

  it("buildCodingAgentHandoffPack parseJson returns fallback for corrupt verification_json", () => {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      taskId,
      summary: "Handoff pack batch23b",
      verification: [{ check: "tests" }],
    });
    db.prepare(`UPDATE agent_session_captures SET verification_json = ? WHERE id = ?`).run("{bad-json", capture.id);
    const pack = buildCodingAgentHandoffPack(db, { taskId });
    expect(pack.contextPack.captures[0]?.verification).toEqual([]);
  });
});
