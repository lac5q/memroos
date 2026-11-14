// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { checkDispatchEligibility, publishGovernedSkill } from "../marketplace";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertRegistryRow(
  database: Database.Database,
  opts: {
    name: string;
    lifecycle?: string;
    body?: string;
    contentHash?: string;
    signature?: string;
  },
): number {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = opts.contentHash ?? createHash("sha256").update(body, "utf8").digest("hex");
  const info = database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, raw_body, completeness_pct, imported_by, imported_at, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', ?, 100, 'op', ?, ?, 'signed', ?, ?)`,
    )
    .run(
      opts.name,
      body,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
      opts.signature ?? "sig-b37b",
    );
  return Number(info.lastInsertRowid);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skillforge marketplace batch37b — branch arms", () => {
  it("checkDispatchEligibility rejects retired lifecycle (225-227)", () => {
    const database = freshDb();
    const id = insertRegistryRow(database, { name: `retired-b37b-${randomUUID().slice(0, 8)}`, lifecycle: "retired" });
    const row = database.prepare("SELECT * FROM skill_registry WHERE id = ?").get(id);
    const result = checkDispatchEligibility(row as never);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/retired/i);
  });

  it("publishGovernedSkill rejects quarantine stage rejected (247-249)", () => {
    const database = freshDb();
    const name = `quar-b37b-${randomUUID().slice(0, 8)}`;
    const skillId = insertRegistryRow(database, { name });
    database
      .prepare(`INSERT INTO skill_quarantine (skill_id, stage) VALUES (?, 'rejected')`)
      .run(skillId);
    const result = publishGovernedSkill(
      database,
      name,
      { name: "Listed", description: "d", author: "a", tags: [], category: "general", changelog: "c" },
      { sourceHarness: "claude" },
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("quarantine_rejected");
  });

  it("publishGovernedSkill resolves numeric registry id path (131-141)", () => {
    const database = freshDb();
    const name = `numeric-b37b-${randomUUID().slice(0, 8)}`;
    const skillId = insertRegistryRow(database, { name });
    const result = publishGovernedSkill(
      database,
      String(skillId),
      { name: "Listed", description: "d", author: "a", tags: ["b37b"], category: "general", changelog: "c" },
      {},
    );
    expect(result.success).toBe(true);
    expect(result.listingId).toBeTruthy();
  });
});