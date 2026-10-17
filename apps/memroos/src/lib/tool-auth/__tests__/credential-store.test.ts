// apps/memroos/src/lib/tool-auth/__tests__/credential-store.test.ts
// Phase 179 / v8.23 — credential-store unit tests.
// Exercises the full store / read / delete / append-activity round-trip.

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { readVaultArtifact, writeVaultArtifact } from "@/lib/vault/writer";

import {
  // These functions are exercised dynamically via importStore() below so the
  // vi.doMock("@/lib/db") in beforeEach takes effect before they touch getDb().
  // The static import would otherwise resolve to the un-mocked module.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  appendActivityEvent,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deleteVaultConnection,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listActivityEvents,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listVaultConnections,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  storeApiKeyConnection,
} from "../credential-store";

let db: Database.Database;
let vaultRoot: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memroos-toolauth-"));
  vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
  vi.stubEnv("MEMROOS_VAULT_KEY_PATH", path.join(vaultRoot, "vault.key"));
  db = new Database(":memory:");
  initSchema(db);
  // The credential-store module captures `getDb()` lazily inside each call,
  // so we monkey-patch the import to return our test db.
  vi.doMock("@/lib/db", () => ({ getDb: () => db }));
});

afterEach(() => {
  db.close();
  fs.rmSync(vaultRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/db");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importStore() {
  // Re-import after the mock is in place so the module's references resolve.
  return await import("../credential-store");
}

describe("Phase 179 vault write/read for tool connections", () => {
  it("round-trips an OAuth record with sealed envelope", async () => {
    const record = {
      providerKey: "slack",
      authMode: "oauth" as const,
      nangoConnectionId: "12345",
      accountEmail: "ops@example.com",
      scopes: ["channels:read"],
      connectedAt: new Date().toISOString(),
    };

    const result = writeVaultArtifact(db, {
      body: JSON.stringify(record),
      sourceType: "tool_connection",
      sourceId: "slack",
      label: {
        visibility: "private",
        domain: "engineering",
        sensitivity: null,
        policy: "sealed",
      },
    });
    expect(result.artifactUri).toMatch(/^vault:\/\//);

    const read = readVaultArtifact(db, result.id);
    const parsed = JSON.parse(read.body);
    expect(parsed.providerKey).toBe("slack");
    expect(parsed.nangoConnectionId).toBe("12345");
  });

  it("round-trips an API-key record with credential-sensitivity seal", () => {
    const record = {
      providerKey: "stripe",
      authMode: "api-key" as const,
      connectionId: "c-1",
      apiKey: "sk_test_REDACTED_FOR_TEST_ONLY",
      connectedAt: new Date().toISOString(),
    };

    const result = writeVaultArtifact(db, {
      body: JSON.stringify(record),
      sourceType: "tool_connection",
      sourceId: "stripe",
      label: {
        visibility: "private",
        domain: "engineering",
        sensitivity: "credential",
        policy: "sealed",
      },
    });

    const read = readVaultArtifact(db, result.id);
    const parsed = JSON.parse(read.body);
    expect(parsed.apiKey).toBe("sk_test_REDACTED_FOR_TEST_ONLY");
  });
});

describe("Phase 179 OAuth + API key reads", () => {
  it("stores OAuth connections and reads API keys back", async () => {
    const store = await importStore();
    const oauth = await store.storeOAuthConnection({
      providerKey: "slack",
      nangoConnectionId: "conn-123",
      accountEmail: "ops@example.com",
      scopes: ["channels:read"],
    });
    expect(oauth).toMatchObject({
      providerKey: "slack",
      authMode: "oauth",
      status: "connected",
      accountEmail: "ops@example.com",
    });

    await store.storeApiKeyConnection({ providerKey: "stripe", apiKey: "rk_live_test" });
    expect(await store.readApiKey("stripe")).toBe("rk_live_test");
    expect(await store.readApiKey("missing-provider")).toBeUndefined();
  });

  it("skips unreadable vault artifacts when listing connections", async () => {
    const store = await importStore();
    await store.storeApiKeyConnection({ providerKey: "good", apiKey: "key-1" });
    db.prepare(
      `INSERT INTO raw_artifacts
         (id, tenant_id, source_type, source_id, artifact_uri, artifact_path, content_hash, created_at)
       VALUES ('bad-artifact', 'default-tenant', 'tool_connection', 'broken', 'vault://broken', 'missing.bin', 'hash', datetime('now'))`,
    ).run();
    const listed = store.listVaultConnections();
    expect(listed.some((item) => item.providerKey === "good")).toBe(true);
    expect(listed.some((item) => item.providerKey === "broken")).toBe(false);
  });

  it("returns fallback activity rows when audit metadata is corrupt", async () => {
    const store = await importStore();
    db.prepare(
      `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES ('bad-audit', 'default-tenant', 'operator', 'operator', 'tool_auth.connection_established', 'tool_connection', 'slack', NULL, '{bad-json', datetime('now'))`,
    ).run();
    const events = store.listActivityEvents(5);
    expect(events[0]).toMatchObject({
      providerKey: "unknown",
      type: "connection_established",
    });
  });
});

describe("Phase 179 storeApiKeyConnection + listVaultConnections", () => {
  it("stores an API-key connection and lists it back", async () => {
    const store = await importStore();
    const conn = await store.storeApiKeyConnection({
      providerKey: "stripe",
      apiKey: "rk_test_REDACTED",
    });
    expect(conn.providerKey).toBe("stripe");
    expect(conn.status).toBe("connected");
    expect(conn.authMode).toBe("api-key");

    const list = store.listVaultConnections();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      providerKey: "stripe",
      authMode: "api-key",
      status: "connected",
    });
  });
});

describe("Phase 179 deleteVaultConnection", () => {
  it("removes every artifact for the provider", async () => {
    const store = await importStore();
    await store.storeApiKeyConnection({ providerKey: "stripe", apiKey: "rk_test_x" });
    await store.storeApiKeyConnection({ providerKey: "stripe", apiKey: "rk_test_y" });

    expect(store.listVaultConnections().length).toBe(2);

    const removed = store.deleteVaultConnection("stripe");
    expect(removed).toBe(2);
    expect(store.listVaultConnections().length).toBe(0);
  });

  it("returns 0 for an unknown provider", async () => {
    const store = await importStore();
    expect(store.deleteVaultConnection("never-connected")).toBe(0);
  });
});

describe("Phase 179 appendActivityEvent + listActivityEvents round-trip", () => {
  it("writes an event into audit_entries that listActivityEvents returns", async () => {
    const store = await importStore();
    store.appendActivityEvent({
      providerKey: "slack",
      type: "connection_established",
      connectionId: "conn-1",
      operatorId: "user-1",
      message: "OAuth flow completed",
    });

    const events = store.listActivityEvents(10);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      providerKey: "slack",
      type: "connection_established",
      connectionId: "conn-1",
      operatorId: "user-1",
    });
    expect(events[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records all 5 activity event types", async () => {
    const store = await importStore();
    const types: Array<Parameters<typeof store.appendActivityEvent>[0]["type"]> = [
      "connection_established",
      "connection_revoked",
      "token_refresh_failed",
      "test_succeeded",
      "test_failed",
    ];
    for (const t of types) {
      store.appendActivityEvent({
        providerKey: "stripe",
        type: t,
        connectionId: "c-1",
        operatorId: "user-1",
        message: `${t} recorded`,
      });
    }

    const events = store.listActivityEvents(10);
    expect(events.length).toBe(5);
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(types));
  });

  it("limits results to the requested count", async () => {
    const store = await importStore();
    for (let i = 0; i < 7; i++) {
      store.appendActivityEvent({
        providerKey: "slack",
        type: "connection_established",
        operatorId: `user-${i}`,
      });
    }
    expect(store.listActivityEvents(3)).toHaveLength(3);
    expect(store.listActivityEvents(100)).toHaveLength(7);
  });

  it("does not throw when audit write fails (best-effort)", async () => {
    const store = await importStore();
    // Force a failure by closing the db before the call.
    db.close();
    // Should NOT throw — the function is best-effort.
    expect(() =>
      store.appendActivityEvent({
        providerKey: "slack",
        type: "connection_established",
      }),
    ).not.toThrow();
  });
});