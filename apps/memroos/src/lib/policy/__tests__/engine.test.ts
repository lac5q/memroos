// @vitest-environment node
/**
 * Phase 128 (POLGOV-01/02) — Shared policy engine tests.
 *
 * HARD CONSTRAINT: decisions must match the wrapped functions BYTE-FOR-BYTE.
 * These tests deep-compare engine evaluations against the underlying
 * functions on the same inputs to enforce that invariant.
 */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AUDIT_EVENT_TYPES,
  ENTITY_TYPES,
} from "@/lib/audit/event-types";
import { initSchema } from "@/lib/db-schema";
import { authorizeMemoryUse } from "@/lib/memory/policy-gate";
import { checkDispatchPolicy } from "@/lib/security-policy";
import type { RemoteAgentConfig } from "@/types";

import { checkA2aSendPolicy, checkMemoryWritePolicy } from "@/lib/security-policy";
import type { RegisteredAgent } from "@/types";

import {
  POLICY_VERSION,
  buildReceipt,
  evaluateKnowledgePolicy,
  evaluatePolicy,
} from "../engine";

function registeredAgent(capabilities: RegisteredAgent["capabilities"] = []): RegisteredAgent {
  return {
    id: "agent-1",
    name: "Agent",
    role: "Agent",
    platform: "codex",
    protocol: "a2a",
    status: "active",
    lastHeartbeat: null,
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    location: "local",
    isRemote: false,
    latencyMs: null,
    capabilities,
    metadata: {},
    host: null,
    port: null,
    healthEndpoint: null,
    tunnelUrl: null,
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
    deregisteredAt: null,
  };
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
});

describe("policy engine — manifest", () => {
  it("exposes a non-empty policy version from the in-repo manifest", () => {
    expect(typeof POLICY_VERSION).toBe("string");
    expect(POLICY_VERSION.length).toBeGreaterThan(0);
    // Version is yyyy.mm.<phase> shaped; just assert it parses digits.
    expect(POLICY_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });
});

describe("policy engine — memory-use domain", () => {
  it("sealed label returns deny and matches authorizeMemoryUse byte-for-byte", () => {
    const memoryUse = {
      actor: { id: "agent:test", role: "agent" as const },
      purpose: "dispatch" as const,
      label: {
        visibility: "private" as const,
        domain: "legal" as const,
        sensitivity: "privileged" as const,
        policy: "sealed" as const,
      },
    };

    const evaluation = evaluatePolicy({
      domain: "memory-use",
      action: "recall.test",
      actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
      memoryUse,
    });

    const direct = authorizeMemoryUse(memoryUse);

    expect(evaluation.receipt.outcome).toBe("deny");
    expect(evaluation.receipt.ruleMatched).toBe("memsec.memory-use");
    expect(evaluation.receipt.reason).toBe("sealed_content");
    expect(evaluation.receipt.policyVersion).toBe(POLICY_VERSION);
    expect(evaluation.memoryUse).toEqual(direct);
  });

  it("requires_human_review label returns review-required outcome", () => {
    const memoryUse = {
      actor: { id: "agent:test", role: "agent" as const },
      purpose: "dispatch" as const,
      label: {
        visibility: "private" as const,
        domain: "engineering" as const,
        sensitivity: "credential" as const,
        policy: "requires_human_review" as const,
      },
    };

    const evaluation = evaluatePolicy({
      domain: "memory-use",
      action: "review.test",
      actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
      memoryUse: {
        actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
        purpose: memoryUse.purpose,
        label: memoryUse.label,
      },
    });

    expect(evaluation.receipt.outcome).toBe("review-required");
    expect(evaluation.receipt.reason).toBe("human_review_required");
    expect(evaluation.memoryUse).toEqual(authorizeMemoryUse(memoryUse));
  });

  it("receipt detail contains NO content field; only label/purpose/actorRole", () => {
    const evaluation = evaluatePolicy({
      domain: "memory-use",
      action: "detail.no-content",
      actor: { id: "agent:test", role: "agent" },
      memoryUse: {
        actor: { id: "agent:test", role: "agent" },
        purpose: "recall",
        label: { visibility: "private", policy: "sealed" },
      },
    });

    expect(evaluation.receipt.detail).toBeDefined();
    const keys = Object.keys(evaluation.receipt.detail ?? {}).sort();
    expect(keys).toEqual(["actorRole", "label", "purpose"]);
    expect(evaluation.receipt.detail).not.toHaveProperty("content");
    expect(evaluation.receipt.detail).not.toHaveProperty("text");
    expect(evaluation.receipt.detail).not.toHaveProperty("body");
    expect(evaluation.receipt.detail).not.toHaveProperty("payload");
  });
});

describe("buildReceipt", () => {
  it("collapses agent roles to system at the audit boundary", () => {
    const receipt = buildReceipt(
      {
        domain: "memory-use",
        action: "receipt.shape",
        actor: { id: "agent:test", role: "agent", tenantId: "tenant-a" },
      },
      {
        outcome: "allow",
        reason: "ok",
        ruleMatched: "memsec.memory-use",
      },
    );
    expect(receipt.actorRole).toBe("system");
    expect(receipt.tenantId).toBe("tenant-a");
    expect(receipt.policyVersion).toBe(POLICY_VERSION);
  });
});

describe("policy engine — capability domain", () => {
  const remoteTargetNoDispatch: RemoteAgentConfig = {
    id: "agent:remote-no-dispatch",
    name: "remote",
    role: "worker",
    platform: "claude",
    protocol: "a2a",
    location: "cloudflare",
    host: "example.com",
    port: 443,
    healthEndpoint: "/health",
    skills: [{ id: "summarize", name: "Summarize", description: "n/a", tags: [], inputModes: ["text"], outputModes: ["text"] }],
  };

  // Force the legacy-undeclared allowance OFF regardless of NODE_ENV /
  // MEMROOS_A2A_PROFILE so `checkDispatchPolicy` actually checks declared skills.
  const savedExplicitLegacy = process.env.MEMROOS_ALLOW_LEGACY_UNDECLARED_CAPABILITIES;

  beforeEach(() => {
    process.env.MEMROOS_ALLOW_LEGACY_UNDECLARED_CAPABILITIES = "off";
  });

  afterEach(() => {
    if (savedExplicitLegacy === undefined)
      delete process.env.MEMROOS_ALLOW_LEGACY_UNDECLARED_CAPABILITIES;
    else process.env.MEMROOS_ALLOW_LEGACY_UNDECLARED_CAPABILITIES = savedExplicitLegacy;
  });

  it("evaluates a2a-send and memory-write capabilities byte-identically to security-policy", () => {
    const agent = registeredAgent([
      { id: "a2a:send", name: "Send", description: "", tags: [] },
      { id: "memory:write:graph", name: "Graph writes", description: "", tags: [] },
    ]);

    const a2a = evaluatePolicy({
      domain: "capability",
      action: "a2a.send.test",
      actor: { id: agent.id, role: "agent" },
      capability: { kind: "a2a-send", agent },
    });
    expect(a2a.capability).toEqual(checkA2aSendPolicy(agent));
    expect(a2a.receipt.ruleMatched).toBe("capability.a2a-send");

    const write = evaluatePolicy({
      domain: "capability",
      action: "memory.write.test",
      actor: { id: agent.id, role: "agent" },
      capability: { kind: "memory-write", agent, tier: "graph" },
    });
    expect(write.capability).toEqual(checkMemoryWritePolicy(agent, "graph"));
    expect(write.receipt.ruleMatched).toBe("capability.memory-write");
  });

  it("dispatch target with no dispatch skills returns deny and matches checkDispatchPolicy", () => {
    const evaluation = evaluatePolicy({
      domain: "capability",
      action: "dispatch.test",
      actor: { id: "agent:from", role: "agent" },
      capability: {
        kind: "dispatch",
        fromAgentId: "agent:from",
        targetAgent: remoteTargetNoDispatch,
      },
    });

    const direct = checkDispatchPolicy("agent:from", remoteTargetNoDispatch);

    expect(evaluation.receipt.outcome).toBe("deny");
    expect(evaluation.receipt.ruleMatched).toBe("capability.dispatch");
    expect(evaluation.capability).toEqual(direct);
    // Sanity: the underlying decision is also a deny so the wrapper didn't
    // accidentally flip the outcome.
    expect(evaluation.capability?.allowed).toBe(false);
  });
});

describe("policy engine — receipt emission", () => {
  it("passing a db writes exactly one POLICY_DECISION audit row", () => {
    const before = (db
      .prepare("SELECT COUNT(*) as c FROM audit_entries WHERE event_type = ?")
      .get(AUDIT_EVENT_TYPES.POLICY_DECISION) as { c: number }).c;

    evaluatePolicy(
      {
        domain: "memory-use",
        action: "audit.test",
        actor: { id: "agent:test", role: "agent" },
        memoryUse: {
          actor: { id: "agent:test", role: "agent" },
          purpose: "recall",
          label: { visibility: "private", policy: "sealed" },
        },
      },
      db
    );

    const after = (db
      .prepare("SELECT COUNT(*) as c FROM audit_entries WHERE event_type = ?")
      .get(AUDIT_EVENT_TYPES.POLICY_DECISION) as { c: number }).c;

    expect(after - before).toBe(1);

    const row = db
      .prepare(
        "SELECT event_type, entity_type, actor_id, actor_role, entity_id, metadata_json FROM audit_entries WHERE event_type = ? ORDER BY rowid DESC LIMIT 1"
      )
      .get(AUDIT_EVENT_TYPES.POLICY_DECISION) as {
      event_type: string;
      entity_type: string;
      actor_id: string;
      actor_role: string;
      entity_id: string;
      metadata_json: string;
    };

    expect(row.event_type).toBe(AUDIT_EVENT_TYPES.POLICY_DECISION);
    expect(row.entity_type).toBe(ENTITY_TYPES.POLICY_DECISION);
    expect(row.entity_id).toBe("policy_decision:memory-use:audit.test");
    expect(row.actor_id).toBe("agent:test");
    // "agent" is a domain role; the audit boundary collapses it to "system".
    expect(row.actor_role).toBe("system");

    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    expect(metadata.policyVersion).toBe(POLICY_VERSION);
    expect(metadata.domain).toBe("memory-use");
    expect(metadata.ruleMatched).toBe("memsec.memory-use");
    expect(metadata.outcome).toBe("deny");
  });
});

describe("policy engine — knowledge domain (declarative pass-through)", () => {
  it("returns allow with reason knowledge_policy_delegated and no underlying result", () => {
    const evaluation = evaluateKnowledgePolicy({
      action: "knowledge.write",
      actor: { id: "agent:test", role: "agent" },
      metadata: { tenantId: "tenant-x", toolId: "mem0_write" },
    });

    expect(evaluation.receipt.outcome).toBe("allow");
    expect(evaluation.receipt.reason).toBe("knowledge_policy_delegated");
    expect(evaluation.receipt.ruleMatched).toBe("knowledge.policy-check");
    expect(evaluation.receipt.domain).toBe("knowledge");
    expect(evaluation.memoryUse).toBeUndefined();
    expect(evaluation.capability).toBeUndefined();
  });

  it("rejects caller-supplied ontology context for public knowledge policy evaluation", () => {
    expect(() => evaluateKnowledgePolicy({
      action: "knowledge.read",
      actor: { id: "agent:test", role: "agent" },
      ontologyContext: {
        ontologyId: "forged",
        ontologyVersion: "1.0.0",
        ontologyContentHash: "sha256:forged",
        namespace: "forged",
        canonicalId: "forged",
        aliasMigrationPath: [],
      },
    }, db)).toThrow("caller-supplied ontology context is not accepted");
  });

  // ---------------------------------------------------------------------
  // v8.10 round-3 (ONTO-25 follow-up) regressions
  // ---------------------------------------------------------------------

  it("resolves server-owned ontology context when caller supplies ontologyReference", async () => {
    const { ensureCanonicalUpperOntology } = await import("@/lib/ontology/registry");
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    // Seed a versioned record that resolves cleanly.
    const recordId = "knowledge-record-1";
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id,
         ontology_version, ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
       VALUES (?, ?, ?, 'knowledge', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`
    ).run(
      `versioned-${recordId}`,
      "default-tenant",
      "knowledge-space",
      recordId,
      ontology.ontologyId,
      ontology.version,
      ontology.contentHash,
      new Date().toISOString(),
      `source-${recordId}`,
      `sha256:${"b".repeat(64)}`,
    );
    db.prepare(
      `INSERT INTO ontology_source_lifecycle
        (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
       VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`
    ).run("default-tenant", "knowledge-space", `source-${recordId}`, `sha256:${"b".repeat(64)}`, new Date().toISOString());
    db.prepare(
      `INSERT INTO ontology_derivative_validity
        (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`
    ).run(`valid-${recordId}`, "default-tenant", "knowledge-space", `source-${recordId}`, `sha256:${"b".repeat(64)}`, `versioned-${recordId}`, new Date().toISOString());

    const evaluation = evaluateKnowledgePolicy({
      action: "knowledge.read",
      actor: { id: "agent:test", role: "agent", tenantId: "default-tenant" },
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "knowledge-space",
        recordType: "knowledge",
        recordId,
      },
    }, db);

    expect(evaluation.receipt.outcome).toBe("allow");
    expect(evaluation.receipt.reason).toBe("knowledge_policy_delegated");
    expect(evaluation.receipt.ontology).toMatchObject({
      ontologyId: ontology.ontologyId,
      canonicalId: "memory",
      sourceId: `source-${recordId}`,
    });
  });

  it("rejects a caller-supplied ontology hash even when ontologyReference is also supplied", async () => {
    const { ensureCanonicalUpperOntology } = await import("@/lib/ontology/registry");
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const recordId = "knowledge-record-2";
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id,
         ontology_version, ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
       VALUES (?, ?, ?, 'knowledge', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`
    ).run(
      `versioned-${recordId}`,
      "default-tenant",
      "knowledge-space-2",
      recordId,
      ontology.ontologyId,
      ontology.version,
      ontology.contentHash,
      new Date().toISOString(),
      `source-${recordId}`,
      `sha256:${"c".repeat(64)}`,
    );
    db.prepare(
      `INSERT INTO ontology_source_lifecycle
        (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
       VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`
    ).run("default-tenant", "knowledge-space-2", `source-${recordId}`, `sha256:${"c".repeat(64)}`, new Date().toISOString());
    db.prepare(
      `INSERT INTO ontology_derivative_validity
        (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`
    ).run(`valid-${recordId}`, "default-tenant", "knowledge-space-2", `source-${recordId}`, `sha256:${"c".repeat(64)}`, `versioned-${recordId}`, new Date().toISOString());

    // Even though ontologyReference is valid, the caller-supplied
    // ontologyContext (forged hash) must be rejected.
    expect(() => evaluateKnowledgePolicy({
      action: "knowledge.read",
      actor: { id: "agent:test", role: "agent", tenantId: "default-tenant" },
      ontologyContext: {
        ontologyId: "forged",
        ontologyVersion: "1.0.0",
        ontologyContentHash: "sha256:forged",
        namespace: "forged",
        canonicalId: "forged",
        aliasMigrationPath: [],
      },
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "knowledge-space-2",
        recordType: "knowledge",
        recordId,
      },
    }, db)).toThrow("caller-supplied ontology context is not accepted");
  });

  it("denies when ontologyReference is supplied but the record does not exist", () => {
    expect(() => evaluateKnowledgePolicy({
      action: "knowledge.read",
      actor: { id: "agent:test", role: "agent", tenantId: "default-tenant" },
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "knowledge-space-missing",
        recordType: "knowledge",
        recordId: "missing-record",
      },
    }, db)).toThrow(/ontology context/i);
  });

  it("emits a deny receipt (not allow) when receipt persistence fails for an ontology-sensitive knowledge decision", async () => {
    const { ensureCanonicalUpperOntology } = await import("@/lib/ontology/registry");
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const recordId = "knowledge-record-3";
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id,
         ontology_version, ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
       VALUES (?, ?, ?, 'knowledge', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`
    ).run(
      `versioned-${recordId}`,
      "default-tenant",
      "knowledge-space-3",
      recordId,
      ontology.ontologyId,
      ontology.version,
      ontology.contentHash,
      new Date().toISOString(),
      `source-${recordId}`,
      `sha256:${"d".repeat(64)}`,
    );
    db.prepare(
      `INSERT INTO ontology_source_lifecycle
        (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
       VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`
    ).run("default-tenant", "knowledge-space-3", `source-${recordId}`, `sha256:${"d".repeat(64)}`, new Date().toISOString());
    db.prepare(
      `INSERT INTO ontology_derivative_validity
        (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`
    ).run(`valid-${recordId}`, "default-tenant", "knowledge-space-3", `source-${recordId}`, `sha256:${"d".repeat(64)}`, `versioned-${recordId}`, new Date().toISOString());

    // Install a trigger that denies audit_entries inserts for POLICY_DECISION
    // to simulate a receipt-write failure.
    db.exec(`CREATE TRIGGER deny_policy_receipt_audit BEFORE INSERT ON audit_entries
      WHEN NEW.event_type = 'policy.decision' BEGIN SELECT RAISE(ABORT, 'fault-injected'); END;`);

    const evaluation = evaluateKnowledgePolicy({
      action: "knowledge.read",
      actor: { id: "agent:test", role: "agent", tenantId: "default-tenant" },
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "knowledge-space-3",
        recordType: "knowledge",
        recordId,
      },
    }, db);

    expect(evaluation.receipt.outcome).toBe("deny");
    expect(evaluation.receipt.reason).toBe("ontology_context_unavailable");

    db.exec(`DROP TRIGGER deny_policy_receipt_audit;`);
  });
});
