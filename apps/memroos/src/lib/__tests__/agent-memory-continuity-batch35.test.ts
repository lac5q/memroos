// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureCodingAgentSession } from "@/lib/agent-memory-continuity";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;
let vaultRoot: string;

describe("agent-memory-continuity batch35 — sanitizeArray and capture branches", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b35-${randomUUID()}-`));
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

  it("sanitizeArray returns empty when indexable sources are not arrays (142)", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-sanitize-b35-${randomUUID().slice(0, 6)}`,
      summary: "non-array fields batch35",
      sources: "not-an-array" as never,
      files: { path: "/repo/README.md" } as never,
      errors: null as never,
    });
    expect(captured.candidateCount).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare(`SELECT sources_json, files_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { sources_json: string; files_json: string };
    expect(JSON.parse(row.sources_json)).toEqual([]);
    expect(JSON.parse(row.files_json)).toEqual([]);
  });

  it("object decisionIntent and verification strings create durable candidates (188-196)", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-cand-b35-${randomUUID().slice(0, 6)}`,
      summary: "structured capture batch35",
      decisionIntent: { lane: "ops", approved: true },
      verification: ["npm test batch35"],
      errors: ["flaky batch35 failure"],
    });
    expect(captured.candidateCount).toBeGreaterThanOrEqual(2);
    const types = db
      .prepare(`SELECT memory_type FROM agent_memory_candidates WHERE capture_id = ?`)
      .all(captured.id) as Array<{ memory_type: string }>;
    expect(types.some((t) => t.memory_type === "decision_intent")).toBe(true);
    expect(types.some((t) => t.memory_type === "verification")).toBe(true);
  });

  it("summary-only capture health stays ok without redactions (115, 233)", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-health-b35-${randomUUID().slice(0, 6)}`,
      summary: "benign summary batch35",
    });
    expect(captured.captureHealth).toBe("ok");
    expect(captured.redactions.length).toBe(0);
  });
});
