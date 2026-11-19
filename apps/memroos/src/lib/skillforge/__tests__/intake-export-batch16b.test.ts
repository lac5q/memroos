// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  computeEditHash,
  computeEvaluationHash,
  intakeProposal,
  isAuthoritative,
} from "../intake-export";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("intake-export batch16b", () => {
  it("computeEditHash and computeEvaluationHash are stable sha256 hex", () => {
    const edit = computeEditHash("+ added line");
    const evalHash = computeEvaluationHash(JSON.stringify({ score: 1 }));
    expect(edit).toMatch(/^[0-9a-f]{64}$/);
    expect(evalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEditHash("+ added line")).toBe(edit);
  });

  it("isAuthoritative recognizes terminal authoritative states only", () => {
    expect(isAuthoritative("approved")).toBe(true);
    expect(isAuthoritative("exported")).toBe(true);
    expect(isAuthoritative("intake_pending")).toBe(false);
  });

  it("intakeProposal is idempotent on source/version/edit hash tuple", () => {
    const database = freshDb();
    const diff = "diff-body";
    const editHash = computeEditHash(diff);
    const proposalId = `proposal-${crypto.randomUUID()}`;
    const params = {
      proposalId,
      sourceSkillId: `skill-${crypto.randomUUID().slice(0, 8)}`,
      sourceVersion: "1.0.0",
      proposedDiff: diff,
      actor: "operator",
    };
    const first = intakeProposal(database, params);
    const second = intakeProposal(database, params);
    expect(second.proposalId).toBe(first.proposalId);
    expect(second.editHash).toBe(editHash);
    expect(second.state).toBe("intake_pending");
  });
});
