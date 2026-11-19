// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadModules() {
  const TEST_DB_DIR = path.join(os.tmpdir(), `msiq-b14b-${crypto.randomUUID()}`);
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "msiq.db");
  const { getDb, closeDb } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = getDb();
  initSchema(db);
  return { getDb, closeDb, db, TEST_DB_DIR };
}

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let TEST_DB_DIR: string;

beforeEach(async () => {
  vi.resetModules();
  const m = await loadModules();
  db = m.db;
  closeDb = m.closeDb;
  TEST_DB_DIR = m.TEST_DB_DIR;
});

afterEach(() => {
  closeDb();
  if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe("msiq batch14b — mcp protocol + adapter branches", () => {
  it("validateJsonRpcEnvelope and validateInitializeParams reject malformed capability entries", async () => {
    const protocol = await import("../mcp-protocol");
    expect(protocol.validateJsonRpcEnvelope({ jsonrpc: "2.0", method: "tools/list", extra: true }).ok).toBe(false);
    expect(
      protocol.validateInitializeParams({
        protocolVersion: "2024-11-05",
        capabilities: [{ name: "", source: "memroos" }],
        clientInfo: { name: "c", version: "1" },
      }).ok,
    ).toBe(false);
    expect(
      protocol.validateInitializeParams({
        protocolVersion: "2099-01-01",
        capabilities: [],
        clientInfo: { name: "c", version: "1" },
      }).ok,
    ).toBe(false);
  });

  it("writeViaMsiqAdapter denies expired sessions", async () => {
    const { openMsiqSession, writeViaMsiqAdapter } = await import("../msiq-adapter");
    const session = openMsiqSession(db, {
      tenantId: "default-tenant",
      actor: { id: "user-1", role: "agent", capability: "agent-1", tenantId: "default-tenant" },
      spaceId: "space-1",
      label: { visibility: "internal", policy: "agent_visible", domain: null, sensitivity: null },
      purpose: "memory-promotion",
      beliefStage: "silver_candidate_claim",
    });
    if (session.kind !== "opened") throw new Error("session failed");
    db.prepare(`UPDATE msiq_adapter_sessions SET expires_at = ? WHERE id = ?`).run(
      "2020-01-01T00:00:00.000Z",
      session.sessionId,
    );
    const result = writeViaMsiqAdapter(db, {
      sessionToken: session.sessionToken,
      idempotencyKey: "expired-key",
      payload: { content: "late write" },
    });
    expect(result.kind).toBe("denied");
    if (result.kind === "denied") expect(result.reason).toMatch(/expired|session/);
  });
});
