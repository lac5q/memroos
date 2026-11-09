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

describe("agent-memory-continuity batch27 — sanitize fallbacks and compactText", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b27-${randomUUID()}-`));
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

  it("sanitizeArray returns empty when errors is not an array", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Non-array errors batch27",
      errors: "not-an-array" as unknown as [],
    });
    const row = db
      .prepare(`SELECT errors_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { errors_json: string };
    expect(JSON.parse(row.errors_json)).toEqual([]);
  });

  it("sanitizeValue stringifies non-JSON primitives and compacts object verification items", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Primitive and compact batch27",
      errors: [undefined as unknown as string] as unknown as [],
      verification: [{ check: "lint" }, false as unknown as string] as unknown as [],
    });
    expect(captured.candidateCount).toBeGreaterThan(0);
    const row = db
      .prepare(`SELECT errors_json, verification_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { errors_json: string; verification_json: string };
    expect(JSON.parse(row.errors_json)).toEqual(["undefined"]);
    expect(JSON.parse(row.verification_json).length).toBe(2);
  });

  it("captureHealth stays ok when no secret patterns match", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Clean summary batch27 with no redaction triggers",
    });
    expect(captured.captureHealth).toBe("ok");
  });
});
