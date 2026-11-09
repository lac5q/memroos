// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, body: string): number {
  const name = `q-b30-${crypto.randomUUID().slice(0, 6)}`;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state)
         VALUES (?, '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', 'draft')`,
      )
      .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skill-quarantine batch30 — readback failures", () => {
  it("insertQuarantineRecord throws when post-insert readback is missing (384)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "insert readback batch30");
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM skill_quarantine") && sql.includes("skill_id = ?")) {
        const stmt = originalPrepare(sql);
        return {
          ...stmt,
          get: () => undefined,
        } as ReturnType<typeof db.prepare>;
      }
      return originalPrepare(sql);
    });
    const { insertQuarantineRecord } = await import("../skill-quarantine");
    expect(() => insertQuarantineRecord(db, { skillId, stage: "imported" })).toThrow(/failed to read back inserted row/);
    db.close();
  });

  it("approveQuarantine throws when post-approve readback is missing (683)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "approve readback batch30");
    const { runQuarantinePipeline, approveQuarantine } = await import("../skill-quarantine");
    runQuarantinePipeline(db, skillId, "approve readback batch30", "- must include approve readback batch30");
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(skillId);
    const originalPrepare = db.prepare.bind(db);
    let reads = 0;
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM skill_quarantine") && sql.includes("skill_id = ?")) {
        const stmt = originalPrepare(sql);
        return {
          ...stmt,
          get: (...args: unknown[]) => {
            reads += 1;
            if (reads >= 2) return undefined;
            return stmt.get(...args);
          },
        } as ReturnType<typeof db.prepare>;
      }
      return originalPrepare(sql);
    });
    expect(() => approveQuarantine(db, skillId, "operator-b30")).toThrow(/approveQuarantine readback failed/);
    db.close();
  });

  it("rejectQuarantine throws when post-reject readback is missing (744)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "reject readback batch30");
    const { runQuarantinePipeline, rejectQuarantine } = await import("../skill-quarantine");
    runQuarantinePipeline(db, skillId, "reject readback batch30", null);
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(skillId);
    const originalPrepare = db.prepare.bind(db);
    let reads = 0;
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM skill_quarantine") && sql.includes("skill_id = ?")) {
        const stmt = originalPrepare(sql);
        return {
          ...stmt,
          get: (...args: unknown[]) => {
            reads += 1;
            if (reads >= 2) return undefined;
            return stmt.get(...args);
          },
        } as ReturnType<typeof db.prepare>;
      }
      return originalPrepare(sql);
    });
    expect(() => rejectQuarantine(db, skillId, "operator-b30", "policy batch30")).toThrow(/rejectQuarantine readback failed/);
    db.close();
  });
});
