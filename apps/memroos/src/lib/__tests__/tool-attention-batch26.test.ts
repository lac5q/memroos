// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSimilarTaskRecommendations, getToolAttention } from "@/lib/tool-attention";

let tempRoot: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("tool-attention batch26 — status catch paths and recommendation clamps", () => {
  it("marks root MCP source invalid when .mcp.json cannot be parsed", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-attention-b26-mcp-"));
    fs.writeFileSync(path.join(tempRoot, ".mcp.json"), "{not-json");
    fs.writeFileSync(
      path.join(tempRoot, "catalog.json"),
      JSON.stringify({ capabilities: [], sources: [] }),
    );
    fs.writeFileSync(path.join(tempRoot, "outcomes.jsonl"), "");

    vi.stubEnv("MEMROOS_ROOT", tempRoot);
    vi.stubEnv("TOOL_ATTENTION_CATALOG", path.join(tempRoot, "catalog.json"));
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", path.join(tempRoot, "outcomes.jsonl"));
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));
    vi.stubEnv("MEMROOS_OPTIONAL_CAPABILITIES", "gitnexus");
    vi.stubEnv("GITNEXUS_REGISTRY", path.join(tempRoot, "missing-registry.json"));

    const data = getToolAttention("gitnexus", 10);
    expect(data.sources.find((s) => s.id === "root-mcp-json")?.status).toBe("invalid");
    expect(data.capabilities.every((c) => c.id !== "mcp-server:gitnexus")).toBe(true);
  });

  it("clamps similar-task recommendation limit below 1 up to 1", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-attention-b26-limit-"));
    const catalogPath = path.join(tempRoot, "catalog.json");
    const outcomesPath = path.join(tempRoot, "outcomes.jsonl");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        capabilities: [
          {
            id: "skill:b26",
            name: "b26",
            type: "mcp-tool",
            source: "test",
            description: "d",
            status: "available",
            tags: [],
            useWhen: [],
            topLevel: false,
            loadCommand: null,
          },
        ],
        sources: [],
      }),
    );
    fs.writeFileSync(
      outcomesPath,
      `${JSON.stringify({
        timestamp: "2026-11-02T00:00:00.000Z",
        toolId: "skill:b26",
        outcome: "helped",
        metadata: { task_type: "coverage" },
      })}\n`,
    );

    vi.stubEnv("MEMROOS_ROOT", tempRoot);
    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", outcomesPath);
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));

    const result = getSimilarTaskRecommendations({ task_type: "coverage" }, 0);
    expect(result.recommendations.length).toBeLessThanOrEqual(1);
    expect(result.recommendations[0]?.capabilityId).toBe("skill:b26");
  });

  it("scores neutral outcomes and skips empty tool ids in recommendation rollup", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-attention-b26-neutral-"));
    const catalogPath = path.join(tempRoot, "catalog.json");
    const outcomesPath = path.join(tempRoot, "outcomes.jsonl");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        capabilities: [
          {
            id: "skill:neutral",
            name: "neutral",
            type: "mcp-tool",
            source: "test",
            description: "d",
            status: "available",
            tags: [],
            useWhen: [],
            topLevel: false,
            loadCommand: null,
          },
        ],
        sources: [],
      }),
    );
    fs.writeFileSync(
      outcomesPath,
      [
        JSON.stringify({
          timestamp: "2026-11-02T00:00:00.000Z",
          toolId: "",
          outcome: "helped",
          metadata: { task_type: "coverage" },
        }),
        JSON.stringify({
          timestamp: "2026-11-02T00:00:01.000Z",
          toolId: "skill:neutral",
          outcome: "mixed",
          metadata: { task_type: "coverage" },
        }),
      ].join("\n") + "\n",
    );

    vi.stubEnv("MEMROOS_ROOT", tempRoot);
    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", outcomesPath);
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));

    const result = getSimilarTaskRecommendations({ task_type: "coverage" }, 5);
    const rec = result.recommendations.find((item) => item.capabilityId === "skill:neutral");
    expect(rec).toBeDefined();
    expect(rec!.overallScore).toBeGreaterThan(0);
  });
});
