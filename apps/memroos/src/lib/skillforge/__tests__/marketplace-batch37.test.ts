// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { publishGovernedSkill } from "../marketplace";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

function insertRegistryRow(database: Database.Database, name: string, harness: string, body: string) {
  const hash = createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, raw_body, completeness_pct, imported_by, imported_at, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', ?, 'low', 'enabled', '1.0.0', ?, 100, 'op', ?, ?, 'signed', 'enabled', 'sig')`,
    )
    .run(name, harness, body, new Date().toISOString(), hash);
}

describe("skillforge marketplace batch37", () => {
  it("findRegistryRow rejects ambiguous harness without sourceHarness (166-167)", () => {
    const database = freshDb();
    const skillName = `ambig-b37-${randomUUID().slice(0, 8)}`;
    const body = `body-${randomUUID()}`;
    insertRegistryRow(database, skillName, "claude", body);
    insertRegistryRow(database, skillName, "codex", body);
    const result = publishGovernedSkill(
      database,
      skillName,
      {
        name: "Listed",
        description: "d",
        author: "a",
        tags: [],
        category: "general",
        changelog: "c",
      },
      {},
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("ambiguous_harness");
    expect(result.error).toMatch(/multiple harnesses/i);
  });
});