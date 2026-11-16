// @vitest-environment node
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { authenticateTenantRequest } from "@/lib/public-api/auth";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedKey(
  db: Database.Database,
  opts: { rawKey?: string; scopes?: string; revokedAt?: string | null } = {}
): string {
  const rawKey = opts.rawKey ?? crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const tenantId = `tenant-${randomUUID().slice(0, 8)}`;
  db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(tenantId, "Batch39 Tenant");
  db.prepare(
    `INSERT INTO tenant_api_keys (id, tenant_id, key_hash, scopes, created_at, revoked_at)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`,
  ).run(`tak-${randomUUID().slice(0, 8)}`, tenantId, hash, opts.scopes ?? "read", opts.revokedAt ?? null);
  return rawKey;
}

describe("authenticateTenantRequest batch39", () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    for (const db of dbs) {
      db.close();
    }
    dbs.length = 0;
  });

  function db(): Database.Database {
    const instance = memoryDb();
    dbs.push(instance);
    return instance;
  }

  it("returns null when Authorization header is missing", () => {
    const database = db();
    expect(authenticateTenantRequest(new Request("http://localhost:3000/api/public/v1/traces"), database)).toBeNull();
  });

  it("returns null when header does not match Bearer scheme", () => {
    const database = db();
    const rawKey = seedKey(database);
    expect(
      authenticateTenantRequest(
        new Request("http://localhost:3000/api/public/v1/traces", {
          headers: { Authorization: `Basic ${rawKey}` },
        }),
        database,
      ),
    ).toBeNull();
  });

  it("returns null for Bearer with empty or whitespace-only key", () => {
    const database = db();
    seedKey(database);
    expect(
      authenticateTenantRequest(
        new Request("http://localhost:3000/api/public/v1/traces", {
          headers: { Authorization: "Bearer" },
        }),
        database,
      ),
    ).toBeNull();
    expect(
      authenticateTenantRequest(
        new Request("http://localhost:3000/api/public/v1/traces", {
          headers: { Authorization: "Bearer   " },
        }),
        database,
      ),
    ).toBeNull();
  });

  it("returns null for unknown key hash", () => {
    const database = db();
    seedKey(database);
    const unknown = crypto.randomBytes(32).toString("hex");
    expect(
      authenticateTenantRequest(
        new Request("http://localhost:3000/api/public/v1/traces", {
          headers: { Authorization: `Bearer ${unknown}` },
        }),
        database,
      ),
    ).toBeNull();
  });

  it("returns null when revoked_at is set", () => {
    const database = db();
    const rawKey = seedKey(database, { revokedAt: new Date().toISOString() });
    expect(
      authenticateTenantRequest(
        new Request("http://localhost:3000/api/public/v1/traces", {
          headers: { Authorization: `Bearer ${rawKey}` },
        }),
        database,
      ),
    ).toBeNull();
  });

  it("parses comma-separated scopes on success", () => {
    const database = db();
    const rawKey = seedKey(database, { scopes: "a, b,,c " });
    const ctx = authenticateTenantRequest(
      new Request("http://localhost:3000/api/public/v1/traces", {
        headers: { Authorization: `Bearer ${rawKey}` },
      }),
      database,
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.scopes).toEqual(["a", "b", "c"]);
  });
});