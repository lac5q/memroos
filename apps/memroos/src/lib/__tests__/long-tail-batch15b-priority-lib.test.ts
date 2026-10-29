// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { buildAgentContextPacket } from "@/lib/agent-context-packet";
import { authorizeChatGptAction, parseActionLimit } from "@/lib/chatgpt-actions";
import { computeDsarVerificationHash, submitDsarRequest } from "@/lib/memory/dsar";
import { detectSkillChange, computeGovernanceContentHash } from "@/lib/skills/skill-sync-governance";

describe("long-tail batch15b — priority lib targets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("submitDsarRequest denies requests with invalid verification hash", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const subject = { subjectId: `subject-${randomUUID().slice(0, 8)}` };
    const result = submitDsarRequest(db, {
      tenantId: "default-tenant",
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash: "deadbeef",
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/identity_verification_failed/i);
    db.close();
  });

  it("authorizeChatGptAction enforces API key off loopback", () => {
    vi.stubEnv("MEMROOS_CHATGPT_ACTIONS_API_KEY", "expected-key");
    const unauthorized = authorizeChatGptAction(
      new Request("https://memroos.example/api/chatgpt/search"),
    );
    expect(unauthorized?.status).toBe(401);
    const authorized = authorizeChatGptAction(
      new Request("https://memroos.example/api/chatgpt/search", {
        headers: { "x-api-key": "expected-key" },
      }),
    );
    expect(authorized).toBeNull();
    expect(parseActionLimit("abc")).toBe(8);
  });

  it("detectSkillChange marks unchanged registry hashes without creating proposals", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const hash = computeGovernanceContentHash("same-body");
    const name = `skill-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level
      ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', 'same-body', 100, '[]', 'op', ?, '', ?, 'unsigned')`,
    ).run(name, new Date().toISOString(), hash);
    const result = detectSkillChange(db, {
      source_harness: "claude",
      skill_name: name,
      detected_content_hash: hash,
      proposed_by: "scanner",
    });
    expect(result.unchanged).toBe(true);
    expect(result.proposal.status).toBe("approved");
    db.close();
  });

  it("buildAgentContextPacket honors redacted authorization metadata", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_session_captures
       (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
       VALUES ('cap-ok', 'default-tenant', 'agent-a', 'test', 'sess', 'hash-cap-ok', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_memory_candidates
       (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, belief_stage, created_at)
       VALUES ('cand-ok', 'default-tenant', 'cap-ok', 'agent-a', 'lesson', 'body', 'hash', 'candidate', ?, 'silver_candidate_claim', '2026-01-01T00:00:00Z')`,
    ).run(
      JSON.stringify({
        goalId,
        title: "Included lesson",
        authorization: "redacted",
      }),
    );
    const { packet } = buildAgentContextPacket(db, { goalId, actorAgentId: "agent-a" });
    expect(packet.memories.some((m) => m.id === "cand-ok" && m.authorization === "redacted")).toBe(true);
    db.close();
  });
});
