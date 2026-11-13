// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { checkOwnerGate, grantPerUseApproval } from "@/lib/identity/owner-gate";
import { evaluatePolicy, POLICY_VERSION } from "@/lib/policy/engine";
import { detectFixedSensitiveLabels, classifyText } from "@/lib/classification/cascade";
import { checkDispatchEligibility } from "@/lib/skillforge/marketplace";

describe("long-tail batch14b — identity, policy, classification, skillforge", () => {
  it("owner gate denies unknown agents and accepts per-use grants", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id)
       VALUES ('owner-1', 'owner@test', 'Owner', 'hash', 'default-tenant')`,
    ).run();
    db.prepare(
      `INSERT INTO registered_agents (id, name, role, platform, protocol, status)
       VALUES ('agent-allowed', 'Allowed Agent', 'worker', 'codex', 'rest', 'active')`,
    ).run();
    const denied = checkOwnerGate(db, {
      assetType: "memory_write",
      assetId: "res-1",
      requestingAgentId: "agent-unknown",
      ownerId: "owner-1",
    });
    expect(denied.allowed).toBe(false);
    grantPerUseApproval(db, {
      ownerId: "owner-1",
      assetType: "memory_write",
      assetId: "res-1",
      agentId: "agent-allowed",
    });
    const allowed = checkOwnerGate(db, {
      assetType: "memory_write",
      assetId: "res-1",
      requestingAgentId: "agent-allowed",
      ownerId: "owner-1",
    });
    expect(allowed.allowed).toBe(true);
    db.close();
  });

  it("evaluatePolicy denies sealed memory-use labels", () => {
    const evaluation = evaluatePolicy({
      domain: "memory-use",
      action: "recall.test",
      actor: { id: "agent:test", role: "agent" },
      memoryUse: {
        actor: { id: "agent:test", role: "agent" },
        purpose: "dispatch",
        label: {
          visibility: "private",
          domain: "legal",
          sensitivity: "privileged",
          policy: "sealed",
        },
      },
    });
    expect(evaluation.receipt.outcome).toBe("deny");
    expect(evaluation.receipt.policyVersion).toBe(POLICY_VERSION);
  });

  it("classification cascade detects fixed provider labels and classifies text", () => {
    const fixed = detectFixedSensitiveLabels({
      content: "nothing sensitive here",
      sourceType: "message",
      metadata: { providerLabels: ["Confidential"] },
    });
    expect(fixed.matchedTokens.length).toBeGreaterThan(0);
    const classified = classifyText({
      content: "Contact john@example.com for support.",
      sourceType: "message",
      metadata: {},
    });
    expect(classified.reasonCodes.length).toBeGreaterThan(0);
  });

  it("marketplace dispatch eligibility rejects null registry rows", () => {
    expect(checkDispatchEligibility(null).eligible).toBe(false);
  });
});
