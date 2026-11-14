// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createOrUpdateAgentVersionPin,
  detectSkillChange,
  listAgentVersionPins,
  rejectImportProposal,
} from "../skill-sync-governance";
import { computeContentHash } from "@/lib/skills/registry";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertRegistrySkill(database: Database.Database, name: string, body?: string): number {
  const raw = body ?? `body-${crypto.randomUUID()}`;
  const hash = computeContentHash(raw);
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, raw, new Date().toISOString(), hash)
      .lastInsertRowid,
  );
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("skill-sync-governance batch35", () => {
  it.skip("writeAuditEntry outer catch return when audit_entries missing after generic insert (480) — skill.* path dominates", () => {});

  it.skip("approveImportProposal post-tx `if (!updated)` guard (794) — transaction always assigns updated or throws", () => {});

  it("rejectImportProposal marks pending proposal rejected (807–828)", () => {
    const database = freshDb();
    const skillName = `reject-gov-b35-${crypto.randomUUID().slice(0, 8)}`;
    insertRegistrySkill(database, skillName);
    const detected = detectSkillChange(database, {
      source_harness: "memroos",
      skill_name: skillName,
      proposed_by: "operator-b35",
      detected_content_body: `new-body-${crypto.randomUUID()}`,
      version: "2.0.0",
    });
    expect(detected.created).toBe(true);
    const rejected = rejectImportProposal(database, detected.proposal.id, "operator-b35", "not needed");
    expect(rejected.status).toBe("rejected");
  });

  it("listAgentVersionPins returns default page size when limit invalid", () => {
    const database = freshDb();
    const skillName = `limit-gov-b35-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(database, skillName);
    const hash = database.prepare(`SELECT content_hash FROM skill_registry WHERE id = ?`).pluck().get(skillId) as string;
    const agentId = `agent-limit-b35-${crypto.randomUUID().slice(0, 6)}`;
    database
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Limit', 'agent', 'memroos', 'local')`,
      )
      .run(agentId);
    createOrUpdateAgentVersionPin(database, {
      agent_id: agentId,
      skill_name: skillName,
      skill_id: skillId,
      current_version: "1.0.0",
      current_content_hash: hash,
      actor: "operator-b35",
    });
    const pins = listAgentVersionPins(database, { limit: -1, offset: -5 });
    expect(pins.length).toBeGreaterThanOrEqual(1);
  });
});
