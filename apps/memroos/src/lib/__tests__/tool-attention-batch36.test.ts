// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { appendToolAttentionOutcome, getSimilarTaskRecommendations, getToolAttention } from "@/lib/tool-attention";

const TMP = path.join(os.tmpdir(), `tool-attn-b36-${randomUUID()}`);
const CATALOG = path.join(TMP, "tool-catalog.json");
const OUTCOMES = path.join(TMP, "outcomes.jsonl");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  for (const key of ["TOOL_ATTENTION_CATALOG", "TOOL_ATTENTION_OUTCOMES", "HOME"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.TOOL_ATTENTION_CATALOG = CATALOG;
  process.env.TOOL_ATTENTION_OUTCOMES = OUTCOMES;
  process.env.HOME = TMP;
  fs.writeFileSync(
    CATALOG,
    JSON.stringify({
      capabilities: [
        {
          id: "cap-b36",
          name: "batch36-cap",
          type: "workspace",
          source: "knowledge-system",
          description: "batch36 capability",
          status: "available",
          tags: [],
          useWhen: [],
          topLevel: true,
        },
        {
          id: "cap-neutral-b36",
          name: "neutral-cap-b36",
          type: "workspace",
          source: "knowledge-system",
          description: "neutral only",
          status: "available",
          tags: [],
          useWhen: [],
          topLevel: true,
        },
      ],
      sources: [
        {
          id: "https-src-b36",
          label: "HTTPS source",
          type: "remote",
          path: "https://memroos.com/docs/tool-attention-b36",
          status: "available",
        },
      ],
    }),
    "utf8",
  );
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("tool-attention batch36", () => {
  it("publicPath preserves https URLs unchanged (154)", () => {
    const response = getToolAttention("", 5);
    const remote = response.sources.find((s) => s.id === "https-src-b36");
    expect(remote?.path).toBe("https://memroos.com/docs/tool-attention-b36");
  });

  it("skips recommendations when context and outcome scores are non-positive (120)", () => {
    appendToolAttentionOutcome({
      toolId: "cap-neutral-b36",
      outcome: "failure",
      timestamp: new Date().toISOString(),
      metadata: { task_type: "unrelated-b36" },
    } as never);
    const similar = getSimilarTaskRecommendations({ task_type: "deploy-b36" }, 5);
    expect(similar.recommendations.find((r) => r.capabilityId === "cap-neutral-b36")).toBeUndefined();
  });

  it("buildOutcomeSummaries skips blank toolId outcomes (80)", () => {
    appendToolAttentionOutcome({
      toolId: "",
      outcome: "success",
      timestamp: new Date().toISOString(),
      metadata: { task_type: "deploy" },
    } as never);
    appendToolAttentionOutcome({
      toolId: "cap-b36",
      outcome: "success",
      timestamp: new Date().toISOString(),
      metadata: { task_type: "deploy", repo: "memroos" },
    } as never);
    const similar = getSimilarTaskRecommendations({ task_type: "deploy", repo: "memroos" }, 5);
    expect(similar.recommendations[0]?.capabilityId).toBe("cap-b36");
  });
});
