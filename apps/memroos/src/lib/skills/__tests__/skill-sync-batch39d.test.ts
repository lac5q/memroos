// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
  return `---\nname: ${name}\nversion: ${version}\n---\n# Body\n`;
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

describe("skill-sync batch39d", () => {
  it.skip("sanitizeJsonPayload null/undefined early return (441) — diffPayload is always a constructed object", () => {});

  it("createImportProposal falls back to {} when JSON.stringify throws (sanitizeJsonPayload 444-445)", async () => {
    const database = freshDb();
    const skillName = `json-throw-b39d-${randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName, "2.0.0");
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, skillMd(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(skillMd(skillName, "1.0.0")));

    const circular: Record<string, unknown> = { raw_body: body };
    circular.self = circular;

    const { createImportProposal } = await import("../skill-sync");
    const result = createImportProposal(database, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "batch39d",
      diff_payload: circular,
    });
    expect(result.created).toBe(true);
    const row = database
      .prepare(`SELECT pending_diff_payload FROM skill_sync_state WHERE skill_name = ?`)
      .get(skillName) as { pending_diff_payload: string };
    expect(row.pending_diff_payload).toBe("{}");
  });

  it.skip("readSourceFileContent null sourceRoot guard (1500) — approve path only calls when source_root is truthy", () => {});

  it("approveSyncProposalById re-reads disk content when source_root and file_path are contained", async () => {
    const database = freshDb();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b39d-${randomUUID()}-`));
    tmpRoots.push(root);
    const skillFile = path.join(root, "skill-b39d.md");
    const body = skillMd(`disk-b39d-${randomUUID().slice(0, 8)}`, "3.0.0");
    fs.writeFileSync(skillFile, body, "utf8");
    const hash = computeContentHash(body);
    const skillName = `disk-b39d-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, skillMd(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(skillMd(skillName, "1.0.0")));

    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const created = createImportProposal(database, {
      source_harness: "claude",
      source_root: root,
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "3.0.0",
        raw_body: body,
        content_hash: hash,
        file_path: skillFile,
      },
      proposed_by: "batch39d",
    });
    expect(created.created).toBe(true);
    const proposalId = created.proposal.pending_proposal_id!;
    database.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({
        source_file_path: skillFile,
        source_root: root,
        raw_body: body,
        version: "3.0.0",
        detected_hash: hash,
      }),
      proposalId,
    );
    const approved = approveSyncProposalById(database, {
      proposal_id: proposalId,
      operator: "operator-b39d",
    });
    expect(approved.skill_name).toBe(skillName);
    expect(approved.status).toBe("approved");
    const registry = database
      .prepare(`SELECT content_hash FROM skill_registry WHERE name = ?`)
      .get(skillName) as { content_hash: string };
    expect(registry.content_hash.toLowerCase()).toBe(hash.toLowerCase());
  });
});