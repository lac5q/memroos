// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { knowledgeAuditEntryHash } from "@/lib/audit/knowledge-chain";
import { hashScopeIdentity, isCompleteScopeIdentity, normalizeScopeIdentity, scopeIdentityRecord } from "../scope-identity";

describe("msiq scope-identity batch31", () => {
  it("isCompleteScopeIdentity rejects malformed label and purpose (lines 116–118)", () => {
    expect(isCompleteScopeIdentity({ tenantId: "t", label: "not-record" })).toBe(false);
    expect(
      isCompleteScopeIdentity({
        tenantId: "t",
        userId: "u",
        agentId: "a",
        spaceId: "s",
        label: { visibility: "private", policy: "agent_visible" },
        purpose: 42,
        beliefStage: "silver_candidate_claim",
      }),
    ).toBe(false);
  });

  it("knowledgeAuditEntryHash stable-json handles arrays (normalizeStable line 216)", () => {
    const hash = knowledgeAuditEntryHash({
      id: `kid-b31-${randomUUID().slice(0, 8)}`,
      tenantId: "default-tenant",
      actorId: "operator-b31",
      actorRole: "operator",
      eventType: "KNOWLEDGE_ACCESS",
      entityType: "knowledge_vault",
      entityId: "vault:b31",
      reason: "read",
      metadata: { tags: ["alpha", "beta"] },
      createdAt: "2026-11-08T09:00:00.000Z",
    });
    expect(hash).toMatch(/^sha256:/);
  });

  it("scopeIdentityRecord round-trips through isCompleteScopeIdentity", () => {
    const scope = normalizeScopeIdentity({
      tenantId: "tenant-b31",
      userId: "user-b31",
      agentId: "agent-b31",
      spaceId: "space-b31",
      label: { visibility: "private", policy: "agent_visible", domain: "ops" },
      purpose: "memory_search",
      beliefStage: "silver_candidate_claim",
    });
    expect(scope).not.toBeNull();
    const record = scopeIdentityRecord(scope!);
    expect(isCompleteScopeIdentity(record)).toBe(true);
    expect(hashScopeIdentity(scope!)).toMatch(/^sha256:/);
  });
});
