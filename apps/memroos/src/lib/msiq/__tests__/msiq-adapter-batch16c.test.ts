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
  TEST_DB_DIR = path.join(os.tmpdir(), `msiq-b16c-${crypto.randomUUID()}`);
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
  return { id: "user-1", role: "agent" as const, capability: "agent-1", tenantId: "default-tenant" };
}

function makeLabel() {
  return { visibility: "internal" as const, policy: "agent_visible" as const, domain: null, sensitivity: null };
}

describe("msiq-adapter batch16c — foundry gate and session close", () => {
  it("openMsiqSession returns foundry_only_unavailable when flag set", async () => {
    const { openMsiqSession } = await import("../msiq-adapter");
    const outcome = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: makeActor(),
      spaceId: "space-1",
      label: makeLabel(),
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
      foundryOnlyMode: true,
    });
    expect(outcome.kind).toBe("foundry_only_unavailable");
  });

  it("closeMsiqSession is idempotent for unknown tokens", async () => {
    const { closeMsiqSession } = await import("../msiq-adapter");
    const first = closeMsiqSession(db, "missing-token");
    const second = closeMsiqSession(db, "missing-token");
    expect(first.sessionId).toBe("msiq-unknown");
    expect(second.sessionId).toBe("msiq-unknown");
  });

  it("closeMsiqSession closes an active session opened via happy path", async () => {
    const { openMsiqSession, closeMsiqSession } = await import("../msiq-adapter");
    const opened = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: makeActor(),
      spaceId: "space-1",
      label: makeLabel(),
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
    });
    if (opened.kind !== "opened") {
      expect(opened.kind).toBe("opened");
      return;
    }
    const closed = closeMsiqSession(db, opened.sessionToken);
    expect(closed.sessionId).toBe(opened.sessionId);
    const row = db
      .prepare(`SELECT status FROM msiq_adapter_sessions WHERE id = ?`)
      .get(opened.sessionId) as { status: string };
    expect(row.status).toBe("closed");
  });
});
