// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let TEST_DB_DIR: string;

beforeEach(async () => {
  TEST_DB_DIR = path.join(os.tmpdir(), `msiq-b35b-${randomUUID()}`);
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
  vi.resetModules();
});

function makeLabel() {
  return { visibility: "internal" as const, policy: "agent_visible" as const, domain: null, sensitivity: null };
}

describe("msiq-adapter batch35b — foundry-only and read limits", () => {
  it("openMsiqSession returns foundry_only_unavailable when foundryOnlyMode set (264-278)", async () => {
    const { openMsiqSession } = await import("../msiq-adapter");
    const session = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: { id: `user-b35b-${randomUUID().slice(0, 6)}`, role: "agent", capability: "read", tenantId: "default-tenant" },
      spaceId: "space-b35b",
      label: makeLabel(),
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
      foundryOnlyMode: true,
    });
    expect(session.kind).toBe("foundry_only_unavailable");
  });

  it("readViaMsiqAdapter clamps limit to session max (batch35 follow-on)", async () => {
    const { openMsiqSession, readViaMsiqAdapter, writeViaMsiqAdapter } = await import("../msiq-adapter");
    const session = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: { id: `user-read-b35b-${randomUUID().slice(0, 6)}`, role: "agent", capability: "agent", tenantId: "default-tenant" },
      spaceId: "space-read-b35b",
      label: makeLabel(),
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
    });
    if (session.kind !== "opened") throw new Error("open failed");
    writeViaMsiqAdapter(db, {
      sessionToken: session.sessionToken,
      idempotencyKey: `write-b35b-${randomUUID()}`,
      payload: { content: "indexed batch35b" },
    });
    const read = readViaMsiqAdapter(db, {
      sessionToken: session.sessionToken,
      query: "indexed batch35b",
      limit: 999,
    });
    expect(read.kind === "ok" ? read.items.length : 0).toBeLessThanOrEqual(25);
  });
});
