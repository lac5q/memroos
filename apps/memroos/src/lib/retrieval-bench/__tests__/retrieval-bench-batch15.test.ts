// @vitest-environment node
import crypto from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyFailure,
  checkProviderConfig,
  downgradeToFailure,
  summarizeFailures,
  validateAdapterResult,
} from "../failure";
import type { AdapterResult } from "../schema";
import {
  getBenchAuditSink,
  recordBenchRun,
  resetBenchAuditSink,
  setBenchAuditSink,
} from "../modules/audit-chain";
import { applyProviderGovernanceGate } from "../modules/provider-credentials";

afterEach(() => {
  resetBenchAuditSink();
  vi.restoreAllMocks();
});

describe("retrieval-bench batch15 — failure, audit-chain, provider gate", () => {
  it("classifyFailure handles null, Error variants, and non-error throws", () => {
    expect(classifyFailure(null).reasonCode).toBe("unknown_error");
    expect(classifyFailure(new Error("ETIMEDOUT waiting")).status).toBe("provider_timeout");
    expect(classifyFailure(new Error("invalid_json payload")).status).toBe("malformed_response");
    expect(classifyFailure(new Error("boom")).status).toBe("provider_failed");
    expect(classifyFailure("plain-string").reasonCode).toBe("non_error_throw");
  });

  it("checkProviderConfig fails closed on missing provider name and credentials", () => {
    expect(checkProviderConfig({ provider: "", envValue: "x" }).status).toBe("configuration_error");
    expect(checkProviderConfig({ provider: "openai", envValue: "" }).status).toBe("credential_missing");
    expect(checkProviderConfig({ provider: "openai", envValue: "sk-test" }).ok).toBe(true);
  });

  it("validateAdapterResult flags malformed live adapter injections and scope mismatches", () => {
    const base: AdapterResult = {
      taskId: "t1",
      adapterName: "live",
      status: "ok",
      retrieved: [
        {
          id: "m1",
          text: "hello",
          tier: "vector-local",
          source: "fixture",
          score: 1,
          rankPosition: 1,
          scopeHash: "sha256:scope-a",
          authorizationResult: "allowed",
        },
      ],
      injected: ["m2"],
      ignored: [],
      latencyMs: 12,
      receipt: { authorization: { scopeHash: "sha256:scope-a" } },
    } as AdapterResult;
    expect(validateAdapterResult({ ...base, taskId: "" }).ok).toBe(false);
    expect(validateAdapterResult({ ...base, status: "provider_failed", injected: ["m1"] }).reasons).toContain(
      "non_ok_status_with_injections",
    );
    expect(validateAdapterResult(base).reasons).toContain("live_injected_id_not_retrieved");

    const scoped = {
      ...base,
      injected: ["m1"],
      retrieved: [{ ...base.retrieved[0], scopeHash: "sha256:other" }],
    } as AdapterResult;
    expect(validateAdapterResult(scoped).reasons).toContain("live_retrieval_scope_mismatch");
  });

  it("summarizeFailures and downgradeToFailure discard partial injections", () => {
    const summary = summarizeFailures([
      { status: "ok", taskId: "a", adapterName: "x", retrieved: [], injected: [], ignored: [], latencyMs: 1, receipt: {} },
      {
        status: "provider_failed",
        statusDetail: "timeout",
        taskId: "b",
        adapterName: "x",
        retrieved: [],
        injected: [],
        ignored: [],
        latencyMs: 1,
        receipt: {},
      },
    ] as AdapterResult[]);
    expect(summary.failedTaskCount).toBe(1);
    expect(summary.byReason.timeout).toBe(1);

    const downgraded = downgradeToFailure({
      task: { id: "task-1" } as never,
      partial: {
        taskId: "task-1",
        adapterName: "live",
        status: "ok",
        retrieved: [],
        injected: ["m1"],
        ignored: [],
        latencyMs: 3,
        receipt: { status: "ok" },
      } as AdapterResult,
      classification: classifyFailure(new Error("timeout")),
    });
    expect(downgraded.injected).toEqual([]);
    expect(downgraded.ignored.some((i) => i.id === "m1")).toBe(true);
  });

  it("audit-chain sink getters and sink throw path", () => {
    expect(getBenchAuditSink()).toBeNull();
    const sink = vi.fn(() => ({ ok: true as const, status: "persisted_via_test_sink" as const }));
    setBenchAuditSink(sink);
    expect(getBenchAuditSink()).toBe(sink);
    const ok = recordBenchRun({ runId: `run-${crypto.randomUUID()}`, skipWrite: false });
    expect(ok.ok).toBe(true);

    resetBenchAuditSink();
    setBenchAuditSink(() => {
      throw new Error("sink exploded");
    });
    const failed = recordBenchRun({ runId: `run-${crypto.randomUUID()}`, skipWrite: false });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toContain("sink exploded");
  });

  it("applyProviderGovernanceGate denies cross tenant/label, stale, malformed, and low trust", () => {
    const nowIso = "2026-06-01T12:00:00.000Z";
    const decision = applyProviderGovernanceGate({
      items: [
        { id: "a", score: 1, text: "x", tier: "vector", tenantId: "other-tenant" },
        { id: "b", score: 1, text: "x", tier: "vector", label: "secret", tenantId: "default-tenant" },
        { id: "c", score: 1, text: "x", tier: "vector", timestamp_iso: "not-a-date", tenantId: "default-tenant" },
        {
          id: "d",
          score: 1,
          text: "x",
          tier: "vector",
          timestamp_iso: "2026-01-01T00:00:00.000Z",
          tenantId: "default-tenant",
        },
        { id: "e", score: 1, text: "x", tier: "vector", providerTrust: 0.1, tenantId: "default-tenant" },
        { id: "f", score: 1, text: "x", tier: "vector", providerTrust: 0.9, tenantId: "default-tenant" },
      ],
      scope: { tenantId: "default-tenant", label: "internal", maxFreshnessSeconds: 3600, nowIso },
      providerTrustFloor: 0.5,
    });
    expect(decision.denied.map((d) => d.reason)).toEqual([
      "cross_tenant",
      "cross_label",
      "malformed_timestamp",
      "stale",
      "sub_floor_trust",
    ]);
    expect(decision.items).toHaveLength(1);
    expect(decision.items[0]?.id).toBe("f");
  });
});
