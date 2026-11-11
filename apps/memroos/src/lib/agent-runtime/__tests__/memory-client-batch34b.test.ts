// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { addMemory, buildContextInjection, memoryTool, searchMemories } from "../memory-client";

const ROOT = path.join(os.tmpdir(), `memory-client-b34b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("memory-client batch34b", () => {
  it("merges duplicates with recollection metadata fields (153–160)", () => {
    const first = addMemory(ROOT, {
      content: "batch34b recall metadata merge target",
      tags: ["alpha"],
      tier: "episodic",
      beliefStage: "gold_operational_truth",
      sourceHealth: "ok",
      importance: 0.7,
      priorUsefulness: 0.4,
      authorization: "allowed",
      policyRisk: "low",
      provenance: "agent-runtime:test",
    });
    const merged = addMemory(ROOT, {
      content: "batch34b recall metadata merge target extra",
      tags: ["beta"],
      tier: "semantic",
      beliefStage: "silver_candidate_claim",
      sourceHealth: "degraded",
      importance: 0.9,
      priorUsefulness: 0.8,
      authorization: "allowlisted_cross_project",
      policyRisk: "medium",
      provenance: "agent-runtime:merge",
    });
    expect(merged.id).toBe(first.id);
    expect(merged.mergeCount).toBeGreaterThan(1);
    expect(merged.tier).toBe("semantic");
    expect(merged.policyRisk).toBe("medium");
  });

  it("filters search by threshold and injects caveat text (202–203, 252–268)", () => {
    addMemory(ROOT, { content: "unrelated telemetry export pipeline" });
    addMemory(ROOT, {
      content: "batch34b injection topic with caveat stale source",
      importance: 0.95,
      sourceHealth: "stale",
      policyRisk: "high",
    });

    const lowHits = searchMemories(ROOT, "batch34b injection topic", { limit: 3, threshold: 0.99 });
    expect(lowHits).toHaveLength(0);

    const injection = buildContextInjection(ROOT, "batch34b injection topic caveat", {
      maxChars: 2000,
      limit: 3,
      sourceRefs: ["src-1"],
      timing: "before_plan",
    });
    expect(injection.memories.length).toBeGreaterThan(0);
    expect(injection.text.length).toBeGreaterThan(0);
  });

  it("validates memoryTool branches (308–313)", () => {
    const created = addMemory(ROOT, { content: `memory tool replace ${randomUUID().slice(0, 6)}` });
    expect(memoryTool(ROOT, { action: "replace", id: created.id, content: "replaced content" }).ok).toBe(true);
    expect(memoryTool(ROOT, { action: "remove", id: created.id }).ok).toBe(true);
    expect(memoryTool(ROOT, { action: "replace", content: "missing id" } as never).ok).toBe(false);
    expect(memoryTool(ROOT, { action: "nope" as never }).ok).toBe(false);
  });
});
