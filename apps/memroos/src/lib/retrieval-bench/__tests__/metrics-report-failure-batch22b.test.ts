// @vitest-environment node
import { describe, expect, it } from "vitest";

import { validateAdapterResult } from "../failure";
import { isAnswerSupported, isLatencyAttributionReconciled, measured, unavailable } from "../metrics";
import { evaluatePublicationGate } from "../modules/report-publication";

describe("retrieval-bench metrics/report/failure batch22b", () => {
  it("isAnswerSupported rejects empty expected or retrieved text", () => {
    expect(isAnswerSupported("", "some text")).toBe(false);
    expect(isAnswerSupported("answer", "")).toBe(false);
  });

  it("latency reconciliation handles missing measurements and near matches", () => {
    expect(
      isLatencyAttributionReconciled({
        endToEndMs: 100,
        componentTimes: { retrieval: unavailable("missing") },
      }),
    ).toBe(false);
    expect(
      isLatencyAttributionReconciled({
        endToEndMs: 100,
        componentTimes: { retrieval: measured(95), rerank: measured(10) },
      }),
    ).toBe(true);
  });

  it("validateAdapterResult flags malformed adapter payloads", () => {
    const result = validateAdapterResult({
      taskId: "",
      adapterName: "",
      retrieved: "bad" as unknown as [],
      injected: [],
      ignored: [],
      latencyMs: Number.NaN,
      receipt: null,
      status: "failed",
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(3);
  });

  it("validateAdapterResult enforces live adapter scope hash and retrieved membership", () => {
    const result = validateAdapterResult({
      taskId: "t1",
      adapterName: "live",
      retrieved: [{ id: "a", authorizationResult: "allowed", scopeHash: "sha256:abc" }],
      injected: ["missing"],
      ignored: [],
      latencyMs: 12,
      receipt: { authorization: { scopeHash: null } },
      status: "ok",
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("live_injected_id_not_retrieved");
  });

  it("evaluatePublicationGate flags empty provenance string fields", () => {
    const verdict = evaluatePublicationGate({
      report: {
        taskCount: 1,
        completedTaskCount: 1,
        incompleteTaskCount: 0,
        aggregate: {},
        tasks: [],
      } as never,
      provenance: {
        configHash: "",
        fixtureHash: "sha256:abc",
        seed: 42,
        k: 5,
        providerFlags: {},
      },
      receiptVerifications: [],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.caveats.some((c) => c.startsWith("empty_provenance_field:"))).toBe(true);
  });
});
