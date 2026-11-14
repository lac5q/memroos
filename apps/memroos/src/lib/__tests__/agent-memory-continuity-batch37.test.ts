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

describe("agent-memory-continuity batch37 — budget floor, verification candidates", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b37-${randomUUID()}-`));
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

  it("buildCodingAgentHandoffPack clamps token budget to minimum 500 (452)", () => {
    const sessionId = `session-min-b37-${randomUUID().slice(0, 6)}`;
    captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "budget min batch37",
    });
    const pack = buildCodingAgentHandoffPack(db, { sessionId, tokenBudget: 50 });
    expect(pack.tokenBudget).toBe(500);
  });

  it("capture emits verification candidates from verification payloads (190-192)", () => {
    const sessionId = `session-ver-b37-${randomUUID().slice(0, 6)}`;
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "verification batch37",
      verification: [{ command: "npm test", ok: true, note: "batch37 branch pack" }],
    });
    expect(captured.candidateCount).toBeGreaterThanOrEqual(1);
  });

  it("capture emits decision_intent candidate when decisionIntent populated (179-184)", () => {
    const sessionId = `session-dec-b37-${randomUUID().slice(0, 6)}`;
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "",
      decisionIntent: { action: "ship", reason: "batch37 intent branch" },
    });
    expect(captured.candidateCount).toBeGreaterThanOrEqual(1);
  });
});