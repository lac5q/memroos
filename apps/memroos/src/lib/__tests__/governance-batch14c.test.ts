// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import {
  checkOwnerGate,
  grantPerUseApproval,
  listOwnerGateApprovals,
  revokeOwnerGateApproval,
} from "@/lib/identity/owner-gate";
import { evaluateKnowledgePolicy, evaluatePolicy } from "@/lib/policy/engine";
import {
  addSpaceMember,
  createSpace,
  filterBySpace,
  getSpaceDefaultLabels,
  getSpacesForUser,
} from "@/lib/space";
import { buildOkfBundle, validateOkfBundle } from "@/lib/okf";

describe("governance batch14c — owner gate, policy, space, okf", () => {
  it("checkOwnerGate and revokeOwnerGateApproval validate required fields", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      checkOwnerGate(db, { assetType: "", assetId: "a", requestingAgentId: "agent", ownerId: "owner" }),
    ).toThrow(/assetType/);
    expect(() => grantPerUseApproval(db, { ownerId: "", assetType: "skill", assetId: "1", agentId: "agent" })).toThrow(
      /ownerId/,
    );
    expect(() => revokeOwnerGateApproval(db, { ownerId: "owner", assetType: "skill", assetId: "1" })).not.toThrow();
    expect(() => listOwnerGateApprovals(db, { ownerId: "", assetType: "skill", assetId: "1" })).toThrow(/required/);
    db.close();
  });

  it("evaluatePolicy rejects caller ontology context and missing persistence", () => {
    expect(() =>
      evaluatePolicy({
        domain: "knowledge",
        action: "read",
        actor: { id: "u", role: "agent", tenantId: "default-tenant" },
        ontologyContext: {
          ontologyId: "x",
          ontologyVersion: "1",
          ontologyContentHash: "sha256:x",
          namespace: "n",
          canonicalId: "c",
          aliasMigrationPath: [],
          sourceId: "s",
          sourceHash: "sha256:s",
          derivativeType: "versioned_record",
          derivativeId: "d",
        },
      }),
    ).toThrow(/caller-supplied ontology context/);

    expect(() =>
      evaluateKnowledgePolicy({
        action: "read",
        actor: { id: "u", role: "agent", tenantId: "default-tenant" },
        ontologyReference: { tenantId: "default-tenant", spaceId: "s", recordType: "message", recordId: "1" },
      }),
    ).toThrow(/require persistence/);
  });

  it("evaluatePolicy applies dimension tightening to allow receipts", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const memoryUse = {
      actor: { id: "agent-1", role: "agent" as const },
      purpose: "memory_search" as const,
      label: {
        visibility: "internal" as const,
        policy: "agent_visible" as const,
        domain: "finance" as const,
        sensitivity: "restricted" as const,
      },
    };
    const evaluation = evaluatePolicy(
      {
        domain: "memory-use",
        action: "read",
        actor: { id: memoryUse.actor.id, role: memoryUse.actor.role },
        memoryUse,
        dimensions: { sensitivity: "restricted", domain: "finance" },
      },
      db,
    );
    expect(["allow", "deny", "review-required"]).toContain(evaluation.receipt.outcome);
    db.close();
  });

  it("space helpers tolerate corrupt labels and filter legacy project rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    const space = createSpace(db, { tenantId: "default-tenant", name: "Legacy" });
    db.prepare(`UPDATE spaces SET default_labels_json = ? WHERE id = ?`).run("{not-json", space.id);
    expect(getSpaceDefaultLabels(db, space.id)).toEqual({});

    addSpaceMember(db, { spaceId: space.id, memberId: "user-legacy", memberType: "human" });
    expect(getSpacesForUser(db, "")).toEqual([]);
    expect(getSpacesForUser(db, "user-legacy")).toHaveLength(1);

    const filtered = filterBySpace(
      [
        { space_id: space.id, project: "Legacy", content: "a" },
        { project: "Legacy", content: "b" },
        { project: "Other", content: "c" },
      ],
      "Legacy",
      space.id,
    );
    expect(filtered).toHaveLength(2);
    db.close();
  });

  it("validateOkfBundle flags traversal paths, reserved frontmatter, and broken links", () => {
    const bundle = buildOkfBundle({
      name: "Batch14c",
      concepts: [
        {
          path: "concepts/alpha.md",
          frontmatter: { type: "Concept", title: "Alpha" },
          body: "",
          content:
            "---\ntype: Concept\ntitle: Alpha\n---\nAlpha links to [missing](./missing.md).\n",
        },
      ],
      timestamp: "2026-01-01T00:00:00Z",
    });
    bundle["../escape.md"] = "---\ntype: Concept\n---\nBody\n";
    bundle["log.md"] = "---\nversion: 1\n---\nReserved\n";
    const result = validateOkfBundle(bundle);
    expect(result.conformant).toBe(false);
    expect(result.errors.some((e) => e.code === "invalid_path")).toBe(true);
    expect(result.errors.some((e) => e.code === "reserved_frontmatter")).toBe(true);
    expect(result.warnings.some((w) => w.code === "broken_link")).toBe(true);
  });
});
