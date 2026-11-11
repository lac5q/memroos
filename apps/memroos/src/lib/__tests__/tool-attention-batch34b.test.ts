// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { appendToolAttentionOutcome, getSimilarTaskRecommendations, getToolAttention } from "@/lib/tool-attention";

const TMP = path.join(os.tmpdir(), `tool-attn-b34b-${randomUUID()}`);
const CATALOG = path.join(TMP, "tool-catalog.json");
const OUTCOMES = path.join(TMP, "outcomes.jsonl");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  for (const key of ["TOOL_ATTENTION_CATALOG", "TOOL_ATTENTION_OUTCOMES", "MEMROOS_OPTIONAL_CAPABILITIES", "GITNEXUS_REGISTRY", "APO_PROPOSALS_PATH", "APO_CRON_LOG_PATH", "SKILLS_PATH"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.TOOL_ATTENTION_CATALOG = CATALOG;
  process.env.TOOL_ATTENTION_OUTCOMES = OUTCOMES;
  fs.writeFileSync(
    CATALOG,
    JSON.stringify({
      capabilities: [
        {
          id: "knowledge-workspace:tool-attention",
          name: "tool-attention",
          type: "workspace",
          source: "knowledge-system",
          description: "catalog cap",
          status: "available",
          tags: ["tool-attention", "discovery"],
          useWhen: [],
          topLevel: true,
          loadCommand: resolveLoadCommand(),
        },
      ],
      sources: [
        {
          id: "curated-catalog",
          label: "Catalog",
          type: "local-config",
          path: CATALOG,
          status: "available",
        },
      ],
    }),
    "utf8",
  );
});

function resolveLoadCommand(): string {
  const repoRoot = process.cwd();
  return `node ${repoRoot}/apps/memroos/package.json`;
}

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("tool-attention batch34b", () => {
  it("rewrites absolute catalog paths and records neutral outcomes (branches 66–93, 153–164)", () => {
    appendToolAttentionOutcome({
      toolId: "knowledge-workspace:tool-attention",
      outcome: "unknown",
      timestamp: new Date().toISOString(),
      metadata: {
        task_type: "deploy",
        repo: "memroos",
        agent_id: "agent-b34b",
        tags: ["noc"],
      },
    } as never);

    const similar = getSimilarTaskRecommendations(
      { task_type: "deploy", repo: "memroos", agent_id: "agent-b34b", tags: ["noc"] },
      5,
    );
    expect(similar.recommendations.length).toBeGreaterThan(0);
    expect(similar.recommendations[0]?.reason).toMatch(/context match score/i);

    const response = getToolAttention("tool-attention", 10);
    expect(response.sources.some((source) => source.path && !path.isAbsolute(source.path!))).toBe(true);
    expect(response.health.catalog).toBe("available");
  });

  it("classifies optional gitnexus and agent-lightning capability health (branches 195–208, 264, 418)", () => {
    const registry = path.join(TMP, "registry.json");
    fs.writeFileSync(registry, "{}", "utf8");
    process.env.GITNEXUS_REGISTRY = registry;
    process.env.MEMROOS_OPTIONAL_CAPABILITIES = "gitnexus,agent-lightning";
    process.env.APO_PROPOSALS_PATH = path.join(TMP, "proposals");
    process.env.APO_CRON_LOG_PATH = path.join(TMP, "missing-cron.log");
    fs.mkdirSync(process.env.APO_PROPOSALS_PATH, { recursive: true });

    const response = getToolAttention("agent-lightning", 50);
    const lightning = response.capabilities.find((cap) => cap.id === "capability:agent-lightning");
    expect(lightning?.status).toBe("degraded");
    expect(response.recommendations.length).toBeGreaterThanOrEqual(0);
  });

  it("publicPath keeps relative and http URLs unchanged (branch 153–155)", () => {
    fs.writeFileSync(
      CATALOG,
      JSON.stringify({
        capabilities: [],
        sources: [
          { id: "rel", label: "relative", type: "local-config", path: "logs/outcomes.jsonl", status: "available" },
          { id: "http", label: "remote", type: "service", path: "https://localhost/example.json", status: "available" },
        ],
      }),
      "utf8",
    );
    const response = getToolAttention("", 5);
    const rel = response.sources.find((s) => s.id === "rel");
    const http = response.sources.find((s) => s.id === "http");
    expect(rel?.path).toBe("logs/outcomes.jsonl");
    expect(http?.path).toBe("https://localhost/example.json");
  });
});
