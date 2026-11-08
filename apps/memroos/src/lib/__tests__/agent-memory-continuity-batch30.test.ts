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

describe("agent-memory-continuity batch30 — sanitizeArray and depth limits", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b30-${randomUUID()}-`));
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

  it("sanitizeArray returns empty array when errors is not an array (line 142)", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "batch30 non-array errors",
      errors: { code: "E_BATCH30" } as unknown as [],
    });
    const row = db
      .prepare(`SELECT errors_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { errors_json: string };
    expect(JSON.parse(row.errors_json)).toEqual([]);
  });

  it("sanitizeObject returns empty object when sources is a bare string", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "batch30 string sources",
      sources: "not-an-array" as unknown as [],
    });
    const row = db
      .prepare(`SELECT sources_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { sources_json: string };
    expect(JSON.parse(row.sources_json)).toEqual([]);
  });

  it("sanitizeValue truncates deeply nested structures at depth limit", () => {
    const deep: Record<string, unknown> = { l: {} };
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < 8; i += 1) {
      cursor.l = { n: i };
      cursor = cursor.l as Record<string, unknown>;
    }
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "batch30 deep metadata",
      metadata: deep,
    });
    expect(captured.captureHealth).toBe("ok");
    expect(captured.candidateCount).toBeGreaterThan(0);
  });
});
