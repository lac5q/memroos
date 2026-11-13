// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = path.join(os.tmpdir(), `ontology-b28d-${randomUUID()}`);
const sourceHash = `sha256:${"c".repeat(64)}`;

let db: import("better-sqlite3").Database;
let closeDb: () => void;

beforeEach(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  process.env.MEMROOS_ROOT = ROOT;
  process.env.SQLITE_DB_PATH = path.join(ROOT, "test.db");
  vi.resetModules();
  const database = await import("@/lib/db");
  db = database.getDb();
  closeDb = database.closeDb;
  const { initSchema } = await import("@/lib/db-schema");
  initSchema(db);
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b28d', 'Tenant B28D')").run();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ontology candidates + aliases batch28d", () => {
  it("provenanceTagFromConfidence maps score bands deterministically", async () => {
    const { provenanceTagFromConfidence } = await import("../candidates");
    expect(provenanceTagFromConfidence("high")).toBe("EXTRACTED");
    expect(provenanceTagFromConfidence("medium")).toBe("INFERRED");
    expect(provenanceTagFromConfidence("low")).toBe("AMBIGUOUS");
  });

  it("extractOntologyCandidate rejects mismatched provenance override", async () => {
    const { extractOntologyCandidate, OntologyGovernanceError } = await import("../candidates");
    expect(() =>
      extractOntologyCandidate(db, {
        tenantId: "tenant-b28d",
        spaceId: "space-b28d",
        sourceId: "source-b28d",
        sourceHash,
        sourceSpans: ["span:batch28d"],
        extractorId: "extractor-b28d",
        extractorVersion: "1.0.0",
        candidateKind: "type",
        namespace: "ops",
        proposed: { id: "ops.batch28d", semantics: { kind: "entity" } },
        confidenceLabel: "high",
        confidenceScore: 0.9,
        provenanceTag: "INFERRED",
        actor: "operator-b28d",
      }),
    ).toThrow(OntologyGovernanceError);
  });

  it("extractOntologyCandidate is idempotent for identical evidence", async () => {
    const { extractOntologyCandidate } = await import("../candidates");
    const input = {
      tenantId: "tenant-b28d",
      spaceId: "space-b28d",
      sourceId: "source-b28d",
      sourceHash,
      sourceSpans: ["span:idem-b28d"],
      extractorId: "extractor-b28d",
      extractorVersion: "1.0.0",
      candidateKind: "type" as const,
      namespace: "ops",
      proposed: { id: "ops.idem-b28d", semantics: { kind: "entity" } },
      confidenceLabel: "medium" as const,
      confidenceScore: 0.5,
      actor: "operator-b28d",
    };
    const first = extractOntologyCandidate(db, input);
    const second = extractOntologyCandidate(db, input);
    expect(second.id).toBe(first.id);
  });

  it("resolveOntologyAlias returns canonical id for unknown submitted type when definition exists", async () => {
    const registry = await import("../registry");
    const { resolveOntologyAlias } = await import("../aliases");
    const ontology = registry.ensureCanonicalUpperOntology(db, "operator-b28d");
    const canonicalId = ontology.definitions[0]?.id;
    if (!canonicalId) {
      expect.unreachable("canonical upper ontology should expose at least one definition");
    }
    const namespace = canonicalId.split(".")[0] ?? "entity";
    const resolved = resolveOntologyAlias(db, {
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      namespace,
      submitted: canonicalId,
    });
    expect(resolved.canonicalId).toBe(canonicalId);
    expect(resolved.aliasId).toBeNull();
  });
});
