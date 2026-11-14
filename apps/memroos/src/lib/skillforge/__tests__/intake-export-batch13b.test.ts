// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `intake-export-b13b-${crypto.randomUUID()}`);

async function loadDb() {
  const root = path.join(TMP_ROOT, `db-${crypto.randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  process.env["MEMROOS_ROOT"] = root;
  process.env["SQLITE_DB_PATH"] = path.join(root, "test.db");
  vi.resetModules();
  const { getDb, closeDb } = await import("@/lib/db");
  const db = getDb();
  return { db, closeDb };
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

describe("intake-export batch13b — state machine guards", () => {
  it("intakeProposal rejects empty proposedDiff", async () => {
    const { intakeProposal } = await import("../intake-export");
    expect(() =>
      intakeProposal(db, {
        proposalId: `prop-${crypto.randomUUID()}`,
        sourceSkillId: "skill-1",
        sourceVersion: "1.0.0",
        proposedDiff: "",
        actor: "operator",
      })
    ).toThrow(/proposedDiff is required/);
  });

  it("advanceProposalState refuses illegal skip transitions", async () => {
    const { intakeProposal, advanceProposalState } = await import("../intake-export");
    const proposalId = `prop-${crypto.randomUUID()}`;
    intakeProposal(db, {
      proposalId,
      sourceSkillId: "skill-1",
      sourceVersion: "1.0.0",
      proposedDiff: "## body",
      actor: "operator",
    });
    expect(() =>
      advanceProposalState(db, {
        proposalId,
        actor: "operator",
        toState: "exported",
      })
    ).toThrow(/illegal transition/);
  });

  it("exportProposal requires applied state before export", async () => {
    const { intakeProposal, advanceProposalState, exportProposal } = await import("../intake-export");
    const proposalId = `prop-${crypto.randomUUID()}`;
    intakeProposal(db, {
      proposalId,
      sourceSkillId: "skill-1",
      sourceVersion: "1.0.0",
      proposedDiff: "## body",
      actor: "operator",
    });
    expect(() =>
      exportProposal(db, {
        proposalId,
        runtimeSkillId: "skill-1",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "0".repeat(64),
        actor: "operator",
      })
    ).toThrow(/cannot be exported/);
  });

  it("loadIntakeRow returns null for unknown id", async () => {
    const { loadIntakeRow } = await import("../intake-export");
    expect(loadIntakeRow(db, `missing-${crypto.randomUUID()}`)).toBeNull();
  });

  it("advanceProposalState can terminate in rejected from pending_approval", async () => {
    const { intakeProposal, advanceProposalState } = await import("../intake-export");
    const proposalId = `prop-${crypto.randomUUID()}`;
    intakeProposal(db, {
      proposalId,
      sourceSkillId: "skill-1",
      sourceVersion: "1.0.0",
      proposedDiff: "## body",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "pending_approval" });
    advanceProposalState(db, { proposalId, actor: "operator", toState: "rejected", note: "failed eval" });
    const row = db.prepare(`SELECT state FROM skillforge_intake_proposals WHERE id = ?`).get(proposalId) as {
      state: string;
    };
    expect(row.state).toBe("rejected");
  });
});
