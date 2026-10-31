// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { getFederationSource, registerFederationSource } from "../source-registry";

describe("federation source-registry batch22b", () => {
  it("registerFederationSource denies missing tenantId", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = registerFederationSource(db, {
      tenantId: "",
      sourceHandle: "handle",
      sourceKind: "memory",
      allowedOperations: ["read"],
      purpose: "test",
      createdBy: "operator",
      transport: "local",
      descriptor: {},
    });
    expect(result).toEqual({ kind: "denied", reason: "tenantId required" });
    db.close();
  });

  it("getFederationSource tolerates malformed JSON descriptor fields", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'handle-b22b', 'memory', 'purpose', 'not-json', '{bad', 'registered', 1, 0, 'local', '{bad', 'hash', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.descriptor).toEqual({});
    expect(row?.allowedOperations).toEqual([]);
    db.close();
  });
});
