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

describe("agent-memory-continuity batch34 — duplicate hash, seal transcript, durable candidates", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b34-${randomUUID()}-`));
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

  it("returns duplicate capture when hash matches existing row (298-312)", () => {
    const sessionId = `session-dup-b34-${randomUUID().slice(0, 6)}`;
    const first = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "duplicate capture batch34",
    });
    const second = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: "duplicate capture batch34",
    });
    expect(first.duplicate).toBeFalsy();
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.candidateCount).toBe(0);
  });

  it("sealed transcript depth records events when captureDepth requests seal (248-253, 323)", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-seal-b34-${randomUUID().slice(0, 6)}`,
      summary: "sealed transcript batch34",
      captureDepth: "full",
      transcript: "operator asked for memory continuity seal path",
      events: [{ type: "tool", name: "grep", detail: "batch34" }],
    });
    expect(captured.captureDepth).toBe("full");
    expect(captured.candidateCount).toBeGreaterThan(0);
    const row = db
      .prepare(`SELECT metadata_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { metadata_json: string };
    expect(JSON.parse(row.metadata_json).captureDepth).toBe("full");
  });

  it("durableCandidates emit verification and source_pointer memories (190-197)", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-cand-b34-${randomUUID().slice(0, 6)}`,
      summary: "",
      verification: ["npm test passed batch34"],
      sources: ["https://example.com/docs/batch34"],
      files: ["/repo/apps/memroos/src/lib/agent-memory-continuity.ts"],
    });
    expect(captured.candidateCount).toBeGreaterThanOrEqual(3);
    const types = db
      .prepare(`SELECT memory_type FROM agent_memory_candidates WHERE capture_id = ?`)
      .all(captured.id) as Array<{ memory_type: string }>;
    expect(types.some((t) => t.memory_type === "verification")).toBe(true);
    expect(types.some((t) => t.memory_type === "source_pointer")).toBe(true);
    expect(types.some((t) => t.memory_type === "runbook")).toBe(true);
  });
});
