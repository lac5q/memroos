// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource } from "../source-registry";

describe("federation source-registry batch35b", () => {
  it("safeRecord rejects scalar JSON descriptor values (446-450)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b35b-desc-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'scalar-desc-b35b', 'memory', 'purpose', '{}', '[]', 'registered', 1, 0, 'local',
         ?, 'hash-b35b-scalar-desc', 'operator', datetime('now'), datetime('now'))`,
    ).run(id, JSON.stringify(99));
    expect(getFederationSource(db, "default-tenant", id)?.descriptor).toEqual({});
    db.close();
  });

  it("safeArray rejects object-shaped operations JSON (457-461)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b35b-ops-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'obj-ops-b35b', 'memory', 'purpose', '{}', ?, 'registered', 1, 0, 'local',
         '{}', 'hash-b35b-obj-ops', 'operator', datetime('now'), datetime('now'))`,
    ).run(id, JSON.stringify({ search: true }));
    expect(getFederationSource(db, "default-tenant", id)?.allowedOperations).toEqual([]);
    db.close();
  });
});
