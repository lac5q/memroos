// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assembleRecollectionContextPack,
  decideRecollection,
  scoreRecollectionCandidate,
} from "@/lib/recollection-policy";
import {
  extractWikilinks,
  readWikiPage,
  resolveWikiPath,
  wikiRootExists,
} from "@/lib/wiki-vault";

describe("recollection-policy + wiki-vault batch28d", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("decideRecollection skips mechanical explicit-memory tasks", () => {
    const decision = decideRecollection({
      taskText: "format this table alphabetically",
    });
    expect(decision.decision).toBe("search_skipped");
    expect(decision.skipReason).toMatch(/mechanical/i);
  });

  it("assembleRecollectionContextPack ignores denied candidates and below-threshold scores", () => {
    const pack = assembleRecollectionContextPack(
      [
        {
          id: "deny-b28d",
          tier: "vector",
          content: "classified batch28d note",
          beliefStage: "bronze_raw_source",
          provenance: "vault",
          authorization: "denied",
        },
        {
          id: "low-b28d",
          tier: "episodic",
          content: "unrelated",
          beliefStage: "silver_candidate_claim",
          provenance: "vault",
          authorization: "allowed",
        },
      ],
      { taskText: "batch28d deployment timeline", threshold: 0.99, maxItems: 2 },
    );
    expect(pack.injected).toHaveLength(0);
    expect(pack.ignored.some((i) => i.reason === "policy_denied")).toBe(true);
    expect(pack.ignored.some((i) => i.reason === "below_threshold")).toBe(true);
  });

  it("scoreRecollectionCandidate penalizes high policy risk", () => {
    const scored = scoreRecollectionCandidate(
      {
        id: "risk-b28d",
        tier: "vector",
        content: "batch28d risk candidate overlaps timeline",
        beliefStage: "gold_operational_truth",
        provenance: "vault",
        policyRisk: "high",
        authorization: "allowed",
        importance: 0.9,
        capturedAt: new Date().toISOString(),
      },
      { taskText: "batch28d timeline", now: new Date("2026-07-17T12:00:00.000Z") },
    );
    expect(scored.components.riskPenalty).toBe(1);
    expect(scored.total).toBeLessThan(0.85);
  });

  it("wiki-vault rejects traversal and reads pages with heading titles", () => {
    const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b28d-${randomUUID()}-`));
    vaults.push(wikiRoot);
    expect(resolveWikiPath(wikiRoot, "../outside.md")).toBeNull();
    expect(wikiRootExists(wikiRoot)).toBe(true);
    fs.writeFileSync(path.join(wikiRoot, "note-b28d.md"), "# Batch28d Wiki Title\nbody", "utf8");
    const page = readWikiPage(wikiRoot, "note-b28d.md");
    expect(page?.title).toBe("Batch28d Wiki Title");
    expect(extractWikilinks("See [[Batch28d Wiki Title|alias]] for details.")).toEqual(["Batch28d Wiki Title"]);
  });
});
