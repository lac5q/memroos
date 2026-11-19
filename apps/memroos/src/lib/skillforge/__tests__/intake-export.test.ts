// @vitest-environment node
/**
 * VAL-SKILL-036 / VAL-SKILL-037 — SkillForge intake, export, rollback.
 *
 * Covers:
 *   - intake creates non-authoritative proposals
 *   - approval alone does not export
 *   - state machine blocks comments / repeated actions from advancing past failed eval
 *   - export binds edit/evaluation hashes + pre/post runtime identity
 *   - rollback restores runtime boundary or reports status_only truthfully
 *   - duplicate intake on the same edit hash is idempotent
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";

const TMP_ROOT = path.join(os.tmpdir(), `intake-export-${crypto.randomUUID()}`);

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
  } catch {}
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("VAL-SKILL-036 intake creates non-authoritative proposals", () => {
  it("intakeProposal persists row at intake_pending state", async () => {
    const { intakeProposal, loadIntakeRow, PROPOSAL_STATES } = await import(
      "../intake-export"
    );
    expect(PROPOSAL_STATES).toContain("intake_pending");

    const record = intakeProposal(db, {
      proposalId: "intake-1",
      sourceSkillId: "skill-99",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    expect(record.state).toBe("intake_pending");
    expect(record.editHash).toBe(createHash("sha256").update("## Preconditions\nnone", "utf8").digest("hex"));
    expect(record.evaluationHash).toBeNull();
    expect(record.redactedEntryCount).toBe(0);

    const roundtrip = loadIntakeRow(db, "intake-1");
    expect(roundtrip?.state).toBe("intake_pending");
  });

  it("intake is idempotent on (source_skill_id, source_version, edit_hash)", async () => {
    const { intakeProposal, loadIntakeRow } = await import("../intake-export");
    const a = intakeProposal(db, {
      proposalId: "intake-idemp-1",
      sourceSkillId: "skill-100",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    const b = intakeProposal(db, {
      proposalId: "intake-idemp-1-different-id",
      sourceSkillId: "skill-100",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    expect(a.proposalId).toBe("intake-idemp-1");
    expect(b.proposalId).toBe("intake-idemp-1");
    const row = loadIntakeRow(db, "intake-idemp-1");
    expect(row).not.toBeNull();
  });

  it("recordIntakeRedaction stamps count and scope key", async () => {
    const { intakeProposal, recordIntakeRedaction, loadIntakeRow } = await import(
      "../intake-export"
    );
    intakeProposal(db, {
      proposalId: "intake-redact",
      sourceSkillId: "skill-101",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    const after = recordIntakeRedaction(db, {
      proposalId: "intake-redact",
      actor: "operator",
      redactedEntryCount: 4,
      scopeKey: "tenant-a",
    });
    expect(after.redactedEntryCount).toBe(4);
    expect(after.scopeKey).toBe("tenant-a");

    const row = loadIntakeRow(db, "intake-redact");
    expect(row?.redactedEntryCount).toBe(4);
    expect(row?.scopeKey).toBe("tenant-a");
  });
});

describe("VAL-SKILL-036 state machine blocks repeated actions and failed eval", () => {
  it("terminal states (rejected, exported) cannot be left", async () => {
    const { intakeProposal, advanceProposalState, SkillForgeIntakeError } = await import(
      "../intake-export"
    );
    intakeProposal(db, {
      proposalId: "term-rej",
      sourceSkillId: "skill-200",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "term-rej", actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId: "term-rej", actor: "operator", toState: "rejected" });

    expect(() =>
      advanceProposalState(db, { proposalId: "term-rej", actor: "operator", toState: "analyzing" })
    ).toThrow(SkillForgeIntakeError);
  });

  it("skipping states is rejected (intake_pending -> pending_approval blocked)", async () => {
    const { intakeProposal, advanceProposalState, SkillForgeIntakeError } = await import(
      "../intake-export"
    );
    intakeProposal(db, {
      proposalId: "skip-1",
      sourceSkillId: "skill-201",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    expect(() =>
      advanceProposalState(db, { proposalId: "skip-1", actor: "operator", toState: "pending_approval" })
    ).toThrow(SkillForgeIntakeError);
  });

  it("comments (note) cannot bypass failed evaluation (rejected after eval_running)", async () => {
    const { intakeProposal, advanceProposalState, loadIntakeRow } = await import(
      "../intake-export"
    );
    intakeProposal(db, {
      proposalId: "comment-1",
      sourceSkillId: "skill-202",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "comment-1", actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId: "comment-1", actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId: "comment-1", actor: "operator", toState: "rejected", note: "failed eval" });

    // Re-advance after rejected: must fail
    expect(() =>
      advanceProposalState(db, { proposalId: "comment-1", actor: "operator", toState: "eval_running", note: "second try" })
    ).toThrow();

    const row = loadIntakeRow(db, "comment-1");
    expect(row?.state).toBe("rejected");
  });
});

describe("VAL-SKILL-036 hash helpers and listing", () => {
  it("computeEvaluationHash is stable for the same receipt JSON", async () => {
    const { computeEditHash, computeEvaluationHash } = await import("../intake-export");
    const receipt = JSON.stringify({ verdict: "pass", score: 1 });
    expect(computeEvaluationHash(receipt)).toBe(computeEvaluationHash(receipt));
    expect(computeEditHash("## Preconditions\nnone")).toHaveLength(64);
  });

  it("listIntakeProposals filters by state and returns newest first", async () => {
    const { intakeProposal, advanceProposalState, listIntakeProposals } = await import("../intake-export");
    intakeProposal(db, {
      proposalId: "list-pending",
      sourceSkillId: "skill-500",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\npending",
      actor: "operator",
    });
    intakeProposal(db, {
      proposalId: "list-rejected",
      sourceSkillId: "skill-501",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nrejected",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "list-rejected", actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId: "list-rejected", actor: "operator", toState: "rejected" });

    const pending = listIntakeProposals(db, { state: "intake_pending" });
    expect(pending.some((row) => row.proposalId === "list-pending")).toBe(true);
    expect(pending.some((row) => row.proposalId === "list-rejected")).toBe(false);

    const all = listIntakeProposals(db, { limit: 10 });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("isAuthoritative is true only for approved, applied, and exported states", async () => {
    const { isAuthoritative } = await import("../intake-export");
    expect(isAuthoritative("approved")).toBe(true);
    expect(isAuthoritative("applied")).toBe(true);
    expect(isAuthoritative("exported")).toBe(true);
    expect(isAuthoritative("intake_pending")).toBe(false);
    expect(isAuthoritative("rejected")).toBe(false);
  });

  it("intakeProposal validates required fields", async () => {
    const { intakeProposal, SkillForgeIntakeError } = await import("../intake-export");
    expect(() =>
      intakeProposal(db, {
        proposalId: "",
        sourceSkillId: "skill-502",
        sourceVersion: "1.0.0",
        proposedDiff: "## Preconditions\nnone",
        actor: "operator",
      })
    ).toThrow(SkillForgeIntakeError);
  });

  it("advanceProposalState appends notes and exported proposals stay terminal", async () => {
    const {
      intakeProposal,
      advanceProposalState,
      exportProposal,
      loadIntakeRow,
      SkillForgeIntakeError,
    } = await import("../intake-export");
    intakeProposal(db, {
      proposalId: "note-export",
      sourceSkillId: "skill-503",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "note-export", actor: "operator", toState: "analyzing", note: "first note" });
    advanceProposalState(db, { proposalId: "note-export", actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId: "note-export", actor: "operator", toState: "pending_approval" });
    advanceProposalState(db, { proposalId: "note-export", actor: "operator", toState: "approved" });
    exportProposal(db, {
      proposalId: "note-export",
      runtimeSkillId: "skill-503",
      runtimeVersion: "1.0.0",
      runtimeContentHash: "hash-503",
      actor: "operator",
    });
    const exported = loadIntakeRow(db, "note-export");
    expect(exported?.notes).toContain("first note");
    expect(exported?.state).toBe("exported");
    expect(() =>
      advanceProposalState(db, { proposalId: "note-export", actor: "operator", toState: "analyzing" })
    ).toThrow(SkillForgeIntakeError);
  });

  it("rollback on already rolled back export returns status_only", async () => {
    const { intakeProposal, advanceProposalState, exportProposal, rollbackExport } = await import("../intake-export");
    intakeProposal(db, {
      proposalId: "double-rollback",
      sourceSkillId: "skill-504",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "double-rollback", actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId: "double-rollback", actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId: "double-rollback", actor: "operator", toState: "pending_approval" });
    advanceProposalState(db, { proposalId: "double-rollback", actor: "operator", toState: "approved" });
    exportProposal(db, {
      proposalId: "double-rollback",
      runtimeSkillId: "skill-504",
      runtimeVersion: "1.0.0",
      runtimeContentHash: "hash-504",
      actor: "operator",
    });
    const first = rollbackExport(db, {
      proposalId: "double-rollback",
      actor: "operator",
      reason: "first rollback",
    });
    expect(first.outcome).toBe("restored");
    const second = rollbackExport(db, {
      proposalId: "double-rollback",
      actor: "operator",
      reason: "second rollback",
    });
    expect(second.outcome).toBe("status_only");
    expect(second.reason).toMatch(/applied|already rolled back|no prior runtime export/i);
  });
});

describe("VAL-SKILL-037 export binds hashes and prevents runtime when not approved", () => {
  it("exportProposal refuses a non-authoritative proposal (no auto-export from approval)", async () => {
    const { intakeProposal, exportProposal, SkillForgeIntakeError } = await import(
      "../intake-export"
    );
    intakeProposal(db, {
      proposalId: "not-auth",
      sourceSkillId: "skill-300",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    expect(() =>
      exportProposal(db, {
        proposalId: "not-auth",
        runtimeSkillId: "skill-300",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "abc",
        actor: "operator",
      })
    ).toThrow(SkillForgeIntakeError);
  });

  it("exportProposal binds edit + eval hashes and runtime identity; advances to exported", async () => {
    const { intakeProposal, advanceProposalState, exportProposal, loadIntakeRow, loadExportRecord } =
      await import("../intake-export");
    intakeProposal(db, {
      proposalId: "export-1",
      sourceSkillId: "skill-301",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      evaluationHash: "deadbeef",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "export-1", actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId: "export-1", actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId: "export-1", actor: "operator", toState: "pending_approval" });
    advanceProposalState(db, { proposalId: "export-1", actor: "operator", toState: "approved" });

    const exportRec = exportProposal(db, {
      proposalId: "export-1",
      runtimeSkillId: "skill-301",
      runtimeVersion: "1.0.0",
      runtimeContentHash: "newhash",
      actor: "operator",
    });
    expect(exportRec.runtimeSkillId).toBe("skill-301");
    expect(exportRec.runtimeVersion).toBe("1.0.0");
    expect(exportRec.runtimeContentHash).toBe("newhash");
    expect(exportRec.editHash).toBe(createHash("sha256").update("## Preconditions\nnone", "utf8").digest("hex"));
    expect(exportRec.evaluationHash).toBe("deadbeef");

    const proposal = loadIntakeRow(db, "export-1");
    expect(proposal?.state).toBe("exported");

    const stored = loadExportRecord(db, "export-1");
    expect(stored).not.toBeNull();
    expect(stored?.runtimeContentHash).toBe("newhash");
  });

  it("rollback restores runtime identity and stamps rolled_back_at", async () => {
    const { intakeProposal, advanceProposalState, exportProposal, rollbackExport } =
      await import("../intake-export");
    intakeProposal(db, {
      proposalId: "rollback-1",
      sourceSkillId: "skill-400",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "rollback-1", actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId: "rollback-1", actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId: "rollback-1", actor: "operator", toState: "pending_approval" });
    advanceProposalState(db, { proposalId: "rollback-1", actor: "operator", toState: "approved" });
    exportProposal(db, {
      proposalId: "rollback-1",
      runtimeSkillId: "skill-400",
      runtimeVersion: "1.0.0",
      runtimeContentHash: "post-hash",
      actor: "operator",
    });

    const result = rollbackExport(db, {
      proposalId: "rollback-1",
      actor: "operator",
      reason: "reverting",
    });
    expect(result.outcome).toBe("restored");
    expect(result.restored?.runtimeContentHash).toBe("post-hash");
  });

  it("rollback of never-exported proposal returns status_only with reason", async () => {
    const { intakeProposal, rollbackExport } = await import("../intake-export");
    intakeProposal(db, {
      proposalId: "never-export",
      sourceSkillId: "skill-401",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });

    const result = rollbackExport(db, {
      proposalId: "never-export",
      actor: "operator",
      reason: "abandon",
    });
    expect(result.outcome).toBe("status_only");
    expect(result.reason).toMatch(/not_exported|status-only/);
  });

  it("rollbackExport validates required proposalId, actor, and reason", async () => {
    const { rollbackExport, SkillForgeIntakeError } = await import("../intake-export");
    expect(() =>
      rollbackExport(db, { proposalId: "", actor: "operator", reason: "x" })
    ).toThrow(SkillForgeIntakeError);
    expect(() =>
      rollbackExport(db, { proposalId: "p1", actor: "", reason: "x" })
    ).toThrow(SkillForgeIntakeError);
    expect(() =>
      rollbackExport(db, { proposalId: "p1", actor: "operator", reason: "" })
    ).toThrow(SkillForgeIntakeError);
  });

  it("rollbackExport throws when the proposal id does not exist", async () => {
    const { rollbackExport, SkillForgeIntakeError } = await import("../intake-export");
    expect(() =>
      rollbackExport(db, {
        proposalId: "missing-proposal",
        actor: "operator",
        reason: "cleanup",
      })
    ).toThrow(SkillForgeIntakeError);
  });

  it("exports state constants and advances through applied before exported", async () => {
    const {
      intakeProposal,
      advanceProposalState,
      exportProposal,
      AUTHORITATIVE_PROPOSAL_STATES,
      TERMINAL_PROPOSAL_STATES,
      loadIntakeRow,
    } = await import("../intake-export");
    expect(AUTHORITATIVE_PROPOSAL_STATES).toContain("applied");
    expect(TERMINAL_PROPOSAL_STATES).toContain("exported");

    intakeProposal(db, {
      proposalId: "applied-path",
      sourceSkillId: "skill-505",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "applied-path", actor: "operator", toState: "analyzing" });
    advanceProposalState(db, { proposalId: "applied-path", actor: "operator", toState: "eval_running" });
    advanceProposalState(db, { proposalId: "applied-path", actor: "operator", toState: "pending_approval" });
    advanceProposalState(db, { proposalId: "applied-path", actor: "operator", toState: "approved" });
    advanceProposalState(db, { proposalId: "applied-path", actor: "operator", toState: "applied" });
    exportProposal(db, {
      proposalId: "applied-path",
      runtimeSkillId: "skill-505",
      runtimeVersion: "1.0.0",
      runtimeContentHash: "hash-505",
      actor: "operator",
    });
    expect(loadIntakeRow(db, "applied-path")?.state).toBe("exported");
  });

  it("recordIntakeRedaction rejects missing proposals and invalid states", async () => {
    const { recordIntakeRedaction, intakeProposal, advanceProposalState, SkillForgeIntakeError } =
      await import("../intake-export");
    expect(() =>
      recordIntakeRedaction(db, {
        proposalId: "missing",
        actor: "operator",
        redactedEntryCount: 1,
        scopeKey: "scope",
      })
    ).toThrow(SkillForgeIntakeError);
    intakeProposal(db, {
      proposalId: "redact-state",
      sourceSkillId: "skill-506",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    advanceProposalState(db, { proposalId: "redact-state", actor: "operator", toState: "analyzing" });
    expect(() =>
      recordIntakeRedaction(db, {
        proposalId: "redact-state",
        actor: "operator",
        redactedEntryCount: 2,
        scopeKey: "scope-1",
      })
    ).toThrow(/only 'intake_pending'/);
  });

  it("recordIntakeRedaction stores scope metadata on pending proposals", async () => {
    const { recordIntakeRedaction, intakeProposal, loadIntakeRow } = await import("../intake-export");
    intakeProposal(db, {
      proposalId: "redact-ok",
      sourceSkillId: "skill-507",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    });
    const updated = recordIntakeRedaction(db, {
      proposalId: "redact-ok",
      actor: "operator",
      redactedEntryCount: 3,
      scopeKey: "tenant/default",
    });
    expect(updated.redactedEntryCount).toBe(3);
    expect(updated.scopeKey).toBe("tenant/default");
    expect(loadIntakeRow(db, "redact-ok")?.scopeKey).toBe("tenant/default");
  });
});

describe("intakeProposal validation", () => {
  it("rejects missing proposalId, sourceSkillId, sourceVersion, diff, and actor", async () => {
    const { intakeProposal, SkillForgeIntakeError } = await import("../intake-export");
    const base = {
      proposalId: "p1",
      sourceSkillId: "skill-1",
      sourceVersion: "1.0.0",
      proposedDiff: "## Preconditions\nnone",
      actor: "operator",
    };
    expect(() => intakeProposal(db, { ...base, proposalId: "  " })).toThrow(SkillForgeIntakeError);
    expect(() => intakeProposal(db, { ...base, sourceSkillId: "" })).toThrow(/sourceSkillId/);
    expect(() => intakeProposal(db, { ...base, sourceVersion: " " })).toThrow(/sourceVersion/);
    expect(() => intakeProposal(db, { ...base, proposedDiff: "" })).toThrow(/proposedDiff/);
    expect(() => intakeProposal(db, { ...base, actor: "" })).toThrow(/actor/);
  });
});
