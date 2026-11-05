// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `intake-export-b13-${crypto.randomUUID()}`);

async function loadDb() {
  const root = path.join(TMP_ROOT, `db-${crypto.randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  process.env["MEMROOS_ROOT"] = root;
  process.env["SQLITE_DB_PATH"] = path.join(root, "test.db");
  vi.resetModules();
  const { getDb, closeDb } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = getDb();
  initSchema(db);
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

describe("intake-export batch13", () => {
  it("exportProposal validates required runtime fields", async () => {
    const { exportProposal } = await import("../intake-export");
    expect(() =>
      exportProposal(db, {
        proposalId: "",
        runtimeSkillId: "skill-1",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "0".repeat(64),
        actor: "operator",
      })
    ).toThrow(/proposalId is required/);
  });

  it("advanceProposalState throws when proposal disappears after update", async () => {
    const { intakeProposal, advanceProposalState } = await import("../intake-export");
    const proposalId = `prop-${crypto.randomUUID()}`;
    intakeProposal(db, {
      proposalId,
      sourceSkillId: "skill-1",
      sourceVersion: "1.0.0",
      proposedDiff: "## body",
      actor: "operator",
    });
    db.exec(`
      CREATE TRIGGER skillforge_intake_vanish
      AFTER UPDATE ON skillforge_intake_proposals
      WHEN NEW.id = '${proposalId}'
      BEGIN
        DELETE FROM skillforge_intake_proposals WHERE id = NEW.id;
      END;
    `);
    expect(() =>
      advanceProposalState(db, {
        proposalId,
        actor: "operator",
        toState: "analyzing",
      })
    ).toThrow(/re-reading proposal after advance failed/);
  });

  it("rollbackExport returns status_only when proposal was never exported", async () => {
    const { intakeProposal, rollbackExport } = await import("../intake-export");
    const proposalId = `prop-${crypto.randomUUID()}`;
    intakeProposal(db, {
      proposalId,
      sourceSkillId: "skill-1",
      sourceVersion: "1.0.0",
      proposedDiff: "## body",
      actor: "operator",
    });
    const result = rollbackExport(db, {
      proposalId,
      actor: "operator",
      reason: "not exported yet",
    });
    expect(result.outcome).toBe("status_only");
  });

  it("loadExportRecord returns null when no export exists", async () => {
    const { loadExportRecord } = await import("../intake-export");
    expect(loadExportRecord(db, "missing-proposal")).toBeNull();
  });
});
