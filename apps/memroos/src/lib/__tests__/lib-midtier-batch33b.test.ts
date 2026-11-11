// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { getPostBySlug } from "../blog";
import { evaluateLivePolicy } from "../retrieval-bench/adapters/live";

const TMP = path.join(os.tmpdir(), `midtier-b33b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  delete process.env.MEMROOS_HOST_ID;
});

describe("lib mid-tier batch33b", () => {
  it("getPostBySlug returns null for unknown slugs (41)", () => {
    expect(getPostBySlug(`missing-b33b-${randomUUID().slice(0, 6)}`)).toBeNull();
  });

  it("evaluateLivePolicy denies malformed candidate scope (150)", () => {
    const decision = evaluateLivePolicy({
      task: {
        id: "task-b33b",
        abstention_correct: false,
        corpus: [{ id: "c1", timestamp_iso: "2026-11-10T00:00:00.000Z", scope: { tenantId: "t" } }],
      } as never,
      scope: {
        tenantId: "t",
        userId: "u",
        agentId: "a",
        spaceId: "s",
        label: { visibility: "private", policy: "agent_visible" },
        purpose: "memory_search",
        beliefStage: "silver_candidate_claim",
        maxFreshnessSeconds: null,
      },
      candidate: {
        id: "c1",
        timestamp_iso: "2026-11-10T00:00:00.000Z",
        scope: {
          tenantId: "t",
          userId: "u",
          agentId: "a",
          spaceId: "s",
          label: { visibility: "private", policy: "agent_visible", domain: 42 },
          purpose: "memory_search",
          beliefStage: "silver_candidate_claim",
        },
      },
    });
    expect(decision).toEqual({ kind: "deny", reason: "candidate_scope_malformed" });
  });
});
