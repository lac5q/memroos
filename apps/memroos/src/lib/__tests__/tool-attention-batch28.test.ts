// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getToolAttention } from "@/lib/tool-attention";

let tempRoot: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("tool-attention batch28 — invalid catalog JSON and optional agent-lightning", () => {
  it("treats invalid catalog JSON as empty curated capabilities", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-att-b28-bad-catalog-"));
    const catalogPath = path.join(tempRoot, "catalog.json");
    const curated = {
      id: "curated-batch28",
      name: "curated-batch28",
      type: "mcp-tool",
      source: "curated-test",
      description: "batch28 curated entry",
      status: "available",
      tags: [],
      useWhen: [],
      topLevel: false,
      loadCommand: null,
    };
    fs.writeFileSync(catalogPath, JSON.stringify({ capabilities: [curated], sources: [] }), "utf8");
    fs.writeFileSync(path.join(tempRoot, "outcomes.jsonl"), "");

    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", path.join(tempRoot, "outcomes.jsonl"));
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));

    expect(getToolAttention("curated-batch28", 10).capabilities.some((c) => c.id === "curated-batch28")).toBe(
      true,
    );
    fs.writeFileSync(catalogPath, "{not-json", "utf8");
    expect(getToolAttention("curated-batch28", 10).capabilities.some((c) => c.id === "curated-batch28")).toBe(
      false,
    );
  });

  it("surfaces agent-lightning optional capability when env lists it", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-att-b28-apo-"));
    const catalogPath = path.join(tempRoot, "catalog.json");
    fs.writeFileSync(catalogPath, JSON.stringify({ capabilities: [], sources: [] }));
    fs.writeFileSync(path.join(tempRoot, "outcomes.jsonl"), "");

    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", path.join(tempRoot, "outcomes.jsonl"));
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));
    vi.stubEnv("MEMROOS_OPTIONAL_CAPABILITIES", "agent-lightning,not-supported");
    vi.stubEnv("APO_PROPOSALS_PATH", path.join(tempRoot, "missing-proposals"));
    vi.stubEnv("APO_CRON_LOG_PATH", path.join(tempRoot, "missing-cron.log"));

    const data = getToolAttention("agent-lightning", 10);
    expect(data.capabilities.some((c) => c.id === "capability:agent-lightning")).toBe(true);
    expect(data.sources.some((s) => s.id === "optional-capabilities")).toBe(true);
  });

  it("readOutcomes ignores corrupt jsonl lines via catch fallback", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-att-b28-outcomes-"));
    const catalogPath = path.join(tempRoot, "catalog.json");
    const outcomesPath = path.join(tempRoot, "outcomes.jsonl");
    fs.writeFileSync(catalogPath, JSON.stringify({ capabilities: [], sources: [] }));
    fs.writeFileSync(outcomesPath, "{broken-line\n", "utf8");

    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", outcomesPath);
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));

    const data = getToolAttention(undefined, 5);
    expect(data.recentOutcomes).toEqual([]);
  });
});
