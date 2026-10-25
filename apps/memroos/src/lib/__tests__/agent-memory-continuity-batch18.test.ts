// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureCodingAgentSession, buildCodingAgentHandoffPack } from "@/lib/agent-memory-continuity";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;
let vaultRoot: string;

describe("agent-memory-continuity batch18 — durable candidates and handoff guards", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b18-${randomUUID()}-`));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("captureCodingAgentSession requires sourceAgentId, runtime, and sessionId", () => {
    expect(() =>
      captureCodingAgentSession(db, {
        sourceAgentId: " ",
        runtime: "codex",
        sessionId: "session-1",
      }),
    ).toThrow(/sourceAgentId is required/);
    expect(() =>
      captureCodingAgentSession(db, {
        sourceAgentId: "codex",
        runtime: " ",
        sessionId: "session-1",
      }),
    ).toThrow(/runtime is required/);
    expect(() =>
      captureCodingAgentSession(db, {
        sourceAgentId: "codex",
        runtime: "codex",
        sessionId: " ",
      }),
    ).toThrow(/sessionId is required/);
  });

  it("creates durable candidates from errors, verification, sources, and files arrays", () => {
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: "session-durable",
      taskId: "task-durable",
      summary: "Implemented continuity batch18 coverage.",
      decisionIntent: { decision: "Keep captures rich" },
      errors: [{ message: "typecheck failed once" }],
      verification: [{ command: "vitest", status: "passed" }],
      sources: [{ path: "docs/plan.md" }],
      files: [{ path: "src/lib/agent-memory-continuity.ts", action: "modified" }],
    });
    expect(capture.candidateCount).toBeGreaterThanOrEqual(4);
    const types = db
      .prepare(`SELECT memory_type FROM agent_memory_candidates WHERE capture_id = ?`)
      .all(capture.id)
      .map((row) => String((row as { memory_type: string }).memory_type));
    expect(types).toEqual(expect.arrayContaining(["lesson", "verification", "source_pointer", "runbook"]));
  });

  it("buildCodingAgentHandoffPack throws when no captures match the query", () => {
    expect(() => buildCodingAgentHandoffPack(db, { taskId: `missing-${randomUUID()}` })).toThrow(
      /no coding-agent captures matched/,
    );
  });

  it("buildCodingAgentHandoffPack requires at least one selector", () => {
    expect(() => buildCodingAgentHandoffPack(db, {})).toThrow(
      /taskId, sessionId, or fromAgentId is required/,
    );
  });
});
