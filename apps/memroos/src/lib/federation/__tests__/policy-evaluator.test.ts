// @vitest-environment node
/**
 * VAL-ORCH-008: per-source independent policy evaluation.
 */
import { describe, expect, it } from "vitest";
import { evaluateFederationPolicy, FEDERATION_POLICY_VERSION } from "../policy-evaluator";
import type { FederationSourceRow } from "../source-registry";

function okSource(overrides: Partial<FederationSourceRow> = {}): FederationSourceRow {
  return {
    id: "src-1",
    tenantId: "default-tenant",
    sourceHandle: "memory-alpha",
    sourceKind: "memory",
    spaceId: "space-1",
    purpose: "memory_search",
    labelPolicyJson: {},
    allowedOperations: ["search"],
    trustLevel: "registered",
    enabled: true,
    hasExpiry: false,
    expiresAt: null,
    transport: "inproc",
    descriptor: {},
    registrationHash: "sha256:0",
    lastHealthAt: null,
    createdBy: "operator-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function okContext() {
  return {
    actor: { id: "user-1", role: "agent", capability: "agent-1", tenantId: "default-tenant" },
    purpose: "memory_search" as const,
    label: { visibility: "internal", policy: "agent_visible" },
    beliefStage: "silver_candidate_claim",
    scopeHash: "sha256:scope",
  };
}

describe("VAL-ORCH-008 -- evaluateFederationPolicy", () => {
  it("allows when purpose, label, and actor match", () => {
    const r = evaluateFederationPolicy({ source: okSource(), context: okContext() });
    expect(r.kind).toBe("allow");
    if (r.kind === "allow") expect(r.policyVersion).toBe(FEDERATION_POLICY_VERSION);
  });

  it("denies on space mismatch for scoped sources", () => {
    const r = evaluateFederationPolicy({
      source: okSource({ spaceId: "space-alpha" }),
      context: {
        ...okContext(),
        actor: { ...okContext().actor, project: "space-beta" },
      },
    });
    expect(r.kind).toBe("deny");
    if (r.kind === "deny") expect(r.reason).toBe("space_mismatch");
  });

  it("denies on purpose mismatch", () => {
    const r = evaluateFederationPolicy({ source: okSource({ purpose: "memory-promotion" }), context: okContext() });
    expect(r.kind).toBe("deny");
    if (r.kind === "deny") expect(r.reason).toBe("purpose_mismatch");
  });

  it("redacts when label policy requires redaction", () => {
    const r = evaluateFederationPolicy({
      source: okSource(),
      context: { ...okContext(), label: { visibility: "internal", policy: "requires_redaction" } },
    });
    expect(r.kind).toBe("redact");
  });

  it("denies on label visibility:private", () => {
    const r = evaluateFederationPolicy({
      source: okSource(),
      context: { ...okContext(), label: { visibility: "private", policy: "agent_visible" } },
    });
    expect(r.kind).toBe("deny");
  });

  it("denies when source requires_human_review", () => {
    const r = evaluateFederationPolicy({
      source: okSource(),
      context: { ...okContext(), label: { visibility: "internal", policy: "requires_human_review" } },
    });
    expect(r.kind).toBe("review_required");
  });

  it("marks result stale when maxFreshnessSeconds exceeded", () => {
    const r = evaluateFederationPolicy({
      source: okSource(),
      context: { ...okContext(), maxFreshnessSeconds: 60 },
      candidateFreshnessSeconds: 9999,
    });
    expect(r.kind).toBe("stale");
  });

  it("does not allow one source to authorize another (per-source independence)", () => {
    // Even with a high-trust source, a separate source is evaluated independently.
    const high = okSource({ id: "src-A", sourceHandle: "A", trustLevel: "trusted" });
    const low = okSource({ id: "src-B", sourceHandle: "B", purpose: "different-purpose" });
    const a = evaluateFederationPolicy({ source: high, context: okContext() });
    const b = evaluateFederationPolicy({ source: low, context: okContext() });
    expect(a.kind).toBe("allow");
    expect(b.kind).toBe("deny");
  });
});
