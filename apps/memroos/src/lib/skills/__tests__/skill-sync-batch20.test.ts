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

describe("skill-sync batch20 — sanitizeJsonPayload and readSource guards", () => {
  it("createImportProposal stores {} when diff_payload is circular", async () => {
    const database = freshDb();
    const skillName = `null-diff-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 1.0.0
---
# Body
`;
    const circular: Record<string, unknown> = { tag: "batch20" };
    circular.self = circular;
    const { createImportProposal } = await import("../skill-sync");
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "batch20",
      diff_payload: circular,
    });
    expect(proposal.proposal.pending_diff_payload).toBe("{}");
  });

  it("approveSyncProposalById skips re-read when source_root is absent from diff", async () => {
    const database = freshDb();
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `no-root-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 2.0.0
---
# Body
`;
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(
        skillName,
        body.replace("2.0.0", "1.0.0"),
        new Date().toISOString(),
        computeContentHash(body.replace("2.0.0", "1.0.0")),
      );

    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "batch20",
    });
    database
      .prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`)
      .run(JSON.stringify({ source_file_path: "/tmp/outside.md", version: "2.0.0" }), proposal.proposal.pending_proposal_id!);
    const approved = approveSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
    });
    expect(approved.status).toBe("approved");
  });

});
