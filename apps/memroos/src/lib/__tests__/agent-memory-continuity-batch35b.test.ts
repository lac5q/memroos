// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCodingAgentHandoffPack,
  captureCodingAgentSession,
} from "@/lib/agent-memory-continuity";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;
let vaultRoot: string;

describe("agent-memory-continuity batch35b — duplicate, handoff, guards", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b35b-${randomUUID()}-`));
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

  it("returns duplicate=true when capture_hash matches existing row (295-312)", () => {
    const sessionId = `session-dup-b35b-${randomUUID().slice(0, 6)}`;
    const input = {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "duplicate batch35b capture",
    };
    const first = captureCodingAgentSession(db, input);
    expect(first.duplicate).toBe(false);
    const second = captureCodingAgentSession(db, input);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.candidateCount).toBe(0);
  });

  it("buildCodingAgentHandoffPack requires taskId, sessionId, or fromAgentId (449-451)", () => {
    expect(() => buildCodingAgentHandoffPack(db, {})).toThrow(/taskId, sessionId, or fromAgentId/i);
  });

  it("buildCodingAgentHandoffPack sets review_required when capture_health warning (518-521)", () => {
    const sessionId = `session-handoff-b35b-${randomUUID().slice(0, 6)}`;
    const taskId = `task-b35b-${randomUUID().slice(0, 8)}`;
    captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      taskId,
      summary: "handoff source batch35b",
      sources: ["http://localhost/docs"],
    });
    db.prepare(`UPDATE agent_session_captures SET capture_health = 'warning' WHERE session_id = ?`).run(sessionId);
    const pack = buildCodingAgentHandoffPack(db, { sessionId, tokenBudget: 8000 });
    expect(pack.redactionState).toBe("review_required");
    expect(pack.tokenBudget).toBe(8000);
    expect(pack.sourceCaptureIds.length).toBe(1);
  });

  it("captureCodingAgentSession throws when runtime missing (210)", () => {
    expect(() =>
      captureCodingAgentSession(db, {
        sourceAgentId: "codex",
        runtime: "  ",
        sessionId: `s-b35b-${randomUUID().slice(0, 4)}`,
      }),
    ).toThrow(/runtime is required/i);
  });
});
