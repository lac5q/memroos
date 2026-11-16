// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource } from "../source-registry";

describe("federation source-registry batch39d", () => {
  it("safeRecord returns {} for non-string and invalid JSON (446, catch 451-452)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b39d-rec-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'bad-record-b39d', 'memory', 'purpose', '{not-json', '[]', 'registered', 1, 0, 'local',
         9, 'hash-b39d', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.labelPolicyJson).toEqual({});
    expect(row?.descriptor).toEqual({});
    db.close();
  });

  it("safeArray returns [] for non-string and invalid JSON (457, catch 462-463)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b39d-arr-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'bad-array-b39d', 'memory', 'purpose', '{}', 7, 'registered', 1, 0, 'local',
         '{}', 'hash-b39d-arr', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.allowedOperations).toEqual([]);
    db.close();
  });
});