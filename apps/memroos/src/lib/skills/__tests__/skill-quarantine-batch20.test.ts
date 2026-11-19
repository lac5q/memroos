// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, body: string): number {
  const name = `q-b20-${crypto.randomUUID().slice(0, 6)}`;
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

describe("skill-quarantine batch20 — remaining pipeline and rejection edges", () => {
  it("getQuarantineRecord treats null scanner_result as null parse", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "body");
    db.prepare(
      `INSERT INTO skill_quarantine (skill_id, stage, scanner_result, approval_status, created_at, updated_at)
       VALUES (?, 'imported', '', 'pending', ?, ?)`,
    ).run(skillId, new Date().toISOString(), new Date().toISOString());
    const { getQuarantineRecord } = await import("../skill-quarantine");
    expect(getQuarantineRecord(db, skillId)?.scanner_result).toBeNull();
    db.close();
  });

  it("scoreVerificationChecks returns 1.0 when bullet lines trim to empty", async () => {
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    expect(scoreVerificationChecks("hello world", "-\n*\n")).toBe(1);
  });

  it("runQuarantinePipeline rejects when eval score is below threshold", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "unrelated content");
    const { runQuarantinePipeline } = await import("../skill-quarantine");
    const result = runQuarantinePipeline(db, skillId, "unrelated content", "- must include tokenzzzzzz", {
      evalThreshold: 0.99,
    });
    expect(result.blocked).toBe(true);
    expect(result.advancedTo).toBe("rejected");
    db.close();
  });

  it("rejectQuarantine is idempotent when already rejected", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "safe");
    const { runQuarantinePipeline, rejectQuarantine, QuarantineTransitionError } = await import(
      "../skill-quarantine"
    );
    runQuarantinePipeline(db, skillId, "safe", null);
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(skillId);
    const first = rejectQuarantine(db, skillId, "operator", "policy");
    const second = rejectQuarantine(db, skillId, "operator", "policy");
    expect(first.stage).toBe("rejected");
    expect(second.stage).toBe("rejected");
    expect(() => rejectQuarantine(db, -1, "operator", "x")).toThrow(QuarantineTransitionError);
    expect(() => rejectQuarantine(db, skillId, "", "reason")).toThrow(QuarantineTransitionError);
    expect(() => rejectQuarantine(db, skillId, "operator", "  ")).toThrow(QuarantineTransitionError);
    db.close();
  });

  it("writeQuarantineAudit swallows when sqlite_master lookup throws", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "audit-edge");
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert blocked for test");
      }
      if (sql.includes("sqlite_master")) {
        throw new Error("master lookup failed");
      }
      return originalPrepare(sql);
    });
    const { insertQuarantineRecord } = await import("../skill-quarantine");
    const record = insertQuarantineRecord(db, { skillId, stage: "imported" });
    expect(record.stage).toBe("imported");
    db.close();
  });
});
