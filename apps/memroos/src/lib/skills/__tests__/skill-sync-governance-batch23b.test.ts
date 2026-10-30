// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createOrUpdateAgentVersionPin,
  detectSkillChange,
  rejectImportProposal,
  rollbackAgentVersionPin,
} from "../skill-sync-governance";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedEnabledSkill(database: Database.Database, skillName: string): number {
  const body = `---\nname: ${skillName}\nversion: 1.0.0\n---\n# body`;
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

function seedAgent(database: Database.Database, agentId: string): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol, status, location)
       VALUES (?, ?, 'worker', 'memroos', 'rest', 'active', 'local')`,
    )
    .run(agentId, agentId);
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("skill-sync-governance batch23b — reject audit, pins, rollback", () => {
  it("rejectImportProposal succeeds when audit_entries table is missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `rej-b23b-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body",
    });
    const rejected = rejectImportProposal(database, detected.proposal.id, "operator", "no-go batch23b");
    expect(rejected.status).toBe("rejected");
  });

  it("createOrUpdateAgentVersionPin refuses unknown agents", () => {
    const database = freshDb();
    const skillName = `pin-block-b23b-${crypto.randomUUID().slice(0, 6)}`;
    seedEnabledSkill(database, skillName);

    expect(() =>
      createOrUpdateAgentVersionPin(database, {
        agent_id: "missing-agent-b23b",
        skill_name: skillName,
        skill_id: null,
        current_version: "1.0.0",
        current_content_hash: "b".repeat(64),
        actor: "operator",
      }),
    ).toThrow(/not found in registered_agents/);
  });

  it("rollbackAgentVersionPin restores prior pin and records rollback metadata", () => {
    const database = freshDb();
    seedAgent(database, "agent-rollback-b23b");
    const skillName = `rollback-b23b-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = seedEnabledSkill(database, skillName);
    const hashV1 = "c".repeat(64);
    const hashV2 = "d".repeat(64);

    const pin = createOrUpdateAgentVersionPin(database, {
      agent_id: "agent-rollback-b23b",
      skill_name: skillName,
      skill_id: skillId,
      current_version: "1.0.0",
      current_content_hash: hashV1,
      actor: "operator",
    });

    createOrUpdateAgentVersionPin(database, {
      agent_id: "agent-rollback-b23b",
      skill_name: skillName,
      skill_id: skillId,
      current_version: "2.0.0",
      current_content_hash: hashV2,
      actor: "operator",
    });

    const rolled = rollbackAgentVersionPin(database, {
      pin_id: pin.id,
      operator: "operator",
      reason: "batch23b rollback",
    });
    expect(rolled.current_version).toBe("1.0.0");
    expect(rolled.current_content_hash).toBe(hashV1);
    expect(rolled.rolled_back_by).toBe("operator");
  });
});
