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

describe("agent-memory-continuity batch37b — errors, sources, files candidates", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b37b-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("capture emits lesson, source_pointer, and runbook candidates (186-200)", () => {
    const sessionId = `session-cand-b37b-${randomUUID().slice(0, 6)}`;
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId,
      summary: " ",
      errors: [{ message: "typecheck failed batch37b" }],
      sources: [{ path: "docs/batch37b.md", title: "Batch37b notes" }],
      files: ["src/lib/agent-memory-continuity.ts"],
    });
    expect(captured.candidateCount).toBeGreaterThanOrEqual(3);
    const rows = db
      .prepare(`SELECT memory_type, content FROM agent_memory_candidates WHERE capture_id = ?`)
      .all(captured.id) as Array<{ memory_type: string; content: string }>;
    const types = rows.map((row) => row.memory_type);
    expect(types).toEqual(expect.arrayContaining(["lesson", "source_pointer", "runbook"]));
    expect(rows.some((row) => /typecheck failed batch37b/i.test(row.content))).toBe(true);
  });
});