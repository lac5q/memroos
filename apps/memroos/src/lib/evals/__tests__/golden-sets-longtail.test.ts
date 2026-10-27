// @vitest-environment node
import path from "path";
import { describe, expect, it } from "vitest";

import { buildDefaultEvalConfig } from "@/lib/evals/config";
import { getRepoRoot } from "@/lib/paths";
import { goldenSetPathForTrace, hashGoldenSet, loadGoldenSet } from "../golden-sets";

describe("evals golden-sets long-tail", () => {
  it("returns empty when path escapes golden-sets directory", () => {
    expect(loadGoldenSet("/etc/passwd")).toEqual([]);
    expect(loadGoldenSet("../../package.json")).toEqual([]);
  });

  it("loads jsonl examples from within golden-sets", () => {
    const file = path.join(getRepoRoot(), "golden-sets", "ops-50.jsonl");
    const loaded = loadGoldenSet(file);
    expect(loaded.length).toBeGreaterThan(0);
    expect(hashGoldenSet(loaded)).toMatch(/^[a-f0-9]{16}$/);
  });

  it("resolves per-agent and per-role golden set paths", () => {
    const config = buildDefaultEvalConfig();
    const agentPath = goldenSetPathForTrace(config, { agentId: "unknown-agent", role: "operator" });
    expect(typeof agentPath).toBe("string");
    const roleOverride = goldenSetPathForTrace(config, {
      agentId: "x",
      role: Object.keys(config.goldenSets.perRole)[0] ?? "operator",
    });
    expect(roleOverride).toBeTruthy();
  });
});
