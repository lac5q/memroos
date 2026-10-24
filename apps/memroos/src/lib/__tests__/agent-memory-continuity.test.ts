// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureCodingAgentSession, buildCodingAgentHandoffPack } from "@/lib/agent-memory-continuity";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;
let vaultRoot: string;

describe("coding-agent memory continuity", () => {
  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memroos-agent-memory-"));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("captures a coding-agent session into the raw vault and durable memory candidates", () => {
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      project: "memroos",
      repoPath: "/repo/memroos",
      sessionId: "session-1",
      taskId: "task-1",
      modelRoute: { provider: "openai", model: "gpt-5-codex" },
      summary: "Implemented the session handoff route and tests.",
      decisionIntent: {
        decision: "Keep AgentMemory behavior inside MemRoOS",
        intent: "Let Luis switch coding agents without reconstructing task state.",
      },
      files: [{ path: "apps/memroos/src/lib/agent-memory-continuity.ts", action: "added" }],
      commands: ["npm --prefix apps/memroos run test -- agent-memory-continuity"],
      sources: [{ path: ".planning/REQUIREMENTS.md", requirement: "AGENTMEM-FOLLOWUP-01" }],
      verification: [{ command: "vitest", status: "passed" }],
    });

    expect(capture.duplicate).toBe(false);
    expect(capture.captureHealth).toBe("ok");
    expect(capture.rawArtifactId).toBeTruthy();

    const raw = db.prepare("SELECT source_type, replay_metadata FROM raw_artifacts WHERE id = ?").get(capture.rawArtifactId) as
      | { source_type: string; replay_metadata: string }
      | undefined;
    expect(raw?.source_type).toBe("coding_agent_session");
    expect(JSON.parse(raw?.replay_metadata ?? "{}")).toMatchObject({ runtime: "codex", taskId: "task-1" });

    const candidates = db
      .prepare("SELECT memory_type, content FROM agent_memory_candidates WHERE capture_id = ? ORDER BY memory_type")
      .all(capture.id) as Array<{ memory_type: string; content: string }>;
    expect(candidates.map((candidate) => candidate.memory_type)).toContain("decision_intent");
    expect(candidates.map((candidate) => candidate.memory_type)).toContain("task_state");
  });

  it("builds a cross-agent handoff pack from the captured task state", () => {
    captureCodingAgentSession(db, {
      sourceAgentId: "claude-code",
      runtime: "claude-code",
      project: "memroos",
      sessionId: "session-continue",
      taskId: "task-continue",
      summary: "Schema exists; route still needs an auth-gated POST handler.",
      decisionIntent: { decision: "Use a sealed raw vault", reason: "Raw traces may contain secrets." },
      errors: [{ message: "typecheck failed on missing export" }],
      verification: [{ command: "npm run typecheck", status: "pending" }],
    });

    const handoff = buildCodingAgentHandoffPack(db, {
      taskId: "task-continue",
      fromAgentId: "claude-code",
      toAgentId: "codex",
    });

    expect(handoff.toAgentId).toBe("codex");
    expect(handoff.redactionState).toBe("none");
    expect(handoff.sourceCaptureIds).toHaveLength(1);
    expect(handoff.contextPack.captures).toEqual([
      expect.objectContaining({
        sourceAgentId: "claude-code",
        summary: "Schema exists; route still needs an auth-gated POST handler.",
      }),
    ]);
    expect(handoff.contextPack.durableCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memoryType: "decision_intent" }),
        expect.objectContaining({ memoryType: "lesson" }),
      ])
    );
  });

  it("sanitizes primitive capture fields and compacts non-string summaries", () => {
    captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: "session-primitive",
      taskId: "task-primitive",
      summary: 42,
      decisionIntent: "not-an-object",
      errors: "single-error",
      verification: null,
      files: "not-an-array",
    } as unknown as Parameters<typeof captureCodingAgentSession>[1]);

    const pack = buildCodingAgentHandoffPack(db, { taskId: "task-primitive" });
    expect(pack.contextPack.captures[0]?.summary).toBe("42");
    expect(pack.contextPack.durableCandidates.length).toBeGreaterThanOrEqual(0);
  });

  it("redacts secrets in handoff state and suppresses duplicate captures", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const input = {
      sourceAgentId: "opencode",
      runtime: "opencode",
      sessionId: "session-secret",
      taskId: "task-secret",
      summary: `Command failed with ${token}`,
      commands: [`curl -H "Authorization: Bearer ${token}" https://example.test`],
    };
    const first = captureCodingAgentSession(db, input);
    const second = captureCodingAgentSession(db, input);

    expect(first.captureHealth).toBe("redacted");
    expect(second.duplicate).toBe(true);
    const pack = buildCodingAgentHandoffPack(db, { taskId: "task-secret" });
    expect(JSON.stringify(pack.contextPack)).toContain("[REDACTED]");
    expect(JSON.stringify(pack.contextPack)).not.toContain(token);
    expect(pack.redactionState).toBe("redacted");
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_session_captures").get()).toEqual({ count: 1 });
  });
});
