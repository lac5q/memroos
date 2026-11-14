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

describe("agent-memory-continuity batch36 — redaction, filters, clamps", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b36-${randomUUID()}-`));
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

  it("captureCodingAgentSession requires sourceAgentId (209)", () => {
    expect(() =>
      captureCodingAgentSession(db, {
        sourceAgentId: "  ",
        runtime: "codex",
        sessionId: `s-b36-${randomUUID().slice(0, 4)}`,
      }),
    ).toThrow(/sourceAgentId is required/i);
  });

  it("buildCodingAgentHandoffPack sets redacted when capture_health redacted (518-522)", () => {
    const sessionId = `session-redact-b36-${randomUUID().slice(0, 6)}`;
    captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "redacted source batch36",
    });
    db.prepare(`UPDATE agent_session_captures SET capture_health = 'redacted' WHERE session_id = ?`).run(sessionId);
    const pack = buildCodingAgentHandoffPack(db, { sessionId });
    expect(pack.redactionState).toBe("redacted");
  });

  it("buildCodingAgentHandoffPack filters by fromAgentId when provided (458-459)", () => {
    const sessionA = `sess-a-b36-${randomUUID().slice(0, 4)}`;
    const sessionB = `sess-b-b36-${randomUUID().slice(0, 4)}`;
    captureCodingAgentSession(db, {
      sourceAgentId: "agent-a-b36",
      runtime: "codex",
      sessionId: sessionA,
      summary: "agent a capture",
    });
    captureCodingAgentSession(db, {
      sourceAgentId: "agent-b-b36",
      runtime: "codex",
      sessionId: sessionB,
      summary: "agent b capture",
    });
    const pack = buildCodingAgentHandoffPack(db, { fromAgentId: "agent-a-b36" });
    expect(pack.sourceCaptureIds.length).toBe(1);
    expect(pack.title).toMatch(/agent-a-b36/);
  });

  it("buildCodingAgentHandoffPack clamps token budget to 12000 max (452)", () => {
    const sessionId = `session-budget-b36-${randomUUID().slice(0, 6)}`;
    captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "budget batch36",
    });
    const pack = buildCodingAgentHandoffPack(db, { sessionId, tokenBudget: 999_999 });
    expect(pack.tokenBudget).toBe(12000);
  });

  it("capture emits lesson candidates from non-empty errors (186-188)", () => {
    const sessionId = `session-err-b36-${randomUUID().slice(0, 6)}`;
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "errors batch36",
      errors: ["vitest failed on batch36 branch pack"],
    });
    expect(captured.candidateCount).toBeGreaterThanOrEqual(1);
  });
});
