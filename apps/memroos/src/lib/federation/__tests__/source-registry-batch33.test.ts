// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource } from "../source-registry";

describe("federation source-registry batch33 — safeRecord/safeArray (446, 457)", () => {
  it("safeRecord returns {} for invalid descriptor_json strings", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b33-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'parse-b33', 'memory', 'purpose', '{}', '[]', 'registered', 1, 0, 'local',
         '{bad json', 'hash-b33', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    expect(getFederationSource(db, "default-tenant", id)?.descriptor).toEqual({});
    db.close();
  });

  it("safeArray returns [] when allowed_operations_json is not valid JSON", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b33-ops-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'ops-b33', 'memory', 'purpose', '{}', 'not-json', 'registered', 1, 0, 'local',
         '{}', 'hash-b33-ops', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    expect(getFederationSource(db, "default-tenant", id)?.allowedOperations).toEqual([]);
    db.close();
  });
});
