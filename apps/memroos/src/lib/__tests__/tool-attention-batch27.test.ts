// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSimilarTaskRecommendations, getToolAttention } from "@/lib/tool-attention";

let tempRoot: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("tool-attention batch27 — gitnexus catch, agent-lightning degraded, sort, publicPath", () => {
  it("gitnexusStatus treats invalid root MCP JSON as missing gitnexus server flag", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-att-b27-mcp-"));
    const registryPath = path.join(tempRoot, "gitnexus-registry.json");
    fs.writeFileSync(registryPath, JSON.stringify({ ok: true }));
    fs.writeFileSync(path.join(tempRoot, ".mcp.json"), "{broken");
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
    vi.stubEnv("GITNEXUS_REGISTRY", registryPath);

    const data = getToolAttention("gitnexus", 10);
    expect(data.sources.find((s) => s.id === "root-mcp-json")?.status).toBe("invalid");
  });

  it("agentLightningStatus returns degraded when only the worker script exists", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-att-b27-apo-"));
    const catalogPath = path.join(tempRoot, "catalog.json");
    fs.writeFileSync(catalogPath, JSON.stringify({ capabilities: [], sources: [] }));
    fs.writeFileSync(path.join(tempRoot, "outcomes.jsonl"), "");

    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", path.join(tempRoot, "outcomes.jsonl"));
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));
    vi.stubEnv("MEMROOS_OPTIONAL_CAPABILITIES", "agent-lightning");
    vi.stubEnv("APO_PROPOSALS_PATH", path.join(tempRoot, "missing-proposals"));
    vi.stubEnv("APO_CRON_LOG_PATH", path.join(tempRoot, "missing-cron.log"));

    const data = getToolAttention("agent-lightning", 10);
    const cap = data.capabilities.find((c) => c.id === "capability:agent-lightning");
    expect(cap?.status).toBe("degraded");
  });

  it("sorts similar-task recommendations by overallScore descending", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-att-b27-sort-"));
    const catalogPath = path.join(tempRoot, "catalog.json");
    const outcomesPath = path.join(tempRoot, "outcomes.jsonl");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        capabilities: [
          {
            id: "skill:low",
            name: "low",
            type: "mcp-tool",
            source: "test",
            description: "d",
            status: "available",
            tags: [],
            useWhen: [],
            topLevel: false,
            loadCommand: null,
          },
          {
            id: "skill:high",
            name: "high",
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
          timestamp: "2026-11-03T00:00:00.000Z",
          toolId: "skill:low",
          outcome: "mixed",
          metadata: { task_type: "batch27" },
        }),
        JSON.stringify({
          timestamp: "2026-11-03T00:00:01.000Z",
          toolId: "skill:high",
          outcome: "helped",
          metadata: { task_type: "batch27" },
        }),
      ].join("\n") + "\n",
    );

    vi.stubEnv("MEMROOS_ROOT", tempRoot);
    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", outcomesPath);
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));

    const result = getSimilarTaskRecommendations({ task_type: "batch27" }, 5);
    expect(result.recommendations[0]?.capabilityId).toBe("skill:high");
    expect(result.recommendations[0]!.overallScore).toBeGreaterThan(result.recommendations[1]!.overallScore);
  });
});
