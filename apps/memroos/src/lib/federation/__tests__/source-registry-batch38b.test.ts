// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource } from "../source-registry";

describe("federation source-registry batch38b — safeRecord/safeArray", () => {
  it("safeRecord returns {} when descriptor_json is invalid JSON (446 catch)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b38b-desc-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'desc-b38b', 'memory', 'purpose', '{}', '[]', 'registered', 1, 0, 'local',
         '{not-json', 'hash-b38b-desc', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.descriptor).toEqual({});
    db.close();
  });

  it("safeArray returns [] when allowed_operations_json is invalid JSON (457 catch)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b38b-ops-${randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'ops-b38b', 'memory', 'purpose', '{}', '[oops', 'registered', 1, 0, 'local',
         '{}', 'hash-b38b-ops', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.allowedOperations).toEqual([]);
    db.close();
  });
});