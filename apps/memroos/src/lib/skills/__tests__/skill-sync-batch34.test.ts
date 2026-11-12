// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b34-${crypto.randomUUID()}`);

let db: Database.Database;

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: batch34
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## Body
batch34
`;

function insertSkillRow(name: string, body: string, hash: string, harness = "claude"): void {
  db.prepare(
    `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
      version, preconditions, allowed_tools, verification_checks, rollback_behavior,
      raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
      evidence_examples, content_hash, trust_level)
     VALUES (?, '', 'ops', ?, 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
  ).run(name, harness, body, new Date().toISOString(), hash);
}

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  db.close();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  vi.restoreAllMocks();
});

describe("skill-sync batch34 — list filters, pin suppress, dedupe, observability", () => {
  it.skip("sanitizeJsonPayload null early return (441) — diffPayload is always a constructed object", () => {});

  it.skip("dead try/catch rawBody = raw (722–727) and empty skill_name (737) — no reachable scanner inputs", () => {});

  it("listSyncState honors limit and offset branches (904–905)", async () => {
    const { pinVersion, listSyncState } = await import("../skill-sync");
    for (let i = 0; i < 3; i += 1) {
      const name = `lim-b34-${crypto.randomUUID().slice(0, 6)}-${i}`;
      const body = VALID_SKILL_MD(name, "1.0.0");
      insertSkillRow(name, body, computeContentHash(body));
      pinVersion(db, {
        skill_name: name,
        source_harness: "claude",
        version: "1.0.0",
        actor: "batch34",
      });
    }
    const page = listSyncState(db, { pinned_only: true, limit: 2, offset: 1 });
    expect(page.length).toBeLessThanOrEqual(2);
  });

  it("createImportProposal skips drift when version_pinned_to is set", async () => {
    const { createImportProposal, pinVersion } = await import("../skill-sync");
    const skillName = `pinned-b34-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, body, computeContentHash(body));
    pinVersion(db, {
      skill_name: skillName,
      source_harness: "claude",
      version: "1.0.0",
      actor: "batch34",
    });
    const result = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "9.0.0",
        raw_body: VALID_SKILL_MD(skillName, "9.0.0"),
        content_hash: "f".repeat(64),
      },
      proposed_by: "scanner-b34",
    });
    expect(result.created).toBe(false);
    expect(result.proposal.version_pinned_to).toBe("1.0.0");
  });

  it("createImportProposal dedupes identical pending detected hashes (1103–1118)", async () => {
    const { createImportProposal } = await import("../skill-sync");
    const skillName = `dedupe-b34-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, body, computeContentHash(body));
    const driftHash = "a".repeat(64);
    const driftBody = VALID_SKILL_MD(skillName, "2.0.0");
    const first = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: driftBody,
        content_hash: driftHash,
      },
      proposed_by: "scanner-b34",
    });
    const second = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: driftBody,
        content_hash: driftHash,
      },
      proposed_by: "scanner-b34",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposal.pending_proposal_id).toBe(first.proposal.pending_proposal_id);
  });

  it("listSyncObservability surfaces rejected status when rejected_at is set", async () => {
    const { createImportProposal, rejectImportProposal, listSyncObservability } = await import("../skill-sync");
    const skillName = `rej-obs-b34-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, body, computeContentHash(body));
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD(skillName, "2.0.0"),
        content_hash: "b".repeat(64),
      },
      proposed_by: "batch34",
    });
    rejectImportProposal(db, {
      skill_name: skillName,
      source_harness: "claude",
      operator: "operator-b34",
      reason: "not now",
    });
    const items = listSyncObservability(db, {});
    const item = items.find((r) => r.skill_name === skillName);
    expect(item?.status).toBe("rejected");
  });

  it("approveImportProposal inserts registry row when skill is new (1324–1348)", async () => {
    const { createImportProposal, approveImportProposal } = await import("../skill-sync");
    const skillName = `new-reg-b34-${crypto.randomUUID().slice(0, 8)}`;
    const newBody = VALID_SKILL_MD(skillName, "1.0.0");
    const newHash = computeContentHash(newBody);
    createImportProposal(db, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        raw_body: newBody,
        content_hash: newHash,
      },
      proposed_by: "batch34",
      diff_payload: { raw_body: newBody, version: "1.0.0" },
    });
    approveImportProposal(db, {
      skill_name: skillName,
      source_harness: "codex",
      operator: "operator-b34",
    });
    const reg = db
      .prepare(`SELECT dispatch_status, content_hash FROM skill_registry WHERE name = ? AND source_harness = 'codex'`)
      .get(skillName) as { dispatch_status: string; content_hash: string };
    expect(reg.dispatch_status).toBe("quarantined");
    expect(reg.content_hash).toBe(newHash);
  });

  it("detectHarnessSkills skips child directories without treating them as skills", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const root = path.join(TMP_ROOT, "claude-b34");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, "nested-dir"), { recursive: true });
    const skillName = `file-b34-${crypto.randomUUID().slice(0, 8)}`;
    fs.writeFileSync(path.join(root, `${skillName}.md`), VALID_SKILL_MD(skillName, "1.0.0"), "utf8");
    const scan = detectHarnessSkills({ roots: { claude: root, codex: "", hermes: "", openclaw: "" } as never });
    expect(scan.entries.some((e) => e.skill_name === skillName)).toBe(true);
    expect(scan.entries.some((e) => e.skill_name === "nested-dir")).toBe(false);
  });

  it("createImportProposal derives detected hash from raw_body when hash omitted (994–995)", async () => {
    const { createImportProposal } = await import("../skill-sync");
    const skillName = `hash-missing-b34-${crypto.randomUUID().slice(0, 8)}`;
    const bodyV1 = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, bodyV1, computeContentHash(bodyV1));
    const bodyV2 = VALID_SKILL_MD(skillName, "2.0.0");
    const { created, proposal } = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: bodyV2,
      },
      proposed_by: "batch34",
    });
    expect(created).toBe(true);
    expect(proposal.pending_detected_hash).toBe(computeContentHash(bodyV2));
  });
});
