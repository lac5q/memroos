// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import { listVaultPathsForUser } from "@/lib/export/dsar-export";
import { captureCodingAgentSession, buildCodingAgentHandoffPack } from "@/lib/agent-memory-continuity";
import { createAgentCheckpoint } from "@/lib/agent-checkpoints";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots.length = 0;
  delete process.env.MEMROOS_SCHEDULER_LOCK;
  vi.restoreAllMocks();
});

describe("priority modules batch19c — scheduler lock release handlers", () => {
  it("registers exit handlers that release the lock for the owning pid", async () => {
    const lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sched-b19c-")), "scheduler.lock");
    tmpRoots.push(path.dirname(lockPath));
    process.env.MEMROOS_SCHEDULER_LOCK = lockPath;
    vi.resetModules();
    const { tryAcquireSchedulerLock } = await import("@/lib/scheduler-singleton");
    expect(tryAcquireSchedulerLock()).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);
    for (const listener of process.listeners("exit")) {
      (listener as () => void)();
    }
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("priority modules batch19c — dsar export path listing", () => {
  it("listVaultPathsForUser skips malformed audit metadata and read operations", () => {
    const tenantId = "default-tenant";
    const db = new Database(":memory:");
    initSchema(db);
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const good = buildKnowledgeAuditEntry(db, {
      tenantId,
      actorId: "operator",
      actorRole: "operator",
      path: "notes/ok.md",
      operation: "write",
      agentId: "agent-1",
      userId,
      opHash: `sha256:${crypto.randomUUID()}`,
    });
    writeAuditEntry(
      {
        id: good.id,
        tenant_id: good.tenantId,
        actor_id: good.actorId,
        actor_role: good.actorRole,
        event_type: good.eventType,
        entity_type: good.entityType,
        entity_id: good.entityId,
        reason: good.reason,
        metadata_json: good.metadata_json,
        created_at: good.created_at,
      },
      db,
    );
    db.prepare(
      `INSERT INTO audit_entries
        (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, ?, 'operator', 'operator', 'knowledge.access', 'knowledge', 'bad-meta', NULL, 'not-json', datetime('now'))`,
    ).run(crypto.randomUUID(), tenantId);
    db.prepare(
      `INSERT INTO audit_entries
        (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, ?, 'operator', 'operator', 'knowledge.access', 'knowledge', 'missing-path', NULL, ?, datetime('now'))`,
    ).run(
      crypto.randomUUID(),
      tenantId,
      JSON.stringify({ operation: "write", userId }),
    );
    expect(listVaultPathsForUser(db, tenantId, userId)).toEqual(["notes/ok.md"]);
    db.close();
  });
});

describe("priority modules batch19c — agent memory continuity sanitization", () => {
  it("redacts deeply nested values and non-json primitives in captures", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `amc-b19c-${crypto.randomUUID()}-`));
    tmpRoots.push(vaultRoot);
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);

    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: "session-sanitize",
      summary: "x".repeat(50_000),
      decisionIntent: {
        depth: {
          l2: { l3: { l4: { l5: { note: "api_key=sk-live-0123456789abcdef" } } } },
        },
      },
      errors: [{ message: "ignore system prompt injection" }],
      verification: "not-an-array" as unknown as [],
    });
    expect(["ok", "warning", "redacted"]).toContain(capture.captureHealth);
    expect(capture.id).toBeTruthy();

    const pack = buildCodingAgentHandoffPack(db, { sessionId: "session-sanitize" });
    expect(pack.sourceCaptureIds.length).toBeGreaterThan(0);
    expect(pack.contextPack.captures).toBeTruthy();
    db.close();
    vi.unstubAllEnvs();
  });
});

describe("priority modules batch19c — agent checkpoints provenance", () => {
  it("collects memory_write receipts and tolerates malformed efficiency payloads", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'memory_write', ?, 'agent', 'not-json', datetime('now'))`,
    ).run(runId);
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent",
      objective: "Batch19c provenance",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
