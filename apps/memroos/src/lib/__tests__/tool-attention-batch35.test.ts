// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  appendToolAttentionOutcome,
  getSimilarTaskRecommendations,
  getToolAttention,
} from "@/lib/tool-attention";

const TMP = path.join(os.tmpdir(), `tool-attn-b35-${randomUUID()}`);
const CATALOG = path.join(TMP, "tool-catalog.json");
const OUTCOMES = path.join(TMP, "outcomes.jsonl");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  for (const key of [
    "TOOL_ATTENTION_CATALOG",
    "TOOL_ATTENTION_OUTCOMES",
    "MEMROOS_OPTIONAL_CAPABILITIES",
    "GITNEXUS_REGISTRY",
    "APO_PROPOSALS_PATH",
    "APO_CRON_LOG_PATH",
    "HOME",
  ]) {
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
          id: "cap-b35",
          name: "batch35-cap",
          type: "workspace",
          source: "knowledge-system",
          description: "batch35 capability",
          status: "available",
          tags: ["batch35"],
          useWhen: [],
          topLevel: true,
          loadCommand: `node ${TMP}/scripts/run-b35.js`,
        },
      ],
      sources: [
        {
          id: "abs-src-b35",
          label: "Absolute source",
          type: "local-config",
          path: path.join(TMP, "nested", "catalog-b35.json"),
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

describe("tool-attention batch35 — context scoring, paths, optional capabilities", () => {
  it("scores failures and home-relative load commands (66-93, 195)", () => {
    appendToolAttentionOutcome({
      toolId: "cap-b35",
      outcome: "failure",
      timestamp: new Date().toISOString(),
      metadata: { task_type: "deploy", repo: "memroos", agent_id: "agent-b35", tags: ["batch35"] },
    } as never);
    appendToolAttentionOutcome({
      toolId: "cap-b35",
      outcome: "success",
      timestamp: new Date().toISOString(),
      metadata: { task_type: "deploy", repo: "memroos", agent_id: "agent-b35", tags: ["batch35"] },
    } as never);

    const similar = getSimilarTaskRecommendations(
      { task_type: "deploy", repo: "memroos", agent_id: "agent-b35", tags: ["batch35"] },
      5,
    );
    expect(similar.recommendations[0]?.contextScore).toBeGreaterThan(0);
    const response = getToolAttention("batch35-cap", 5);
    expect(response.capabilities[0]?.loadCommand).toContain("~/");
  });

  it("publicPath rewrites repo-relative and absolute catalog sources (153, 164)", () => {
    fs.mkdirSync(path.join(TMP, "nested"), { recursive: true });
    const response = getToolAttention("", 5);
    const abs = response.sources.find((s) => s.id === "abs-src-b35");
    expect(abs?.path).toBeTruthy();
    expect(path.isAbsolute(abs?.path ?? "")).toBe(false);
  });

  it("records outcome-only recommendations when context score is zero (123-132)", () => {
    appendToolAttentionOutcome({
      toolId: "cap-b35",
      outcome: "success",
      timestamp: new Date().toISOString(),
      metadata: { task_type: "unrelated-b35" },
    } as never);
    const similar = getSimilarTaskRecommendations({ task_type: "deploy", repo: "memroos" }, 5);
    expect(similar.recommendations[0]?.reason).toMatch(/Outcome signal present|recorded outcome/i);
  });
});
