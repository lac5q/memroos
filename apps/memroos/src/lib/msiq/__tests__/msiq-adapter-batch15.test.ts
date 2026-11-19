// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let TEST_DB_DIR: string;

beforeEach(async () => {
  TEST_DB_DIR = path.join(os.tmpdir(), `msiq-b15-${crypto.randomUUID()}`);
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "msiq.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  closeDb = close;
});

afterEach(() => {
  closeDb();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

function makeActor() {
  return { id: "user-1", role: "agent", capability: "agent-1", tenantId: "default-tenant" };
}

function makeLabel() {
  return { visibility: "internal" as const, policy: "agent_visible" as const, domain: null, sensitivity: null };
}

describe("msiq-adapter batch15 — MCP validation denial paths", () => {
  it("openMsiqSession denies when initialize envelope fails validation", async () => {
    vi.doMock("../mcp-protocol", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../mcp-protocol")>();
      return {
        ...actual,
        validateJsonRpcEnvelope: () => ({ ok: false as const, detail: "invalid envelope" }),
      };
    });
    vi.resetModules();
    const { openMsiqSession } = await import("../msiq-adapter");
    const session = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: makeActor(),
      spaceId: "space-1",
      label: makeLabel(),
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
    });
    vi.doUnmock("../mcp-protocol");
    vi.resetModules();
    expect(session.kind).toBe("denied");
    if (session.kind === "denied") {
      expect(session.reason).toBe("mcp_validation_failed");
    }
  });
});
