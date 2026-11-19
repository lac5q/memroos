// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveFromRepoRoot } from "@/lib/paths";
import { runBenchmark, renderTextReport, writeReport } from "../runner";
import type { AggregateReport } from "../schema";

const FIXTURES_DIR = resolveFromRepoRoot("evals", "comparative-retrieval", "fixtures");
const OUT_ROOT = path.join(os.tmpdir(), "runner-b18b-out");

afterEach(() => {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
});

describe("retrieval-bench runner batch18b", () => {
  it("honors cliCommand.noWrite without bypassCliParser", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 1,
      fixturesDir: FIXTURES_DIR,
      cliCommand: { noWrite: true },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.auditPersistence?.anySkippedNoWrite).toBe(true);
  });

  it("writeReport emits markdown via renderTextReport with abstention metrics", async () => {
    const run = await runBenchmark({
      dataset: "memroos_public_synthetic",
      adapter: "lexical",
      limit: 1,
      k: 2,
      seed: 0,
      bypassCliParser: true,
      fixturesDir: FIXTURES_DIR,
      noWrite: true,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const report: AggregateReport = {
      ...run.report,
      aggregate: {
        ...run.report.aggregate,
        abstentionAccuracy: 0.5,
        abstentionLabeledCount: 2,
        abstentionAnswerableFailureCount: 1,
        contextPackBytes: 128,
        contextPackHash: "sha256:pack",
        tokensRetrieval: 10,
        tokensRerank: 5,
        tokensPack: 3,
        tokensJudge: 1,
        laneMetrics: { external_retrieval: null },
      },
    };
    const md = renderTextReport(report);
    expect(md).toContain("abstention_accuracy");
    expect(md).toContain("context_pack_bytes");

    fs.mkdirSync(OUT_ROOT, { recursive: true });
    const written = writeReport({ report, outputDir: OUT_ROOT, extension: "md" });
    expect(written.written).toBe(true);
    expect(fs.readFileSync(written.path, "utf8")).toContain("MemroOS Comparative Retrieval Benchmark");
  });
});
