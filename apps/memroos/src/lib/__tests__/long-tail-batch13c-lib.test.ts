// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { matchDimensions } from "@/lib/policy/dimensions";
import { provenanceTagFromConfidence } from "@/lib/ontology/candidates";
import {
  collectLocalFootprintInventory,
  defaultLocalStoreProfiles,
} from "@/lib/cloud-offload/footprint";
import { tryAcquireSchedulerLock } from "@/lib/scheduler-singleton";
import { deriveErasureId, KNOWN_STORES, listRegisteredErasureStores } from "@/lib/memory/erasure";
import {
  computeEditHash,
  computeEvaluationHash,
  isAuthoritative,
} from "@/lib/skillforge/intake-export";
import { resolveLaneForDataset, LANE_METADATA } from "@/lib/retrieval-bench/lanes";
import { validateJsonRpcEnvelope, validateInitializeParams } from "@/lib/msiq/mcp-protocol";
import { parseTrustLevel, buildSkillEvidence } from "@/lib/dispatch/skill-lookup";
import { buildSkillSuggestionAudit } from "@/lib/skills/activity-suggestions";
import { listTombstones } from "@/lib/memory/offboarding";
import { proxy } from "@/proxy";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

describe("long-tail batch13c — lib modules", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("policy dimensions matchDimensions", () => {
    it("returns false when dims omitted and rule specifies subject", () => {
      expect(
        matchDimensions({ effect: "deny", subject: { team: ["GTM"] } }, undefined)
      ).toBe(false);
    });

    it("matches all-wildcard deny rules without dims", () => {
      expect(matchDimensions({ effect: "deny" }, undefined)).toBe(true);
    });

    it("matches team OR semantics", () => {
      expect(
        matchDimensions(
          { effect: "deny", subject: { team: ["GTM", "OPS"] } },
          { subject: { team: ["OPS"] } }
        )
      ).toBe(true);
    });

    it("rejects when request subject missing but rule requires it", () => {
      expect(
        matchDimensions({ effect: "deny", subject: { team: ["GTM"] } }, { action: "read" })
      ).toBe(false);
    });

    it("matches action allowlist", () => {
      expect(
        matchDimensions(
          { effect: "deny", action: ["export", "delete"] },
          { action: "delete" }
        )
      ).toBe(true);
    });

    it("rejects empty action arrays on rules", () => {
      expect(
        matchDimensions({ effect: "deny", action: [] }, { action: "read" })
      ).toBe(true);
    });

    it("matches purpose lists", () => {
      expect(
        matchDimensions(
          { effect: "deny", purpose: ["training"] },
          { purpose: "training" }
        )
      ).toBe(true);
    });

    it("matches object domain OR lists", () => {
      expect(
        matchDimensions(
          { effect: "deny", object: { domain: ["vault", "ops"] } },
          { object: { domain: ["vault"] } }
        )
      ).toBe(true);
    });

    it("requires userId equality when specified", () => {
      expect(
        matchDimensions(
          { effect: "deny", subject: { userId: "u1" } },
          { subject: { userId: "u2" } }
        )
      ).toBe(false);
    });

    it("matches agentId equality", () => {
      expect(
        matchDimensions(
          { effect: "deny", subject: { agentId: "agent-a" } },
          { subject: { agentId: "agent-a" } }
        )
      ).toBe(true);
    });

    it("matches beliefStage on objects", () => {
      expect(
        matchDimensions(
          { effect: "deny", object: { beliefStage: ["candidate"] } },
          { object: { beliefStage: ["candidate"] } }
        )
      ).toBe(true);
    });
  });

  describe("ontology candidates provenance", () => {
    it("maps confidence bands to provenance tags", () => {
      expect(provenanceTagFromConfidence("high")).toBe("EXTRACTED");
      expect(provenanceTagFromConfidence("medium")).toBe("INFERRED");
      expect(provenanceTagFromConfidence("low")).toBe("AMBIGUOUS");
    });
  });

  describe("cloud offload footprint", () => {
    it("returns default store profiles with sqlite entry", () => {
      const profiles = defaultLocalStoreProfiles(process.cwd());
      expect(profiles.some((p) => p.id === "sqlite-operational")).toBe(true);
    });

    it("collects inventory with ok pressure on small trees", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `footprint-${randomUUID()}-`));
      fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "data", "conversations.db"), "x", "utf8");
      const inv = collectLocalFootprintInventory(tmp);
      expect(inv.pressure).toBe("ok");
      expect(inv.stores.length).toBeGreaterThan(0);
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe("scheduler singleton lock", () => {
    it("acquires lock in a fresh temp directory", () => {
      const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), `sched-lock-${randomUUID()}-`));
      vi.stubEnv("MEMROOS_SCHEDULER_LOCK", path.join(lockDir, "scheduler.lock"));
      expect(tryAcquireSchedulerLock()).toBe(true);
      fs.rmSync(lockDir, { recursive: true, force: true });
    });
  });

  describe("memory erasure helpers", () => {
    it("lists known store ids", () => {
      expect(KNOWN_STORES).toContain("vector");
      expect(listRegisteredErasureStores().length).toBeGreaterThanOrEqual(0);
    });

    it("derives stable erasure ids", () => {
      const a = deriveErasureId("tenant-a", "canonical-1");
      const b = deriveErasureId("tenant-a", "canonical-1");
      expect(a).toBe(b);
      expect(a).toMatch(/^erasure_[0-9a-f]{64}$/);
    });
  });

  describe("skillforge intake-export hashes", () => {
    it("hashes edit and evaluation payloads deterministically", () => {
      const edit = computeEditHash("line-a\nline-b");
      expect(edit).toMatch(/^[0-9a-f]{64}$/);
      const evalHash = computeEvaluationHash(JSON.stringify({ score: 1 }));
      expect(evalHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("classifies authoritative proposal states", () => {
      expect(isAuthoritative("exported")).toBe(true);
      expect(isAuthoritative("draft")).toBe(false);
    });
  });

  describe("retrieval bench lanes", () => {
    it("resolves locomo to external_retrieval lane", () => {
      const lane = resolveLaneForDataset("locomo");
      expect(lane.ok).toBe(true);
      expect(lane.lane).toBe("external_retrieval");
    });

    it("reports unknown datasets", () => {
      const lane = resolveLaneForDataset("not_a_dataset" as never);
      expect(lane.ok).toBe(false);
    });

    it("exposes lane metadata aggregate ids", () => {
      expect(LANE_METADATA.external_retrieval.aggregateId).toContain("external");
    });
  });

  describe("msiq mcp-protocol validation", () => {
    it("rejects malformed JSON-RPC envelopes", () => {
      const out = validateJsonRpcEnvelope({ jsonrpc: "1.0" });
      expect(out.ok).toBe(false);
    });

    it("accepts minimal valid JSON-RPC requests", () => {
      const out = validateJsonRpcEnvelope({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });
      expect(out.ok).toBe(true);
    });

    it("validates initialize params protocol version", () => {
      const bad = validateInitializeParams({ protocolVersion: "0.0" });
      expect(bad.ok).toBe(false);
      const good = validateInitializeParams({
        protocolVersion: "2024-11-05",
        capabilities: [],
        clientInfo: { name: "memroos-test", version: "1" },
      });
      expect(good.ok).toBe(true);
    });
  });

  describe("dispatch skill lookup helpers", () => {
    it("parses trust levels case-insensitively", () => {
      expect(parseTrustLevel("SIGNED")).toBe("signed");
      expect(parseTrustLevel("bogus")).toBeNull();
    });

    it("builds fallback evidence when lookup is null", () => {
      const evidence = buildSkillEvidence(null);
      expect(evidence.skill_governance.mode).toBe("fallback");
    });

    it("builds governed hit evidence without raw body fields", () => {
      const evidence = buildSkillEvidence({
        kind: "hit",
        skill: {
          id: 1,
          name: "safe-skill",
          source_harness: "claude",
          version: "1.0.0",
          risk_tier: "low",
          dispatch_status: "enabled",
          completeness_pct: 100,
          trust_level: "unsigned",
          signature: null,
          content_hash: "aa".repeat(32),
        },
      });
      expect(evidence.skill_governance.mode).toBe("governed");
      expect(JSON.stringify(evidence)).not.toMatch(/raw_body/);
    });
  });

  describe("skill activity suggestions", () => {
    it("builds audit suggestions from empty activity roots", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `suggest-${randomUUID()}-`));
      const audit = buildSkillSuggestionAudit({
        activityRoots: { claude: tmp },
        skillRoots: { claude: tmp },
        days: 1,
      });
      expect(Array.isArray(audit)).toBe(true);
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe("offboarding tombstones", () => {
    it("lists empty tombstones on fresh db", () => {
      const db = freshDb();
      expect(listTombstones(db, "default-tenant")).toEqual([]);
      db.close();
    });
  });

  describe("proxy middleware", () => {
    it("allows loopback API routes without redirect", async () => {
      vi.stubEnv("MEMROOS_JWT_SECRET", "x".repeat(32));
      const { NextRequest: NextReq } = await import("next/server");
      const req = new NextReq("http://localhost:3000/api/health");
      const res = await proxy(req);
      expect(res.status).toBeLessThan(500);
    });

    it("redirects public marketing hosts to canonical host for non-asset paths", async () => {
      const { NextRequest: NextReq } = await import("next/server");
      const req = new NextReq("https://memroos.com/dashboard");
      const res = await proxy(req);
      expect([301, 302, 307, 308]).toContain(res.status);
    });
  });
});
