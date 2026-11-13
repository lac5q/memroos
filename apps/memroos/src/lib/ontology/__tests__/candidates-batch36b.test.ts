// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const ROOT = path.join(os.tmpdir(), `ontology-cand-b36b-${crypto.randomUUID()}`);
const sourceHash = `sha256:${"a".repeat(64)}`;
const policyHash = `sha256:${"b".repeat(64)}`;

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
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A')").run();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function setup() {
  const registry = await import("../registry");
  const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
  return { registry, ontology, candidates: await import("../candidates") };
}

function extraction() {
  return {
    tenantId: "tenant-a",
    spaceId: "space-a",
    sourceId: "src-b36b",
    sourceHash,
    sourceSpans: ["span-b36b"],
    extractorId: "extractor-b36b",
    extractorVersion: "1.0.0",
    candidateKind: "type" as const,
    namespace: "finance",
    proposed: { id: "finance.entity", semantics: { kind: "entity" } },
    confidenceLabel: "high" as const,
    confidenceScore: 0.9,
    actor: "operator-b36b",
  };
}

describe("ontology candidates batch36b", () => {
  it("promoteOntologyCandidate requires approved SEAL proposal/decision pair (264)", async () => {
    const { ontology, candidates } = await setup();
    const candidate = candidates.extractOntologyCandidate(db, extraction());
    candidates.decideOntologyCandidate(db, {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      decision: "approve",
      reviewerId: "operator-b36b",
      reason: "ok",
    });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    candidates.registerOntologyPolicyContext(db, {
      tenantId: candidate.tenantId,
      spaceId: candidate.spaceId,
      contextHash: policyHash,
      policyVersion: "test-b36b",
      actor: "operator-b36b",
      expiresAt,
    });
    expect(() =>
      candidates.promoteOntologyCandidate(db, {
        candidateId: candidate.id,
        tenantId: candidate.tenantId,
        spaceId: candidate.spaceId,
        sealProposalId: `missing-seal-${randomUUID()}`,
        sealDecisionId: `missing-decision-${randomUUID()}`,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        namespace: "finance",
        policyContextHash: policyHash,
        reviewerId: "operator-b36b",
        idempotencyKey: `idem-${randomUUID()}`,
        expiresAt,
      }),
    ).toThrow(/approved SEAL proposal/i);
  });
});
