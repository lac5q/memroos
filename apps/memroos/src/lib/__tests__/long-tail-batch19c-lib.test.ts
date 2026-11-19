// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { resolveFromRepoRoot } from "@/lib/paths";

const db = new Database(":memory:");
initSchema(db);

vi.mock("@/lib/db", () => ({
  getDb: () => db,
  closeDb: () => {},
}));

import { createAgentCheckpoint, resumeFromCheckpoint } from "@/lib/agent-checkpoints";
import { mem0HealthTimeoutMs, neo4jUsesQueryApi } from "@/lib/memory/backends";
import { summarizeAgentCliProcesses } from "@/lib/local-agent-runtime";
import { OBSERVE_HARNESS_PATHS, summarizeSessionJsonl } from "@/lib/observe-sidecar";
import { runSlaActions } from "@/lib/hil/sla-actions";
import {
  hashSkillContent,
  verifySkill,
  loadOrCreateOperatorKeyPair,
  signSkill,
} from "@/lib/skills/skill-signing";
import { mergeFederatedPack } from "@/lib/federation/merge";
import type { FederationSourceOutcome } from "@/lib/federation/retrieval";
import { checkOwnerGate } from "@/lib/identity/owner-gate";

let tmpDirs: string[] = [];
const SIGNING_KEY = resolveFromRepoRoot("apps/memroos/data/skill-signing-key.json");

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tmpDirs = [];
  if (fs.existsSync(SIGNING_KEY)) {
    try {
      fs.unlinkSync(SIGNING_KEY);
    } catch {
      /* ignore */
    }
  }
  delete process.env.MEM0_HEALTH_TIMEOUT_MS;
  vi.restoreAllMocks();
});

describe("long-tail batch19c lib — memory backends and agent runtime", () => {
  it("neo4jUsesQueryApi detects Aura hosts and mem0HealthTimeoutMs clamps env", () => {
    expect(neo4jUsesQueryApi("https://abcd.databases.neo4j.io")).toBe(true);
    expect(neo4jUsesQueryApi("http://localhost:7474")).toBe(false);
    process.env.MEM0_HEALTH_TIMEOUT_MS = "not-a-number";
    expect(mem0HealthTimeoutMs()).toBe(15_000);
    process.env.MEM0_HEALTH_TIMEOUT_MS = "2500";
    expect(mem0HealthTimeoutMs()).toBe(2500);
  });

  it("summarizeAgentCliProcesses deduplicates nested CLI processes", () => {
    const ps = [
      "  100   1 /usr/local/bin/claude chat",
      "  101 100 /usr/local/bin/claude tool-run",
      "  200   1 node /path/to/opencode run",
    ].join("\n");
    const summary = summarizeAgentCliProcesses(ps, "2026-10-26T00:00:00.000Z");
    expect(summary.activeCliCount).toBe(2);
    expect(summary.byPlatform.claude).toBe(1);
    expect(summary.byPlatform.opencode).toBe(1);
  });

  it("summarizeAgentCliProcesses ignores shell-wrapped desktop app processes", () => {
    const ps = [
      "  300   1 /Applications/Claude.app/Contents/MacOS/Claude",
      "  301   1 bash -c claude chat",
    ].join("\n");
    const summary = summarizeAgentCliProcesses(ps);
    expect(summary.activeCliCount).toBe(0);
  });
});

describe("long-tail batch19c lib — checkpoints, SLA, signing", () => {
  it("createAgentCheckpoint and resumeFromCheckpoint round-trip run metadata", () => {
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const created = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "codex-cli-agent",
      objective: "Batch19c checkpoint",
      completedSteps: ["plan"],
      remainingSteps: ["verify"],
      nextSafeAction: "run tests",
    });
    expect(created.runId).toBe(runId);
    const resumed = resumeFromCheckpoint(db, "default-tenant", runId);
    expect(resumed?.objective).toBe("Batch19c checkpoint");
  });

  it("runSlaActions auto-resolves expired open escalations", () => {
    const id = `esc-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hil_escalations(
         id, tenant_id, entity_type, entity_id, escalation_type,
         sla_seconds, sla_deadline, status, opened_by, created_at
       ) VALUES (?, 'default-tenant', 'task', 'ent-1', 'agent_escalate', 60, datetime('now', '-1 hour'), 'open', 'system', datetime('now'))`,
    ).run(id);
    const result = runSlaActions(db);
    expect(result.acted).toBeGreaterThanOrEqual(1);
    const row = db.prepare(`SELECT status FROM hil_escalations WHERE id = ?`).get(id) as { status: string };
    expect(["resolved", "open", "sla_breached"]).toContain(row.status);
  });

  it("skill signing verifies hashed content and loads operator keypair", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sign-b19c-${randomUUID().slice(0, 6)}-`));
    tmpDirs.push(repoRoot);
    const keyPair = loadOrCreateOperatorKeyPair(repoRoot);
    const hash = hashSkillContent("---\ntitle: Demo\n---\nBody");
    const signature = signSkill(keyPair.privateKey, hash);
    expect(verifySkill(keyPair.publicKey, hash, signature)).toBe(true);
    expect(verifySkill(keyPair.publicKey, hash, "bad-signature")).toBe(false);
  });
});

describe("long-tail batch19c lib — observe sidecar and federation merge", () => {
  it("OBSERVE_HARNESS_PATHS includes wave catalog entries", () => {
    expect(OBSERVE_HARNESS_PATHS.some((entry) => entry.harness === "codex")).toBe(true);
    expect(OBSERVE_HARNESS_PATHS.some((entry) => entry.harness === "cursor")).toBe(true);
  });

  it("summarizeSessionJsonl tolerates missing files", () => {
    const summary = summarizeSessionJsonl("/tmp/does-not-exist-b19c.jsonl");
    expect(summary.lineCount).toBe(0);
    expect(summary.summary).toBe("");
  });

  it("mergeFederatedPack dedupes duplicate canonical hashes across outcomes", () => {
    const outcome: FederationSourceOutcome = {
      outcomeId: "out-b19c",
      federationRunId: "run-b19c",
      sourceId: "src-1",
      sourceHandle: "alpha",
      sourceKind: "memory",
      outcome: "success",
      reasonCode: "ok",
      policyDecision: { kind: "allow", reason: "ok", policyVersion: "federation-v1" },
      policyVersion: "federation-v1",
      resultCount: 2,
      resultBytes: 100,
      durationMs: 1,
      requestHash: null,
      responseHash: null,
      payloadHash: null,
      scopeHash: "sha256:scope",
      metadata: {},
    };
    const itemsByOutcome = new Map([
      [
        "out-b19c",
        [
          { id: "i1", content: "dup-a", score: 0.4, canonicalHash: "sha256:dup" },
          { id: "i2", content: "dup-b", score: 0.9, canonicalHash: "sha256:dup" },
        ],
      ],
    ]);
    const merged = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-b19c",
      outcomes: [outcome],
      scopeHash: "sha256:scope",
      budget: { maxItems: 10, maxBytes: 10_000, hopCount: 1 },
      itemsByOutcome,
    });
    expect(merged.items).toHaveLength(1);
    expect(merged.packItemCount).toBe(1);
  });

  it("checkOwnerGate rejects missing requestingAgentId", () => {
    expect(() =>
      checkOwnerGate(db, {
        assetType: "memory",
        assetId: "mem-1",
        requestingAgentId: "",
        ownerId: "owner-1",
      }),
    ).toThrow(/requestingAgentId/i);
  });
});
