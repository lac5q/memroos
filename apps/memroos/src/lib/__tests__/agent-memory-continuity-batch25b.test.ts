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

describe("agent-memory-continuity batch25b — handoff pack limits", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b25b-${randomUUID()}-`));
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

  it("buildCodingAgentHandoffPack throws when task id has no captures", () => {
    expect(() => buildCodingAgentHandoffPack(db, { taskId: `missing-${randomUUID()}` })).toThrow(
      /no coding-agent captures matched/,
    );
  });

  it("captureCodingAgentSession coerces non-array errors to an empty sanitized list", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "String error batch25b",
      errors: "timeout" as unknown as [],
    });
    expect(captured.captureHealth).toBeTruthy();
    const row = db
      .prepare(`SELECT errors_json FROM agent_session_captures WHERE id = ?`)
      .get(captured.id) as { errors_json: string };
    expect(JSON.parse(row.errors_json)).toEqual([]);
  });
});
