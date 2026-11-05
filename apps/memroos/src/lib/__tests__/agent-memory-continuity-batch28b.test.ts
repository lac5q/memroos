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

describe("agent-memory-continuity batch28b — required fields and redaction", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-b28b-${randomUUID()}-`));
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

  it("throws when sessionId is blank", () => {
    expect(() =>
      captureCodingAgentSession(db, {
        sourceAgentId: "codex",
        runtime: "codex",
        sessionId: "   ",
        summary: "missing session id batch28b",
      }),
    ).toThrow(/sessionId is required/);
  });

  it("marks captureHealth redacted when summary contains a GitHub PAT pattern", () => {
    const captured = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: `session-${randomUUID().slice(0, 6)}`,
      summary: "Leaked ghp_1234567890123456789012345678901234 in summary batch28b",
    });
    expect(captured.captureHealth).toBe("redacted");
    expect(captured.redactions.length).toBeGreaterThan(0);
  });
});
