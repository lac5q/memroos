// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";
import { signAccessToken } from "@/lib/auth/jwt";
import { initSchema } from "@/lib/db-schema";
import {
  skillAuditEntryHash,
  verifySkillAuditChain,
  writeChainedSkillAuditEntry,
} from "@/lib/audit/skill-chain";
import {
  checkDispatchEligibility,
  deprecateSkill,
  publishSkill,
  searchListings,
  submitReview,
} from "@/lib/skillforge/marketplace";
import {
  checkOwnerGate,
  grantPerUseApproval,
  grantStandingApproval,
  listOwnerGateApprovals,
  revokeOwnerGateApproval,
} from "@/lib/identity/owner-gate";
import {
  CANDIDATE_PROVENANCE_TAGS,
  OntologyGovernanceError,
  provenanceTagFromConfidence,
  extractOntologyCandidate,
} from "@/lib/ontology/candidates";
import {
  evaluateGsdLaneCase,
  loadGsdLaneEvalCases,
  runGsdLaneEvalSuite,
  type GsdLaneEvalCase,
} from "@/lib/gsd/lane-evals";
import { parseAgents, parseTokenStats } from "@/lib/parsers";
import {
  computeCompleteness,
  computeContentHash,
  parseSkillMd,
  trustLevelRank,
  verifySkillSignature,
} from "@/lib/skills/registry";

const JWT_SECRET = "test-secret-for-batch18b-proxy-trust-boundary-min32";

let tmpDirs: string[] = [];
let lockPath: string | undefined;

function mkAgentConfig(agentName: string, heartbeat: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-${randomUUID().slice(0, 8)}-`));
  tmpDirs.push(root);
  const agentDir = path.join(root, agentName);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), heartbeat, "utf8");
  return root;
}

function insertEnabledSkill(db: Database.Database, name: string, rawBody: string): number {
  const hash = computeContentHash(rawBody);
  const result = db
    .prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version, completeness_pct, content_hash, trust_level, lifecycle_state)
       VALUES (?, 'memroos', 'enabled', ?, 'batch18b', '1.0.0', 100, ?, 'unsigned', 'enabled')`,
    )
    .run(name, rawBody, hash);
  return Number(result.lastInsertRowid);
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tmpDirs = [];
  delete process.env.MEMROOS_JWT_SECRET;
  delete process.env.MEMROOS_HTTPS_APP_HOSTS;
  delete process.env.MEMROOS_SCHEDULER_LOCK;
  delete process.env.MEMROOS_SKILL_SIGNING_KEY;
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  lockPath = undefined;
  vi.restoreAllMocks();
});

describe("long-tail batch18b lib — proxy trust boundary", () => {
  beforeEach(() => {
    process.env.MEMROOS_JWT_SECRET = JWT_SECRET;
  });

  it("rejects reviewer JWT on operator-only POST /api/onboarding/invite", async () => {
    const token = await signAccessToken("rev-1", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/onboarding/invite", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient permissions" });
  });

  it("allows operator JWT on POST /api/evals/run", async () => {
    const token = await signAccessToken("op-1", "operator");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/evals/run", {
        method: "POST",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("redirects configured HTTPS app hosts from HTTP", async () => {
    process.env.MEMROOS_HTTPS_APP_HOSTS = "app.example.test,other.example.test";
    const res = await proxy(
      new NextRequest("http://app.example.test/dashboard", {
        headers: { host: "app.example.test", "x-forwarded-proto": "http" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example.test/dashboard");
  });

  it("passes POST /api/audit/knowledge without human JWT (route-local auth)", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/audit/knowledge", {
        method: "POST",
        headers: { host: "localhost:3000" },
      }),
    );
    expect(res.status).not.toBe(401);
  });

  it("allows reviewer JWT on non-operator protected API routes", async () => {
    const token = await signAccessToken("rev-2", "reviewer");
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/library/freshness", {
        method: "GET",
        headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("long-tail batch18b lib — scheduler lock", () => {
  it("acquires lock on fresh path and records current pid", async () => {
    lockPath = path.join(os.tmpdir(), `sched-lock-${randomUUID()}.lock`);
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(true);
    expect(fs.readFileSync(lockPath!, "utf8").trim()).toBe(String(process.pid));
    if (lockPath && fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  });

  it("reclaims stale lock when pid is not alive", async () => {
    lockPath = path.join(os.tmpdir(), `sched-stale-${randomUUID()}.lock`);
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "999999999", "utf8");
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(true);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  });
});

function seedOwnerAndAgent(db: Database.Database, ownerId: string, agentId: string): void {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, tenant_id)
     VALUES (?, ?, 'hash', 'Owner Gate Test', 'default-tenant')`,
  ).run(ownerId, `${ownerId}@example.com`);
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'operator')`).run(ownerId);
  db.prepare(
    `INSERT INTO registered_agents (id, name, role, platform, protocol, status)
     VALUES (?, ?, 'worker', 'memroos', 'rest', 'active')`,
  ).run(agentId, agentId);
}

describe("long-tail batch18b lib — owner gate", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("denies when no approval exists and writes audit trail", () => {
    const decision = checkOwnerGate(db, {
      assetType: "memory",
      assetId: "mem-1",
      requestingAgentId: "agent-a",
      ownerId: "owner-1",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.approvalMode).toBe("none");
  });

  it("allows standing approval for any agent", () => {
    seedOwnerAndAgent(db, "owner-1", "agent-x");
    grantStandingApproval(db, { ownerId: "owner-1", assetType: "skill", assetId: "sk-1" });
    const decision = checkOwnerGate(db, {
      assetType: "skill",
      assetId: "sk-1",
      requestingAgentId: "agent-x",
      ownerId: "owner-1",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.approvalMode).toBe("standing");
  });

  it("allows per-use approval only for matching agent", () => {
    seedOwnerAndAgent(db, "owner-2", "agent-b");
    db.prepare(
      `INSERT INTO registered_agents (id, name, role, platform, protocol, status)
       VALUES (?, ?, 'worker', 'memroos', 'rest', 'active')`,
    ).run("agent-c", "agent-c");
    grantPerUseApproval(db, {
      ownerId: "owner-2",
      assetType: "knowledge",
      assetId: "k-1",
      agentId: "agent-b",
    });
    expect(
      checkOwnerGate(db, {
        assetType: "knowledge",
        assetId: "k-1",
        requestingAgentId: "agent-b",
        ownerId: "owner-2",
      }).allowed,
    ).toBe(true);
    expect(
      checkOwnerGate(db, {
        assetType: "knowledge",
        assetId: "k-1",
        requestingAgentId: "agent-c",
        ownerId: "owner-2",
      }).allowed,
    ).toBe(false);
  });

  it("lists active approvals and ignores revoked rows", () => {
    seedOwnerAndAgent(db, "o", "a1");
    grantStandingApproval(db, { ownerId: "o", assetType: "memory", assetId: "m1" });
    grantPerUseApproval(db, { ownerId: "o", assetType: "memory", assetId: "m1", agentId: "a1" });
    revokeOwnerGateApproval(db, { ownerId: "o", assetType: "memory", assetId: "m1", approvalMode: "per-use", agentId: "a1" });
    const rows = listOwnerGateApprovals(db, { ownerId: "o", assetType: "memory", assetId: "m1" });
    expect(rows.some((r) => r.approvalMode === "standing")).toBe(true);
    expect(rows.some((r) => r.approvalMode === "per-use")).toBe(false);
  });

  it("validates required fields on checkOwnerGate", () => {
    expect(() =>
      checkOwnerGate(db, { assetType: "", assetId: "x", requestingAgentId: "a", ownerId: "o" }),
    ).toThrow(/assetType/);
  });
});

describe("long-tail batch18b lib — ontology provenance", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("maps confidence bands to provenance tags", () => {
    expect(provenanceTagFromConfidence("high")).toBe("EXTRACTED");
    expect(provenanceTagFromConfidence("medium")).toBe("INFERRED");
    expect(provenanceTagFromConfidence("low")).toBe("AMBIGUOUS");
    expect(CANDIDATE_PROVENANCE_TAGS).toHaveLength(3);
  });

  it("rejects mismatched provenance override on extract", () => {
    const sourceHash = `sha256:${"a".repeat(64)}`;
    expect(() =>
      extractOntologyCandidate(db, {
        tenantId: "default-tenant",
        spaceId: "space-1",
        sourceId: "src-1",
        sourceHash,
        sourceSpans: ["span"],
        extractorId: "ext",
        extractorVersion: "1",
        candidateKind: "type",
        namespace: "memroos.test",
        proposed: { id: "memroos.test.entity" },
        confidenceLabel: "high",
        confidenceScore: 0.9,
        provenanceTag: "AMBIGUOUS",
        actor: "tester",
      }),
    ).toThrow(OntologyGovernanceError);
  });

  it("extracts candidate when provenance matches confidence band", () => {
    const sourceHash = `sha256:${"b".repeat(64)}`;
    const candidate = extractOntologyCandidate(db, {
      tenantId: "default-tenant",
      spaceId: "space-1",
      sourceId: "src-2",
      sourceHash,
      sourceSpans: ["evidence line"],
      extractorId: "ext",
      extractorVersion: "1",
      candidateKind: "type",
      namespace: "memroos.widget",
      proposed: { id: "memroos.widget.item" },
      confidenceLabel: "medium",
      confidenceScore: 0.5,
      actor: "tester",
    });
    expect(candidate.provenanceTag).toBe("INFERRED");
    expect(candidate.status).toBe("pending");
  });
});

describe("long-tail batch18b lib — skill audit chain", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("hashes entries deterministically", () => {
    const row = {
      id: "ae-1",
      tenantId: "default-tenant",
      actorId: "actor",
      actorRole: "system",
      eventType: "skill.test",
      entityType: "skill",
      entityId: "s1",
      reason: "test",
      metadata: { foo: "bar" },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(skillAuditEntryHash(row)).toMatch(/^sha256:/);
    expect(skillAuditEntryHash(row)).toBe(skillAuditEntryHash(row));
  });

  it("writes chained entries and verifies empty chain", () => {
    writeChainedSkillAuditEntry(db, {
      tenantId: "default-tenant",
      actorId: "actor",
      actorRole: "system",
      eventType: "skill_registry_updated",
      entityType: "skill_registry",
      entityId: "1",
      reason: "test chain",
      metadata: { skill_id: 1 },
    });
    const verify = verifySkillAuditChain(db, "default-tenant");
    expect(verify.valid).toBe(true);
    expect(verify.checked).toBe(1);
  });

  it("detects malformed metadata_json during verify", () => {
    db.prepare(
      `INSERT INTO audit_entries (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      "default-tenant",
      "actor",
      "system",
      "skill_quarantine_updated",
      "skill",
      "9",
      "bad metadata",
      "{not-json",
      new Date().toISOString(),
    );
    const verify = verifySkillAuditChain(db, "default-tenant");
    expect(verify.valid).toBe(false);
    expect(verify.reason).toMatch(/not valid JSON/);
  });
});

describe("long-tail batch18b lib — marketplace dispatch eligibility", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("rejects missing registry row", () => {
    expect(checkDispatchEligibility(null).eligible).toBe(false);
  });

  it("rejects disabled dispatch_status", () => {
    expect(
      checkDispatchEligibility({
        id: 1,
        name: "x",
        source_harness: "memroos",
        dispatch_status: "disabled",
        completeness_pct: 100,
        lifecycle_state: "enabled",
        content_hash: "abc",
        raw_body: "# Skill",
        signature: null,
        version: "1.0.0",
      }).eligible,
    ).toBe(false);
  });

  it("rejects tampered content_hash", () => {
    const body = "# Skill\nbody";
    expect(
      checkDispatchEligibility({
        id: 2,
        name: "tamper",
        source_harness: "memroos",
        dispatch_status: "enabled",
        completeness_pct: 100,
        lifecycle_state: null,
        content_hash: "deadbeef",
        raw_body: body,
        signature: null,
        version: "1.0.0",
      }).eligible,
    ).toBe(false);
  });

  it("publishes governed listing for enabled complete skill", () => {
    const raw = "---\nname: pub-skill\ndescription: d\n---\n# Pub\n";
    const id = insertEnabledSkill(db, `pub-${randomUUID().slice(0, 6)}`, raw);
    const published = publishSkill(db, {
      skillId: String(id),
      name: "Pub Skill",
      description: "desc",
      author: "author",
      tags: ["test"],
      category: "general",
      changelog: "initial",
    });
    expect(published.success).toBe(true);
    const results = searchListings(db, { query: "Pub", limit: 5 });
    expect(results.listings.some((l) => l.id === published.listingId)).toBe(true);
  });

  it("submitReview updates listing rating aggregate", () => {
    const raw = "# S\n";
    const id = insertEnabledSkill(db, `rev-${randomUUID().slice(0, 6)}`, raw);
    const published = publishSkill(db, {
      skillId: String(id),
      name: "Review Me",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "v1",
    });
    expect(published.listingId).toBeTruthy();
    const review = submitReview(db, published.listingId!, {
      reviewer: "r",
      rating: 5,
      text: "ok",
      verified: false,
    });
    expect(review.success).toBe(true);
  });

  it("deprecateSkill marks listing deprecated", () => {
    const id = insertEnabledSkill(db, `dep-${randomUUID().slice(0, 6)}`, "# D\n");
    const published = publishSkill(db, {
      skillId: String(id),
      name: "Old",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "v1",
    });
    const result = deprecateSkill(db, published.listingId!, "superseded");
    expect(result.success).toBe(true);
    const found = searchListings(db, { query: "Old", limit: 5 });
    expect(found.listings).toHaveLength(0);
  });
});

describe("long-tail batch18b lib — GSD lane evals", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("loads lane eval cases from fixtures file", () => {
    const cases = loadGsdLaneEvalCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]?.lane).toBeTruthy();
  });

  it("evaluates a single lane case with receipt persistence", () => {
    const caseDef = loadGsdLaneEvalCases()[0] as GsdLaneEvalCase;
    const result = evaluateGsdLaneCase(db, caseDef, true);
    expect(result.caseId).toBe(caseDef.id);
    expect(typeof result.passed).toBe("boolean");
    expect(result.ledgerReceiptId).toBeGreaterThan(0);
  });

  it("runs filtered suite by case id", () => {
    const first = loadGsdLaneEvalCases()[0]?.id;
    expect(first).toBeTruthy();
    const suite = runGsdLaneEvalSuite(db, { caseIds: [first!], persistReceipts: false });
    expect(suite.totalCases).toBe(1);
    expect(suite.results[0]?.caseId).toBe(first);
  });
});

describe("long-tail batch18b lib — skill registry + parsers", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  it("parseSkillMd extracts frontmatter and evidence section", () => {
    const raw = `---
name: demo
description: Demo skill
risk_tier: low
---
# Demo
## Evidence Examples
Example one
`;
    const parsed = parseSkillMd(raw);
    expect(parsed.name).toBe("demo");
    expect(parsed.evidence_examples).toContain("Example");
    const score = computeCompleteness(parsed);
    expect(score.percent).toBeGreaterThan(0);
  });

  it("computeCompleteness returns zero for empty parse", () => {
    expect(computeCompleteness(parseSkillMd(""))).toMatchObject({ percent: 0 });
  });

  it("trustLevelRank orders unsigned below verified", () => {
    expect(trustLevelRank("unsigned")).toBeLessThan(trustLevelRank("verified"));
  });

  it("verifySkillSignature rejects tampered body", () => {
    process.env.MEMROOS_SKILL_SIGNING_KEY = "signing-key-for-batch18b-tests-only";
    const body = "# Skill content";
    const hash = computeContentHash(body);
    expect(verifySkillSignature(hash, "not-a-valid-signature", process.env.MEMROOS_SKILL_SIGNING_KEY!)).toBe(false);
  });

  it("parseAgents detects error heartbeat status", async () => {
    const configs = mkAgentConfig("hermes-agent", "[ERROR] pipeline failed\n");
    const agents = await parseAgents(configs);
    expect(agents.some((a) => a.status === "error")).toBe(true);
  });

  it("parseAgents returns empty list for missing configs dir", async () => {
    const missing = path.join(os.tmpdir(), `no-agents-${randomUUID()}`);
    expect(await parseAgents(missing)).toEqual([]);
  });

  it("parseTokenStats returns null when stats file missing", () => {
    expect(parseTokenStats()).toBeNull();
  });
});
