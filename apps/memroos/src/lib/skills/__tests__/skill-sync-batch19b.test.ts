// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import {
  SkillSyncError,
  approveImportProposal,
  approveSyncProposalById,
  createImportProposal,
  rejectImportProposal,
  rejectSyncProposalById,
} from "../skill-sync";

const tmpRoots: string[] = [];
let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeProposal(
  database: Database.Database,
  opts?: { withFile?: boolean; harness?: "claude" | "codex" },
) {
  const skillName = `sync-b19b-${crypto.randomUUID().slice(0, 8)}`;
  const body = `---
name: ${skillName}
version: 2.0.0
---
# Body ${crypto.randomUUID()}
`;
  const hash = computeContentHash(body);
  const harness = opts?.harness ?? "claude";
  let filePath: string | null = null;
  let sourceRoot: string | null = null;
  if (opts?.withFile) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b19b-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    sourceRoot = path.join(root, "harness");
    fs.mkdirSync(sourceRoot, { recursive: true });
    filePath = path.join(sourceRoot, `${skillName}.md`);
    fs.writeFileSync(filePath, body, "utf8");
  }
  const { proposal } = createImportProposal(database, {
    source_harness: harness,
    detected: {
      skill_name: skillName,
      source_harness: harness,
      version: "2.0.0",
      raw_body: body,
      content_hash: hash,
      file_path: filePath,
    },
    proposed_by: "batch19b",
    source_root: sourceRoot,
  });
  return { skillName, harness, body, hash, proposal, filePath, sourceRoot };
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
});

describe("skill-sync batch19b — proposal-id reject and approve guardrails", () => {
  it("rejectSyncProposalById clears pending state without touching registry hash", () => {
    const database = freshDb();
    const { proposal, skillName, harness } = makeProposal(database);
    const proposalId = proposal.pending_proposal_id!;
    const rejected = rejectSyncProposalById(database, {
      proposal_id: proposalId,
      operator: "operator-b19b",
      reason: "not ready",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.registry_updated).toBe(false);
    expect(
      database
        .prepare(`SELECT pending_proposal_id, rejection_reason FROM skill_sync_state WHERE skill_name = ? AND source_harness = ?`)
        .get(skillName, harness) as { pending_proposal_id: string | null; rejection_reason: string },
    ).toMatchObject({ pending_proposal_id: null, rejection_reason: "not ready" });
  });

  it("refuses double reject and approve-after-reject on the same proposal id", () => {
    const database = freshDb();
    const { proposal } = makeProposal(database);
    const proposalId = proposal.pending_proposal_id!;
    rejectSyncProposalById(database, {
      proposal_id: proposalId,
      operator: "operator",
      reason: "no",
    });
    expect(() =>
      rejectSyncProposalById(database, {
        proposal_id: proposalId,
        operator: "operator",
        reason: "again",
      }),
    ).toThrow(/No pending sync proposal/i);
    expect(() =>
      approveSyncProposalById(database, { proposal_id: proposalId, operator: "operator" }),
    ).toThrow(/No pending sync proposal/i);
  });

  it("detects stale expected_updated_at on approve and reject", () => {
    const database = freshDb();
    const { proposal } = makeProposal(database);
    const proposalId = proposal.pending_proposal_id!;
    expect(() =>
      approveSyncProposalById(database, {
        proposal_id: proposalId,
        operator: "operator",
        expected_updated_at: "1970-01-01T00:00:00.000Z",
      }),
    ).toThrow(/Stale concurrent update/i);
    expect(() =>
      rejectSyncProposalById(database, {
        proposal_id: proposalId,
        operator: "operator",
        reason: "stale",
        expected_updated_at: "1970-01-01T00:00:00.000Z",
      }),
    ).toThrow(/Stale concurrent update/i);
  });

  it("refuses approve when on-disk content hash diverges from pending_detected_hash", () => {
    const database = freshDb();
    const { proposal, filePath, sourceRoot, skillName, harness, hash } = makeProposal(database, {
      withFile: true,
    });
    const proposalId = proposal.pending_proposal_id!;
    fs.writeFileSync(filePath!, `${fs.readFileSync(filePath!, "utf8")}\n# mutated\n`, "utf8");
    database.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE skill_name = ? AND source_harness = ?`).run(
      JSON.stringify({
        source_file_path: filePath,
        source_root: sourceRoot,
        version: "2.0.0",
      }),
      skillName,
      harness,
    );
    expect(() =>
      approveSyncProposalById(database, { proposal_id: proposalId, operator: "operator" }),
    ).toThrow(/Source hash mismatch/i);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects approve when pending_detected_hash is not valid sha256 hex", () => {
    const database = freshDb();
    const { proposal, skillName, harness } = makeProposal(database);
    const proposalId = proposal.pending_proposal_id!;
    database
      .prepare(`UPDATE skill_sync_state SET pending_detected_hash = ? WHERE skill_name = ? AND source_harness = ?`)
      .run("not-a-hash", skillName, harness);
    expect(() =>
      approveSyncProposalById(database, { proposal_id: proposalId, operator: "operator" }),
    ).toThrow(/missing a valid detected_content_hash/i);
  });

  it("approveSyncProposalById tolerates malformed pending_diff_payload JSON", () => {
    const database = freshDb();
    const { proposal, skillName, harness, hash } = makeProposal(database);
    const proposalId = proposal.pending_proposal_id!;
    database
      .prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE skill_name = ? AND source_harness = ?`)
      .run("{not-json", skillName, harness);
    const approved = approveSyncProposalById(database, {
      proposal_id: proposalId,
      operator: "operator",
      apply_to_registry: false,
    });
    expect(approved.status).toBe("approved");
    expect(approved.reverified_hash).toBeNull();
    const row = database
      .prepare(`SELECT last_synced_hash FROM skill_sync_state WHERE skill_name = ? AND source_harness = ?`)
      .get(skillName, harness) as { last_synced_hash: string };
    expect(row.last_synced_hash).toBe(hash);
  });
});

describe("skill-sync batch19b — name+harness approve/reject edges", () => {
  it("rejectImportProposal and approveImportProposal enforce pending lifecycle", () => {
    const database = freshDb();
    const pending = makeProposal(database);
    const rejected = rejectImportProposal(database, {
      skill_name: pending.skillName,
      source_harness: pending.harness,
      operator: "operator",
      reason: "defer",
    });
    expect(rejected.rejected_at).toBeTruthy();
    expect(rejected.pending_proposal_id).toBeNull();
    expect(() =>
      rejectImportProposal(database, {
        skill_name: pending.skillName,
        source_harness: pending.harness,
        operator: "operator",
        reason: "again",
      }),
    ).toThrow(/No pending proposal/i);

    const second = makeProposal(database);
    approveImportProposal(database, {
      skill_name: second.skillName,
      source_harness: second.harness,
      operator: "operator",
    });
    expect(() =>
      rejectImportProposal(database, {
        skill_name: second.skillName,
        source_harness: second.harness,
        operator: "operator",
        reason: "too late",
      }),
    ).toThrow(/No pending proposal/i);
    expect(() =>
      approveImportProposal(database, {
        skill_name: second.skillName,
        source_harness: second.harness,
        operator: "operator",
      }),
    ).toThrow(/No pending proposal/i);
  });

  it("SkillSyncError preserves message for unknown proposal ids", () => {
    const database = freshDb();
    const missing = crypto.randomUUID();
    expect(() =>
      rejectSyncProposalById(database, {
        proposal_id: missing,
        operator: "operator",
        reason: "nope",
      }),
    ).toThrow(SkillSyncError);
    expect(() =>
      approveSyncProposalById(database, { proposal_id: missing, operator: "operator" }),
    ).toThrow(/No pending sync proposal/i);
  });
});
