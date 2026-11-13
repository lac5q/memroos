// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource } from "../source-registry";

describe("federation source-registry batch36", () => {
  it("safeRecord returns {} when label_policy_json is stored as a non-string (446)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b36-label-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'int-label-b36', 'memory', 'purpose', 1, '[]', 'registered', 1, 0, 'local',
         '{}', 'hash-b36-int-label', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.labelPolicyJson).toEqual({});
    db.close();
  });

  it("safeArray returns [] when allowed_operations_json is stored as a non-string (457)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b36-ops-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'int-ops-b36', 'memory', 'purpose', '{}', 2, 'registered', 1, 0, 'local',
         '{}', 'hash-b36-int-ops', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.allowedOperations).toEqual([]);
    db.close();
  });
});
