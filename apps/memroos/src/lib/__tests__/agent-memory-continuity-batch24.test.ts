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

describe("agent-memory-continuity batch24 — sanitize fallbacks", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b24-${randomUUID()}-`));
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

  it("captureCodingAgentSession coerces non-array files and object-shaped sources", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Sanitize branches batch24",
      decisionIntent: { note: { nested: "object intent" } },
      files: "not-an-array" as unknown as [],
      sources: { path: "inline-object-source.md" } as unknown as [],
      errors: { code: "WARN" } as unknown as [],
    });
    expect(["ok", "warning"]).toContain(captured.captureHealth);
    expect(captured.candidateCount).toBeGreaterThan(0);
  });

  it("buildCodingAgentHandoffPack treats blank verification_json as empty array", () => {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      taskId,
      summary: "Null verification batch24",
      verification: [{ check: "typecheck" }],
    });
    db.prepare(`UPDATE agent_session_captures SET verification_json = ? WHERE id = ?`).run("", capture.id);
    const pack = buildCodingAgentHandoffPack(db, { taskId });
    expect(pack.contextPack.captures[0]?.verification).toEqual([]);
  });
});
