// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import { captureCodingAgentSession } from "@/lib/agent-memory-continuity";

describe("agent-memory-continuity batch39e", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("captureCodingAgentSession accepts sparse optional collections (sanitize paths)", () => {
    const suffix = randomUUID().slice(0, 8);
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: `agent-b39e-${suffix}`,
      runtime: "codex",
      sessionId: `session-b39e-${suffix}`,
      summary: `summary b39e ${suffix}`,
      captureDepth: "standard",
      // omit arrays so projection supplies defaults; still exercises sanitizeObject/sanitizeArray happy path
      sources: undefined,
      files: undefined,
      commands: undefined,
      errors: undefined,
      verification: undefined,
      events: undefined,
      transcript: undefined,
      metadata: { lane: "batch39e" },
    });
    expect(captured.sourceAgentId).toBe(`agent-b39e-${suffix}`);
    expect(captured.sessionId).toBe(`session-b39e-${suffix}`);
  });
});
