// @vitest-environment node
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

describe("belief promotion eval batch14 — success paths for outbound handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs bronze_citation_only and receipt_exposes_stage handlers successfully", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const casesPath = path.join(os.tmpdir(), `belief-b14-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "bronze_citation_only", description: "bronze paths", expectations: {} },
        { id: "receipt_exposes_stage", description: "receipt shape", expectations: {} },
      ]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(true);
    expect(run.cases.map((c) => c.name)).toEqual(["bronze_citation_only", "receipt_exposes_stage"]);
    fs.unlinkSync(casesPath);
    db.close();
  });

  it("handler failure: silver outbound missing caveat", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const outbound = await import("@/lib/belief/outbound-policy");
    vi.spyOn(outbound, "filterOutboundClaims").mockReturnValue({
      emitted: [{ stage: "silver_candidate_claim", content: "x", caveat: null } as never],
      dropped: [],
      receipts: [],
    });
    const casesPath = path.join(os.tmpdir(), `belief-b14-silver-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([{ id: "unsupported_silver_never_truth", description: "force missing caveat", expectations: {} }]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db, casesPath });
    expect(run.pass).toBe(false);
    expect(run.cases[0]?.reason).toMatch(/caveat/);
    fs.unlinkSync(casesPath);
    db.close();
  });
});
