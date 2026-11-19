// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `intake-export-b14-${crypto.randomUUID()}`);

async function loadDb() {
  vi.resetModules();
  const root = path.join(TMP_ROOT, `db-${crypto.randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  process.env["MEMROOS_ROOT"] = root;
  process.env["SQLITE_DB_PATH"] = path.join(root, "test.db");
  const { getDb, closeDb } = await import("@/lib/db");
  return { db: getDb(), closeDb };
}

let db: import("better-sqlite3").Database;
let closeDb: () => void;

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const mods = await loadDb();
  db = mods.db;
  closeDb = mods.closeDb;
});

afterEach(() => {
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("intake-export batch14 — duplicate intake and rollback branches", () => {
  it("intakeProposal resolves duplicate unique key to existing row by edit hash", async () => {
    const { intakeProposal } = await import("../intake-export");
    const proposalIdA = `prop-a-${crypto.randomUUID()}`;
    const proposalIdB = `prop-b-${crypto.randomUUID()}`;
    const diff = "## same diff body";
    intakeProposal(db, {
      proposalId: proposalIdA,
      sourceSkillId: "skill-dup",
      sourceVersion: "1.0.0",
      proposedDiff: diff,
      actor: "operator",
    });
    const row = intakeProposal(db, {
      proposalId: proposalIdB,
      sourceSkillId: "skill-dup",
      sourceVersion: "1.0.0",
      proposedDiff: diff,
      actor: "operator",
    });
    expect(row.proposalId).toBe(proposalIdA);
  });

  it("loadIntakeRowByKey returns null for unknown composite key", async () => {
    const { loadIntakeRowByKey } = await import("../intake-export");
    expect(loadIntakeRowByKey(db, "missing-skill", "9.9.9", "deadbeef")).toBeNull();
  });

  it("advanceProposalState throws proposal_not_found for missing id", async () => {
    const { advanceProposalState, SkillForgeIntakeError } = await import("../intake-export");
    expect(() =>
      advanceProposalState(db, {
        proposalId: `missing-${crypto.randomUUID()}`,
        actor: "operator",
        toState: "analyzing",
      })
    ).toThrow(SkillForgeIntakeError);
  });

  it("exportProposal validates required runtime fields", async () => {
    const { exportProposal, SkillForgeIntakeError } = await import("../intake-export");
    expect(() =>
      exportProposal(db, {
        proposalId: " ",
        runtimeSkillId: "skill",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "0".repeat(64),
        actor: "operator",
      })
    ).toThrow(SkillForgeIntakeError);
    expect(() =>
      exportProposal(db, {
        proposalId: `prop-${crypto.randomUUID()}`,
        runtimeSkillId: "",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "0".repeat(64),
        actor: "operator",
      })
    ).toThrow(/runtimeSkillId is required/);
  });

  it("rollbackExport returns status_only when no export record exists", async () => {
    const { intakeProposal, advanceProposalState, exportProposal, rollbackExport } = await import("../intake-export");
    const proposalId = `prop-rb-${crypto.randomUUID()}`;
    intakeProposal(db, {
      proposalId,
      sourceSkillId: "skill-rb",
      sourceVersion: "1.0.0",
      proposedDiff: "## body",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "pending_approval" });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "approved" });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "applied" });
    exportProposal(db, {
      proposalId,
      runtimeSkillId: "skill-rb",
      runtimeVersion: "1.0.0",
      runtimeContentHash: "0".repeat(64),
      actor: "operator",
    });
    db.prepare(`DELETE FROM skillforge_runtime_exports WHERE proposal_id = ?`).run(proposalId);
    const outcome = rollbackExport(db, {
      proposalId,
      actor: "operator",
      reason: "test missing export row",
    });
    expect(outcome.outcome).toBe("status_only");
    expect(outcome.reason).toMatch(/no prior runtime export/);
  });
});
