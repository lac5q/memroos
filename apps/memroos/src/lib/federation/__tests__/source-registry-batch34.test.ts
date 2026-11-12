// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource } from "../source-registry";

describe("federation source-registry batch34", () => {
  it("safeRecord tolerates non-object descriptor_json (446)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b34-desc-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'json-b34', 'memory', 'purpose', '{}', '[]', 'registered', 1, 0, 'local',
         ?, 'hash-b34', 'operator', datetime('now'), datetime('now'))`,
    ).run(id, JSON.stringify("scalar-not-object-b34"));
    expect(getFederationSource(db, "default-tenant", id)?.descriptor).toEqual({});
    db.close();
  });

  it("safeArray tolerates JSON array instead of object map (457)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b34-ops-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'ops-b34', 'memory', 'purpose', '{}', ?, 'registered', 1, 0, 'local',
         '{}', 'hash-b34-ops', 'operator', datetime('now'), datetime('now'))`,
    ).run(id, JSON.stringify(["search", "read"]));
    const source = getFederationSource(db, "default-tenant", id);
    expect(source?.allowedOperations).toEqual(["search", "read"]);
    db.close();
  });
});
