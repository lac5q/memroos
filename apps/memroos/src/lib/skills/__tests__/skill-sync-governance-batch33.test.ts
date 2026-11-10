// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  approveImportProposal,
  createOrUpdateAgentVersionPin,
  detectSkillChange,
  rejectImportProposal,
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

describe("skill-sync-governance batch33 — writeAuditEntry fallbacks and pin audit", () => {
  it.skip("writeAuditEntry outer catch return when audit_entries missing after generic insert (480) — all governance events are skill.* and return earlier when the table is absent", () => {});

  it.skip("approveImportProposal post-tx `if (!updated)` guard (794) — transaction always assigns updated or throws", () => {});

  it("createOrUpdateAgentVersionPin tolerates missing audit_entries table (480 inner path)", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const name = `pin-b33-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(database, name);
    const regHash = database
      .prepare(`SELECT content_hash FROM skill_registry WHERE id = ?`)
      .pluck()
      .get(skillId) as string;
    const agentId = `agent-b33-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Pin', 'agent', 'memroos', 'local')`,
      )
      .run(agentId);
    const pin = createOrUpdateAgentVersionPin(database, {
      agent_id: agentId,
      skill_name: name,
      skill_id: skillId,
      current_version: "1.0.0",
      current_content_hash: regHash,
      actor: "operator-b33",
    });
    expect(pin.skill_name).toBe(name);
  });

  it("rejectImportProposal swallows sqlite_master probe failure in audit outer catch (483)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `gov-b33-reject-${crypto.randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body batch33",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert boom b33");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom b33");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const rejected = rejectImportProposal(database, detected.proposal.id, "operator", "no-b33");
    expect(rejected.status).toBe("rejected");
  });

  it("approveImportProposal falls back when skill-chain audit build fails but plain insert succeeds", async () => {
    const database = freshDb();
    const skillChainMod = await import("@/lib/audit/skill-chain");
    vi.spyOn(skillChainMod, "buildSkillAuditEntry").mockImplementation(() => {
      throw new Error("chain build failed b33");
    });
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b33-approve-${crypto.randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body batch33",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok-b33");
    expect(approved.status).toBe("approved");
    const count = database.prepare(`SELECT COUNT(*) AS c FROM audit_entries`).get() as { c: number };
    expect(count.c).toBeGreaterThanOrEqual(1);
  });
});
