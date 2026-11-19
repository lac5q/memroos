// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let testDir: string;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `fed-source-b16-${crypto.randomUUID()}`);
  fs.mkdirSync(testDir, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(testDir, "federation.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  closeDb = close;
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A')").run();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("federation source-registry batch16 — row parsing and eligibility", () => {
  it("getFederationSource returns null ontology context when persisted columns are incomplete", async () => {
    const { getFederationSource } = await import("../source-registry");
    const id = `source_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, space_id, purpose, allowed_operations_json, trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash, created_by,
         ontology_record_type, ontology_record_id, ontology_id, ontology_version, ontology_content_hash, ontology_canonical_id, ontology_source_id, ontology_source_hash, ontology_derivative_id)
       VALUES (?, 'tenant-a', 'handle-a', 'memory', 'space-a', 'orchestration', '["search"]', 'trusted', 1, 0, 'local', '{}', 'sha256:reg', 'operator',
               'message', '1', 'memroos.core', '1.0.0', 'sha256:ont', 'memroos.Document', '', 'sha256:src', 'deriv-1')`,
    ).run(id);
    const source = getFederationSource(db, "tenant-a", id);
    expect(source?.ontologyContext).toBeNull();
  });

  it("listFederationSources tolerates malformed descriptor and allowed_operations JSON", async () => {
    const { listFederationSources, resolveEligibleSources } = await import("../source-registry");
    const id = `source_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, space_id, purpose, allowed_operations_json, trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash, created_by)
       VALUES (?, 'tenant-a', 'handle-b', 'memory', 'space-a', 'orchestration', '{bad', 'trusted', 1, 0, 'local', '[]', 'sha256:reg2', 'operator')`,
    ).run(id);
    const sources = listFederationSources(db, "tenant-a");
    expect(sources[0]?.allowedOperations).toEqual([]);
    expect(sources[0]?.descriptor).toEqual({});

    const eligibility = resolveEligibleSources({
      sources,
      requiredOperation: "search",
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(eligibility[0]?.kind).toBe("omitted");
    if (eligibility[0]?.kind === "omitted") {
      expect(eligibility[0].reason).toBe("operation_not_allowed");
    }
  });
});
