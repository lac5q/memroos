// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const tmpRoots: string[] = [];
let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function skillMd(name: string, version = "1.0.0"): string {
  return `---\nname: ${name}\nversion: ${version}\n---\n# batch28e\n`;
}

afterEach(() => {
  db?.close();
  db = null;
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots.length = 0;
  const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  vi.restoreAllMocks();
});

describe("skill-sync batch28e — exact uncovered statement lines", () => {
  it("writeAuditEntry outer catch returns when audit_entries missing after generic insert fails (line 566)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("chain build failed batch28e");
      },
    }));
    const database = freshDb();
    const skillName = `audit-566-b28e-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), computeContentHash(body));

    let innerSqliteSeen = false;
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        innerSqliteSeen = true;
        return originalPrepare(sql);
      }
      if (sql.includes("INSERT INTO audit_entries")) {
        database.exec("DROP TABLE IF EXISTS audit_entries");
        throw new Error("generic audit insert failed batch28e");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const { pinVersion } = await import("../skill-sync");
    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        actor: "batch28e",
      }),
    ).not.toThrow();
    expect(innerSqliteSeen).toBe(true);
    vi.doUnmock("@/lib/audit/skill-chain");
    vi.resetModules();
  });

  it("writeAuditEntry outer catch swallows sqlite_master probe failure (line 568)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("chain build failed batch28e-568");
      },
    }));
    const database = freshDb();
    const skillName = `audit-568-b28e-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName, "2.0.0");
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, skillMd(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(skillMd(skillName, "1.0.0")));

    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "batch28e",
    });

    let innerSqliteSeen = false;
    let outerSqliteProbe = false;
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        if (!innerSqliteSeen) {
          innerSqliteSeen = true;
          return originalPrepare(sql);
        }
        outerSqliteProbe = true;
        throw new Error("outer sqlite_master probe failed batch28e");
      }
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("generic audit insert failed batch28e");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const rejected = rejectSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator-b28e",
      reason: "batch28e outer audit swallow",
    });
    expect(rejected.status).toBe("rejected");
    expect(innerSqliteSeen).toBe(true);
    expect(outerSqliteProbe).toBe(true);
    vi.doUnmock("@/lib/audit/skill-chain");
    vi.resetModules();
  });
});
