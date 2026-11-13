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
  TEST_DB_DIR = path.join(os.tmpdir(), `msiq-b35-${randomUUID()}`);
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

function makeActor(capability = `agent-b35-${randomUUID().slice(0, 6)}`) {
  return { id: `user-b35-${randomUUID().slice(0, 6)}`, role: "agent" as const, capability, tenantId: "default-tenant" };
}

function makeLabel() {
  return { visibility: "internal" as const, policy: "agent_visible" as const, domain: null, sensitivity: null };
}

async function openSession(capability?: string) {
  const { openMsiqSession } = await import("../msiq-adapter");
  const session = openMsiqSession(db, {
    tenantId: "default-tenant",
    actor: makeActor(capability),
    spaceId: "space-b35",
    label: makeLabel(),
    purpose: "memory-promotion",
    beliefStage: "silver_candidate_claim",
  });
  if (session.kind !== "opened") throw new Error(`session failed: ${session.kind}`);
  return session;
}

describe("msiq-adapter batch35 — branch gaps", () => {
  it("writeViaMsiqAdapter denies unknown session tokens", async () => {
    const { writeViaMsiqAdapter } = await import("../msiq-adapter");
    const result = writeViaMsiqAdapter(db, {
      sessionToken: `missing-b35-${randomUUID()}`,
      idempotencyKey: `id-b35-${randomUUID()}`,
      payload: { content: "hello b35" },
    });
    expect(result).toMatchObject({ kind: "denied", reason: "session_not_found" });
  });

  it("writeViaMsiqAdapter denies closed sessions", async () => {
    const { writeViaMsiqAdapter } = await import("../msiq-adapter");
    const session = await openSession();
    db.prepare(`UPDATE msiq_adapter_sessions SET status = 'closed' WHERE session_token = ?`).run(
      session.sessionToken,
    );
    const result = writeViaMsiqAdapter(db, {
      sessionToken: session.sessionToken,
      idempotencyKey: `closed-b35-${randomUUID()}`,
      payload: { content: "after close" },
    });
    expect(result).toMatchObject({ kind: "denied", reason: "session_closed" });
  });

  it("readViaMsiqAdapter denies missing sessions", async () => {
    const { readViaMsiqAdapter } = await import("../msiq-adapter");
    const result = readViaMsiqAdapter(db, {
      sessionToken: `read-missing-b35-${randomUUID()}`,
      query: "batch35",
      limit: 3,
    });
    expect(result).toMatchObject({ kind: "denied", reason: "session_not_found" });
  });

  it("writeViaMsiqAdapter denies scope override hash mismatch", async () => {
    const { writeViaMsiqAdapter } = await import("../msiq-adapter");
    const session = await openSession();
    const result = writeViaMsiqAdapter(db, {
      sessionToken: session.sessionToken,
      idempotencyKey: `scope-b35-${randomUUID()}`,
      payload: { content: "scoped write" },
      scopeOverride: {
        tenantId: "other-tenant",
        userId: session.scope.userId,
        agentId: session.scope.agentId,
        spaceId: session.scope.spaceId,
        label: makeLabel(),
        purpose: "memory-promotion",
        beliefStage: "silver_candidate_claim",
      },
    });
    expect(result).toMatchObject({ kind: "denied", reason: "incomplete_scope" });
  });

  it("writeViaMsiqAdapter denies sealed labels via policy gate", async () => {
    const { openMsiqSession, writeViaMsiqAdapter } = await import("../msiq-adapter");
    const session = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: makeActor(),
      spaceId: "space-b35-sealed",
      label: { visibility: "private", policy: "sealed", domain: null, sensitivity: null },
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
    });
    if (session.kind !== "opened") throw new Error("open failed");
    const result = writeViaMsiqAdapter(db, {
      sessionToken: session.sessionToken,
      idempotencyKey: `sealed-b35-${randomUUID()}`,
      payload: { content: "sealed attempt" },
    });
    expect(result.kind).toBe("denied");
    if (result.kind === "denied") expect(["policy_denied", "policy_review_required"]).toContain(result.reason);
  });

  it("readViaMsiqAdapter denies expired sessions", async () => {
    const { readViaMsiqAdapter } = await import("../msiq-adapter");
    const session = await openSession();
    db.prepare(`UPDATE msiq_adapter_sessions SET expires_at = ? WHERE session_token = ?`).run(
      "1999-01-01T00:00:00.000Z",
      session.sessionToken,
    );
    const read = readViaMsiqAdapter(db, {
      sessionToken: session.sessionToken,
      query: "expired b35",
      limit: 2,
    });
    expect(read).toMatchObject({ kind: "denied", reason: "session_expired" });
  });

  it("openMsiqSession defaults missing capability to anonymous", async () => {
    const { openMsiqSession } = await import("../msiq-adapter");
    const session = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: { id: `user-b35-${randomUUID().slice(0, 6)}`, role: "agent", tenantId: "default-tenant" },
      spaceId: "space-b35",
      label: makeLabel(),
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
    });
    expect(session.kind).toBe("opened");
    if (session.kind === "opened") {
      const row = db
        .prepare("SELECT agent_id FROM msiq_adapter_sessions WHERE id = ?")
        .get(session.sessionId) as { agent_id: string };
      expect(row.agent_id).toBe("anonymous");
    }
  });
});
