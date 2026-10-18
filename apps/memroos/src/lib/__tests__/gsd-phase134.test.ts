// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `gsd-phase134-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "phase134.db");

async function loadDb() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const dbModule = await import("@/lib/db");
  return dbModule;
}

function seedSkill(
  db: import("better-sqlite3").Database,
  input: {
    name: string;
    owner?: string | null;
    sourceHarness?: string;
    verificationChecks?: string | null;
    importedAt?: string;
    rawBody?: string;
  }
) {
  db.prepare(
    `INSERT INTO skill_registry (
       name, owner, source_harness, verification_checks, raw_body, completeness_pct,
       missing_fields_json, imported_by, imported_at, dispatch_status
     ) VALUES (
       @name, @owner, @sourceHarness, @verificationChecks, @rawBody, 50,
       '[]', 'test', @importedAt, 'review'
     )`
  ).run({
    name: input.name,
    owner: input.owner ?? null,
    sourceHarness: input.sourceHarness ?? "cursor",
    verificationChecks: input.verificationChecks ?? null,
    rawBody: input.rawBody ?? "# Example\n\n```bash\necho ok\n```",
    importedAt: input.importedAt ?? new Date().toISOString(),
  });
}

describe("GSD skill boundary + discuss", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadDb();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it("loads manifest with core product barred surfaces", async () => {
    const { loadSkillBoundaryManifest } = await import("@/lib/gsd/skill-boundary");
    const manifest = loadSkillBoundaryManifest();
    expect(manifest.entries.some((entry) => entry.id === "agent_context_packet")).toBe(true);
    expect(manifest.coreProductBarredFromSkillsOnly).toContain("run_ledger");
  });

  it("audits skills and drafts proposals without auto-delete", async () => {
    const { getDb } = await loadDb();
    const db = getDb();
    seedSkill(db, { name: "unsafe-skill", owner: null, rawBody: "run rm -rf /" });
    seedSkill(db, { name: "good-skill", owner: "ops", verificationChecks: "npm test", sourceHarness: "codex" });
    seedSkill(db, { name: "dup-skill", owner: "ops", sourceHarness: "cursor" });
    seedSkill(db, { name: "dup-skill", owner: "ops", sourceHarness: "codex" });

    const { auditRegisteredSkills } = await import("@/lib/gsd/skill-boundary");
    const result = auditRegisteredSkills(db, { persistProposals: true });

    expect(result.skillsScanned).toBe(4);
    expect(result.findings.some((finding) => finding.code === "duplicate_trigger")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "missing_owner")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "unsafe_tool_instructions")).toBe(true);
    expect(result.proposalDrafts.length).toBeGreaterThan(0);

    const rows = db.prepare("SELECT COUNT(*) AS count FROM skill_registry").get() as { count: number };
    expect(rows.count).toBe(4);

    const noPersist = auditRegisteredSkills(db, { persistProposals: false });
    expect(noPersist.persistedProposalIds).toEqual([]);
  });

  it("blocks discuss council without validator pass", async () => {
    const { getDb } = await loadDb();
    const { runBoundedDiscussCouncil } = await import("@/lib/gsd/discuss");
    const result = runBoundedDiscussCouncil(getDb(), {
      goalId: "goal-discuss-1",
      actorAgentId: "agent-alpha",
      topic: "Phase 134 council",
      roles: [
        { role: "chair", agentId: "agent-alpha", mandate: "lead" },
        { role: "validator", agentId: "agent-beta", mandate: "validate" },
      ],
      taskBudget: { maxRounds: 2, maxAgents: 4 },
      verdict: {
        decision: "approve",
        summary: "Ship skill audit",
        actionItems: ["run /skill-audit"],
        risks: [],
        validatorPass: false,
      },
    });

    expect(result.blockedReasons).toContain("validator pass is required before ledgering council output.");
    expect(result.ledgerReceiptId).toBe(0);
  });

  it("throws when required discuss council fields are missing", async () => {
    const { getDb } = await loadDb();
    const { runBoundedDiscussCouncil } = await import("@/lib/gsd/discuss");
    expect(() =>
      runBoundedDiscussCouncil(getDb(), {
        goalId: "",
        actorAgentId: "agent-alpha",
        topic: "x",
        roles: [{ role: "validator", agentId: "v", mandate: "v" }],
        taskBudget: { maxRounds: 2, maxAgents: 4 },
        verdict: {
          decision: "approve",
          summary: "ok",
          actionItems: [],
          risks: [],
          validatorPass: true,
        },
      })
    ).toThrow(/goalId/);
  });

  it("blocks discuss council when task budget and roles are invalid", async () => {
    const { getDb } = await loadDb();
    const { runBoundedDiscussCouncil } = await import("@/lib/gsd/discuss");
    const result = runBoundedDiscussCouncil(getDb(), {
      goalId: "goal-budget",
      actorAgentId: "agent-alpha",
      topic: "Budget bounds",
      roles: [
        { role: "chair", agentId: "agent-alpha", mandate: "lead" },
        { role: "not-a-role" as never, agentId: "agent-beta", mandate: "bad" },
        { role: "validator", agentId: "agent-gamma", mandate: "validate" },
      ],
      taskBudget: { maxRounds: 9, maxAgents: 2 },
      verdict: {
        decision: "approve",
        summary: "Should block",
        actionItems: [],
        risks: [],
        validatorPass: true,
      },
    });
    expect(result.blockedReasons.some((reason) => reason.includes("maxRounds"))).toBe(true);
    expect(result.blockedReasons.some((reason) => reason.includes("invalid roles"))).toBe(true);
    expect(result.ledgerReceiptId).toBe(0);
  });

  it("ledgers bounded discuss council when validator passes", async () => {
    const { getDb } = await loadDb();
    const { runBoundedDiscussCouncil } = await import("@/lib/gsd/discuss");
    const result = runBoundedDiscussCouncil(getDb(), {
      goalId: "goal-discuss-2",
      actorAgentId: "agent-alpha",
      topic: "Phase 134 council",
      roles: [
        { role: "chair", agentId: "agent-alpha", mandate: "lead" },
        { role: "validator", agentId: "agent-beta", mandate: "validate" },
      ],
      taskBudget: { maxRounds: 2, maxAgents: 4 },
      verdict: {
        decision: "approve",
        summary: "Ship skill audit",
        actionItems: ["run /skill-audit"],
        risks: [],
        validatorPass: true,
        validatorNotes: "bounded council only",
      },
    });

    expect(result.blockedReasons).toEqual([]);
    expect(result.ledgerReceiptId).toBeGreaterThan(0);
    expect(result.checkpointId).not.toBe("");
  });
});
