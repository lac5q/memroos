// @vitest-environment node
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, getSchemaVersion, initSchema } from "@/lib/db-schema";
import { KNOWN_DEFAULT_INTERNAL_API_KEY } from "@/lib/internal-api-key";

describe("db-schema audit backfill", () => {
  it("backfills legacy seal_audit_log and audit_log rows into audit_entries on first init", () => {
    const db = new Database(":memory:");

    db.exec(`
      CREATE TABLE seal_audit_log (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        event TEXT NOT NULL,
        baseline_w REAL,
        post_apply_w REAL,
        delta_l1 REAL,
        delta_l2 REAL,
        delta_l3 REAL,
        delta_composite REAL,
        detail_json TEXT,
        timestamp TEXT NOT NULL,
        tenant_id TEXT
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        detail TEXT,
        severity TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      INSERT INTO seal_audit_log VALUES (
        'seal-1', 'proposal-1', 'approved', 0.5, 0.6, 0.1, 0.1, 0.1, 0.3,
        '{"note":"legacy seal"}', '2026-01-01T00:00:00.000Z', 'default-tenant'
      );
      INSERT INTO audit_log VALUES (
        1, 'operator', 'login', 'console', 'legacy detail', 'info', '2026-01-02T00:00:00.000Z'
      );
    `);

    initSchema(db);

    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const sealBackfill = db.prepare("SELECT event_type, entity_id FROM audit_entries WHERE id = ?").get("seal-backfill-seal-1") as { event_type: string; entity_id: string };
    const auditBackfill = db.prepare("SELECT event_type, entity_id FROM audit_entries WHERE id = ?").get("audit-backfill-1") as { event_type: string; entity_id: string };
    expect(sealBackfill.event_type).toBe("seal.approved");
    expect(sealBackfill.entity_id).toBe("seal_proposal:proposal-1");
    expect(auditBackfill.event_type).toBe("agent.login");
    expect(auditBackfill.entity_id).toBe("agent:console");

    const flag = db.prepare("SELECT value FROM meta WHERE key = 'audit_entries_backfill_done'").get() as { value: string };
    expect(flag.value).toBe("1");
    db.close();
  });

  it("migrates legacy business_outcome_events unique constraints to include tenant_id", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE business_outcome_events (
        id              INTEGER PRIMARY KEY,
        tenant_id       TEXT    NOT NULL DEFAULT 'default-tenant',
        correlation_id  TEXT    NOT NULL,
        source_system   TEXT    NOT NULL CHECK(source_system IN ('crm','helpdesk','finance')),
        adapter         TEXT    NOT NULL,
        event_type      TEXT    NOT NULL,
        kpi_key         TEXT    NOT NULL,
        kpi_value       REAL    NOT NULL,
        raw_json        TEXT    NOT NULL,
        agent_id        TEXT,
        polled_at       TEXT    NOT NULL,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(correlation_id, adapter, event_type, polled_at)
      );
    `);

    initSchema(db);

    const ddl = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'business_outcome_events'")
      .get() as { sql: string };
    expect(ddl.sql).toContain("UNIQUE(tenant_id, correlation_id, adapter, event_type, polled_at)");
    expect(ddl.sql).not.toContain("UNIQUE(correlation_id, adapter, event_type, polled_at)");
    db.close();
  });

  it("seeds tenant_api_keys from MEMROOS_INTERNAL_API_KEY when set to a non-default value", () => {
    const db = new Database(":memory:");
    const internalKey = "unit-test-internal-api-key-not-a-real-secret-32";
    const prev = process.env.MEMROOS_INTERNAL_API_KEY;
    process.env.MEMROOS_INTERNAL_API_KEY = internalKey;
    try {
      initSchema(db);
      const hash = createHash("sha256").update(internalKey).digest("hex");
      const row = db
        .prepare("SELECT key_hash FROM tenant_api_keys WHERE id = 'tak-internal-env'")
        .get() as { key_hash: string };
      expect(row.key_hash).toBe(hash);
    } finally {
      if (prev === undefined) delete process.env.MEMROOS_INTERNAL_API_KEY;
      else process.env.MEMROOS_INTERNAL_API_KEY = prev;
      db.close();
    }
  });

  it("refuses initSchema when MEMROOS_INTERNAL_API_KEY is the known default", () => {
    const db = new Database(":memory:");
    const prev = process.env.MEMROOS_INTERNAL_API_KEY;
    process.env.MEMROOS_INTERNAL_API_KEY = KNOWN_DEFAULT_INTERNAL_API_KEY;
    try {
      expect(() => initSchema(db)).toThrow(/must not use the known default value/);
    } finally {
      if (prev === undefined) delete process.env.MEMROOS_INTERNAL_API_KEY;
      else process.env.MEMROOS_INTERNAL_API_KEY = prev;
      db.close();
    }
  });
});
