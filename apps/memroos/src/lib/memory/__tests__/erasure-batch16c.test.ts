// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  ErasureAuthorizationError,
  coordinateErasure,
  deriveErasureId,
  getErasureStoreAdapter,
  listRegisteredErasureStores,
  registerErasureStoreAdapter,
} from "../erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("erasure batch16c — adapters and completed idempotency", () => {
  it("registerErasureStoreAdapter overrides adapters and listRegisteredErasureStores reflects keys", () => {
    registerErasureStoreAdapter({
      storeId: "platform",
      erase: async () => ({ status: "purged", reason: "test-purge" }),
    });
    expect(listRegisteredErasureStores()).toContain("platform");
    expect(getErasureStoreAdapter("platform")?.storeId).toBe("platform");
  });

  it("authorizeErasureScope rejects scope tenant mismatch on identity metadata", async () => {
    const database = freshDb();
    const identity = {
      ...buildCanonicalIdentity("msg-tenant", "message", "ingress", "message", {
        tenantId: "tenant-a",
      }),
      tenantId: "tenant-a",
    };
    await expect(
      coordinateErasure(database, identity, {
        actorId: "operator",
        scope: { tenantId: "tenant-b", purpose: "dsar" },
      }),
    ).rejects.toBeInstanceOf(ErasureAuthorizationError);
  });

  it("coordinateErasure returns existing completed report without re-running stores", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("msg-idem", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const erasureId = deriveErasureId("default-tenant", identity.id);
    const outcomes = [{ storeId: "vector", status: "zero_match" as const, reason: "not_linked" }];
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
         (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, ?, ?, 'completed', ?, 'operator', ?, ?, ?)`,
      )
      .run(
        erasureId,
        "default-tenant",
        identity.id,
        JSON.stringify(outcomes),
        "a".repeat(64),
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );

    const report = await coordinateErasure(database, identity, {
      actorId: "operator",
      scope: { tenantId: "default-tenant", purpose: "dsar" },
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(report.status).toBe("completed");
    expect(report.erasureId).toBe(erasureId);
    expect(report.storeOutcomes.some((o) => o.storeId === "vector")).toBe(true);
  });

  it("coordinateErasure marks linked stores unavailable when adapter missing", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`msg-${crypto.randomUUID().slice(0, 8)}`, "message", "ingress", "graph", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      actorId: "operator",
      scope: { tenantId: "default-tenant", purpose: "operator" },
      now: new Date("2026-07-01T01:00:00.000Z"),
    });
    expect(report.storeOutcomes.some((o) => o.storeId === "graph" && o.status === "unavailable")).toBe(true);
    expect(["completed", "incomplete", "failed"]).toContain(report.status);
  });
});
