// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

vi.mock("../policies/manifest.json", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../policies/manifest.json")>();
  return {
    default: {
      ...actual.default,
      rules: [
        ...actual.default.rules,
        {
          id: "wrong-effect-b29e",
          domain: "memory-use",
          description: "non-deny effect skipped in loop",
          implementation: "memsec.memory-use",
          dimensions: {
            subject: { team: ["GTM"] },
            effect: "allow" as unknown as "deny",
          },
        },
        {
          id: "no-match-team-b29e",
          domain: "memory-use",
          description: "deny rule that does not match request team",
          implementation: "memsec.memory-use",
          dimensions: {
            subject: { team: ["OTHER"] },
            effect: "deny",
          },
        },
      ],
    },
  };
});

import { evaluatePolicy } from "../engine";
import * as receiptModule from "../receipt";

describe("policy engine batch29e — emit branches + applyDimensionTightening", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("memory-use with ontologyReference uses emitRequiredPolicyReceipt (lines 541–542)", async () => {
    const requiredSpy = vi.spyOn(receiptModule, "emitRequiredPolicyReceipt").mockImplementation(() => {});
    const bestSpy = vi.spyOn(receiptModule, "emitPolicyReceipt").mockImplementation(() => {});

    const registry = await import("@/lib/ontology/registry");
    const ontology = registry.ensureCanonicalUpperOntology(db, "operator");

    const tenantId = "tenant-b29e";
    const spaceId = `space-b29e-${crypto.randomUUID().slice(0, 8)}`;
    const recordId = `rec-b29e-${crypto.randomUUID().slice(0, 8)}`;
    const sourceId = `src-b29e-${crypto.randomUUID().slice(0, 8)}`;
    const sourceHash = `sha256:${"a".repeat(64)}`;
    const now = new Date().toISOString();

    const vrId = `vr-b29e-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
       VALUES (?, ?, ?, 'knowledge', ?, 'batch.type', ?, ?, ?, NULL, '[]', ?, ?, ?)`,
    ).run(vrId, tenantId, spaceId, recordId, ontology.ontologyId, ontology.version, ontology.contentHash, now, sourceId, sourceHash);

    db.prepare(
      `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
       VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`,
    ).run(tenantId, spaceId, sourceId, sourceHash, now);

    const derivId = `deriv-b29e-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
    ).run(derivId, tenantId, spaceId, sourceId, sourceHash, vrId, now);

    evaluatePolicy(
      {
        domain: "memory-use",
        action: "memory.read",
        actor: { id: "u1", role: "operator", tenantId },
        ontologyReference: {
          tenantId,
          spaceId,
          recordType: "knowledge",
          recordId,
        },
        memoryUse: {
          actor: { id: "agent:growth", role: "agent" },
          purpose: "recall",
          label: {
            visibility: "internal",
            domain: "general",
            sensitivity: "standard",
            policy: "agent_visible",
          },
        },
      },
      db,
    );

    expect(requiredSpy).toHaveBeenCalled();
    expect(bestSpy).not.toHaveBeenCalled();
  });

  it("applyDimensionTightening skips when dimensions undefined (567) and short-circuits deny (569)", () => {
    const memoryUse = {
      actor: { id: "agent:gtm", role: "agent" as const },
      purpose: "export" as const,
      label: {
        visibility: "internal" as const,
        domain: "client" as const,
        sensitivity: "privileged" as const,
        policy: "agent_visible" as const,
      },
    };
    const withDims = evaluatePolicy({
      domain: "memory-use",
      action: "export.client",
      actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
      memoryUse,
      dimensions: {
        subject: { team: ["GTM"] },
        object: { domain: ["client"], sensitivity: ["privileged"] },
        purpose: "export",
      },
    });
    expect(withDims.receipt.outcome).toBe("deny");

    const noDims = evaluatePolicy({
      domain: "memory-use",
      action: "export.client",
      actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
      memoryUse,
    });
    expect(noDims.receipt.outcome).not.toBe("deny");
  });

  it("dimension for-loop continues past wrong effect and non-matching dimensions (576–577)", () => {
    const memoryUse = {
      actor: { id: "agent:noop", role: "agent" as const },
      purpose: "recall" as const,
      label: {
        visibility: "internal" as const,
        domain: "general" as const,
        sensitivity: "standard" as const,
        policy: "agent_visible" as const,
      },
    };
    const out = evaluatePolicy({
      domain: "memory-use",
      action: "memory.read",
      actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
      memoryUse,
      dimensions: { subject: { team: ["GTM"] } },
    });
    expect(out.receipt.outcome).not.toBe("deny");
  });
});
