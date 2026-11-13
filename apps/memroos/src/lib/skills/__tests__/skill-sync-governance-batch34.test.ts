// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createOrUpdateAgentVersionPin,
  detectSkillChange,
  listAgentVersionPins,
} from "../skill-sync-governance";
import { computeContentHash } from "@/lib/skills/registry";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertRegistrySkill(database: Database.Database, name: string): number {
  const body = `body-${crypto.randomUUID()}`;
  const hash = computeContentHash(body);
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, body, new Date().toISOString(), hash)
      .lastInsertRowid,
  );
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("skill-sync-governance batch34 — pin listing and detect branches", () => {
  it.skip("writeAuditEntry outer catch return when audit_entries missing after generic insert (480) — skill.* path dominates", () => {});

  it.skip("approveImportProposal post-tx `if (!updated)` guard (794) — transaction always assigns updated or throws", () => {});

  it("listAgentVersionPins honors agent filter with limit and offset (1252–1253)", () => {
    const database = freshDb();
    const skillName = `pins-b34-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(database, skillName);
    const hash = database.prepare(`SELECT content_hash FROM skill_registry WHERE id = ?`).pluck().get(skillId) as string;
    const agentA = `agent-a-b34-${crypto.randomUUID().slice(0, 6)}`;
    const agentB = `agent-b-b34-${crypto.randomUUID().slice(0, 6)}`;
    database
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'A', 'agent', 'memroos', 'local')`,
      )
      .run(agentA);
    database
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'B', 'agent', 'memroos', 'local')`,
      )
      .run(agentB);
    for (const agentId of [agentA, agentB, agentA]) {
      createOrUpdateAgentVersionPin(database, {
        agent_id: agentId,
        skill_name: skillName,
        skill_id: skillId,
        current_version: "1.0.0",
        current_content_hash: hash,
        actor: "operator-b34",
      });
    }
    const page = listAgentVersionPins(database, { agent_id: agentA, limit: 1, offset: 0 });
    expect(page.length).toBe(1);
    expect(page.every((p) => p.agent_id === agentA)).toBe(true);
  });

  it("detectSkillChange dedupes when an identical hash proposal already exists (470–471)", () => {
    const database = freshDb();
    const skillName = `dedupe-gov-b34-${crypto.randomUUID().slice(0, 8)}`;
    const body = "detect-body-b34";
    const hash = computeContentHash(body);
    insertRegistrySkill(database, skillName);
    const first = detectSkillChange(database, {
      source_harness: "memroos",
      skill_name: skillName,
      proposed_by: "operator",
      detected_content_body: body,
      version: "1.0.0",
    });
    const second = detectSkillChange(database, {
      source_harness: "memroos",
      skill_name: skillName,
      proposed_by: "operator",
      detected_content_hash: hash,
      version: "1.0.0",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposal.id).toBe(first.proposal.id);
  });

  it("createOrUpdateAgentVersionPin completes when audit insert throws but audit table is absent (480 inner)", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const name = `audit-miss-b34-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(database, name);
    const hash = database.prepare(`SELECT content_hash FROM skill_registry WHERE id = ?`).pluck().get(skillId) as string;
    const agentId = `agent-audit-b34-${crypto.randomUUID().slice(0, 6)}`;
    database
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Audit', 'agent', 'memroos', 'local')`,
      )
      .run(agentId);
    const pin = createOrUpdateAgentVersionPin(database, {
      agent_id: agentId,
      skill_name: name,
      skill_id: skillId,
      current_version: "1.0.0",
      current_content_hash: hash,
      actor: "operator-b34",
    });
    expect(pin.skill_name).toBe(name);
  });
});
