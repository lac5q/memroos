// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getPostBySlug } from "@/lib/blog";
import { createBuiltInScorers } from "@/lib/evals/scorers";
import { createOpenAICompatibleCoveClient } from "@/lib/cove";
import { listSessionJsonlFiles } from "@/lib/observe-sidecar";
import { loadSyntheticSmoke, hashSyntheticSmoke } from "@/lib/retrieval-bench/adapters/synthetic";
import {
  loadBaselineSkillContent,
  scoreProposalInBehavioralSandbox,
} from "@/lib/skillforge/behavioral-sandbox-scorer";
import { setSpaceShared, isSpaceShared, assertWritableSpace } from "@/lib/shared-space";
import type { SkillForgeProposal, SkillForgeSplit } from "@/lib/skillforge/types";

const db = new Database(":memory:");
initSchema(db);

vi.mock("@/lib/db", () => ({
  getDb: () => db,
  closeDb: () => {},
}));

let tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tmpDirs = [];
  vi.restoreAllMocks();
});

describe("long-tail batch20 lib — blog and eval scorers", () => {
  it("getPostBySlug returns null for unknown slug", () => {
    expect(getPostBySlug(`missing-slug-${randomUUID()}`)).toBeNull();
  });

  it("built-in scorers handle empty tool calls and memory recall branches", () => {
    const scorers = createBuiltInScorers();
    const toolScorer = scorers.find((s) => s.id === "tool_call_schema")!;
    const empty = toolScorer.score({ output: "hi", toolCalls: [] });
    expect(empty.score).toBe(0.75);

    const memoryScorer = scorers.find((s) => s.id === "memory_recall_l1")!;
    const neutral = memoryScorer.score({ output: "x" });
    expect(neutral.score).toBe(0.5);

    const withFacts = memoryScorer.score({
      output: "alpha beta",
      memory: { expectedFacts: ["alpha"], retrievedFacts: ["alpha"] },
    });
    expect(withFacts.score).toBe(1);
  });

  it("cost and TTR scorers use neutral fallback when signals absent", () => {
    const scorers = createBuiltInScorers();
    const ttr = scorers.find((s) => s.id === "ttr_p50")!.score({ output: "" });
    const cost = scorers.find((s) => s.id === "cost_per_task")!.score({ output: "" });
    expect(ttr.score).toBe(0.5);
    expect(cost.score).toBe(0.5);
  });
});

describe("long-tail batch20 lib — cove client and observe sidecar", () => {
  it("createOpenAICompatibleCoveClient appends /chat/completions and parses body", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: "verified answer" } }] }),
    );
    const client = createOpenAICompatibleCoveClient({
      endpoint: "https://api.example.com/v1/",
      model: "test-model",
      fetchImpl,
    });
    const text = await client("prompt");
    expect(text).toBe("verified answer");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("listSessionJsonlFiles skips dot dirs and respects max depth", () => {
    const root = path.join(os.tmpdir(), `observe-${randomUUID()}`);
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(root, "session.jsonl"), "{}\n");
    tmpDirs.push(root);
    const files = listSessionJsonlFiles(root, 0);
    expect(files).toContain(path.join(root, "session.jsonl"));
  });
});

describe("long-tail batch20 lib — synthetic adapter and behavioral sandbox", () => {
  it("loadSyntheticSmoke reports missing fixture", () => {
    const res = loadSyntheticSmoke({ fixturesDir: path.join(os.tmpdir(), "no-fixtures-here") });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/fixture_file_not_found/);
  });

  it("loadSyntheticSmoke reports malformed JSON", () => {
    const dir = path.join(os.tmpdir(), `syn-${randomUUID()}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "memroos-public-smoke.json"), "not-json");
    tmpDirs.push(dir);
    const res = loadSyntheticSmoke({ fixturesDir: dir });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/malformed/);
  });

  it("loadBaselineSkillContent falls back when registry empty", () => {
    const body = loadBaselineSkillContent(db, "skill-x", "v1");
    expect(body).toContain("skill-x");
  });

  it("scoreProposalInBehavioralSandbox returns task scores for held-out split", () => {
    const proposal: SkillForgeProposal = {
      id: "prop-1",
      sealProposalId: null,
      sourceSkillId: "demo-skill",
      sourceVersion: "1",
      proposedDiff: "keyword coverage for sandbox task alpha",
      status: "pending",
      trainSplitId: null,
      validationResults: null,
      heldOutResults: null,
      wDelta: null,
      rejectedEdits: [],
      residualRisks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const split: SkillForgeSplit = {
      id: "split-1",
      skillId: "demo-skill",
      splitType: "held_out",
      taskSamples: ["alpha keyword task"],
      createdAt: new Date(),
    };
    const result = scoreProposalInBehavioralSandbox(db, proposal, split);
    expect(result.tasksRun).toBeGreaterThan(0);
    expect(result.receipt.sideEffectsDenied).toBe(true);
    expect(hashSyntheticSmoke([])).toMatch(/^sha256:/);
  });
});

describe("long-tail batch20 lib — shared space guards", () => {
  it("setSpaceShared requires spaceId, actorId, and reason when unsharing", () => {
    expect(() => setSpaceShared(db, { spaceId: "", isShared: true, actorId: "op" })).toThrow(/spaceId/);
    expect(() => setSpaceShared(db, { spaceId: "s1", isShared: true, actorId: "" })).toThrow(/actorId/);
    expect(() =>
      setSpaceShared(db, { spaceId: "missing-space", isShared: false, actorId: "op" }),
    ).toThrow(/reason/);
  });

  it("isSpaceShared returns false for blank id and assertWritableSpace rejects shared", () => {
    expect(isSpaceShared(db, "   ")).toBe(false);
    const spaceId = `space-${randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO spaces (id, name, tenant_id, created_at) VALUES (?, 'Test', 'default-tenant', datetime('now'))`).run(
      spaceId,
    );
    setSpaceShared(db, { spaceId, isShared: true, actorId: "operator-1", reason: "read-only demo" });
    expect(isSpaceShared(db, spaceId)).toBe(true);
    expect(() => assertWritableSpace(db, spaceId)).toThrow(/shared/i);
  });
});
