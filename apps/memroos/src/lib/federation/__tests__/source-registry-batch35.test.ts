// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource } from "../source-registry";

describe("federation source-registry batch35", () => {
  it("safeRecord tolerates scalar JSON descriptor values (446)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b35-desc-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'json-b35', 'memory', 'purpose', '{}', '[]', 'registered', 1, 0, 'local',
         ?, 'hash-b35-desc', 'operator', datetime('now'), datetime('now'))`,
    ).run(id, JSON.stringify("scalar-b35"));
    expect(getFederationSource(db, "default-tenant", id)?.descriptor).toEqual({});
    db.close();
  });

  it("safeArray tolerates object-shaped operations JSON (457)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b35-ops-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'ops-b35', 'memory', 'purpose', '{}', ?, 'registered', 1, 0, 'local',
         '{}', 'hash-b35-ops', 'operator', datetime('now'), datetime('now'))`,
    ).run(id, JSON.stringify({ search: true }));
    expect(getFederationSource(db, "default-tenant", id)?.allowedOperations).toEqual([]);
    db.close();
  });
});
