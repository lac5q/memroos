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

describe("skill-sync batch25 — audit chain success, scanner guards, diff hash compute", () => {
  it("pinVersion writes skill-chain audit row when buildSkillAuditEntry succeeds", async () => {
    const database = freshDb();
    const skillName = `chain-ok-b25-${crypto.randomUUID().slice(0, 8)}`;
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

    const { pinVersion } = await import("../skill-sync");
    pinVersion(database, {
      skill_name: skillName,
      source_harness: "codex",
      version: "1.0.0",
      actor: "batch25",
    });
    const audit = database
      .prepare(
        `SELECT event_type FROM audit_entries WHERE event_type = 'skill.sync.pinned' ORDER BY rowid DESC LIMIT 1`,
      )
      .get() as { event_type: string } | undefined;
    expect(audit?.event_type).toBe("skill.sync.pinned");
  });

  it("rejectSyncProposalById returns early when audit_entries table is missing after chain failure", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const skillChainMod = await import("@/lib/audit/skill-chain");
    vi.spyOn(skillChainMod, "buildSkillAuditEntry").mockImplementation(() => {
      throw new Error("chain build failed batch25");
    });

    const skillName = `no-audit-table-b25-${crypto.randomUUID().slice(0, 8)}`;
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
      proposed_by: "batch25",
    });
    const rejected = rejectSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
      reason: "batch25 missing audit table",
    });
    expect(rejected.status).toBe("rejected");
  });

  it("detectHarnessSkills skips harness root that is a regular file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b25-file-root-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const fileRoot = path.join(root, "not-a-dir");
    fs.writeFileSync(fileRoot, "not a directory", "utf8");

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: fileRoot } });
    expect(scan.entries).toHaveLength(0);
    expect(scan.errors).toHaveLength(0);
  });

  it("detectHarnessSkills skips markdown path that is a directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b25-dir-md-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    fs.mkdirSync(path.join(harness, "looks-like-skill.md"), { recursive: true });

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: harness } });
    expect(scan.entries.some((e) => e.skill_name === "looks-like-skill")).toBe(false);
  });

  it("detectHarnessSkills records escape when realpath resolves outside harness root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b25-escape-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "hermes");
    const outside = path.join(root, "outside");
    fs.mkdirSync(harness, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "escaped-skill.md"), skillMd("escaped-skill"), "utf8");
    fs.symlinkSync(path.join(outside, "escaped-skill.md"), path.join(harness, "escaped-skill.md"));

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { hermes: harness } });
    expect(scan.errors.some((e) => e.reason.includes("symlink"))).toBe(true);
  });

  it("diffSkills computes detected.content_hash from raw_body when hash omitted", async () => {
    const { diffSkills } = await import("../skill-sync");
    const body = skillMd(`hash-compute-b25-${crypto.randomUUID().slice(0, 8)}`, "3.0.0");
    const diff = diffSkills(null, {
      skill_name: extractName(body),
      source_harness: "codex",
      version: "3.0.0",
      raw_body: body,
    });
    expect(diff.kind).toBe("add");
    expect(diff.detected_hash).toBe(computeContentHash(body));
  });

  it("diffSkills reports change when only raw_body drifts", async () => {
    const { diffSkills } = await import("../skill-sync");
    const name = `drift-b25-${crypto.randomUUID().slice(0, 8)}`;
    const v1 = skillMd(name, "1.0.0");
    const v2 = skillMd(name, "1.0.0").replace("# Body", "# Body v2");
    const diff = diffSkills(
      {
        skill_name: name,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: v1,
        content_hash: computeContentHash(v1),
      },
      {
        skill_name: name,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: v2,
        content_hash: computeContentHash(v2),
      },
    );
    expect(diff.kind).toBe("change");
    expect(diff.changed_fields.some((f) => f.field === "raw_body")).toBe(true);
  });
});

function extractName(body: string): string {
  const match = body.match(/^name:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "unknown";
}
