// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createDocumentDirectoryEntry, createWriteRule } from "@/lib/write-rules";
import { computeContentHash } from "@/lib/skills/registry";
import { createImportProposal } from "@/lib/skills/skill-sync";
import { detectSkillChange } from "@/lib/skills/skill-sync-governance";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();
const mockClassifyLiveness = vi.fn();
const mockBuildAgentContext = vi.fn();
const mockResolveChatRuntimePlan = vi.fn();
const mockChatRuntimeStatus = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
    getRegisteredAgent: actual.getRegisteredAgent,
    updateAgentDetails: actual.updateAgentDetails,
    deregisterAgent: actual.deregisterAgent,
  };
});

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/agent-liveness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-liveness")>();
  return {
    ...actual,
    classifyLiveness: (...args: unknown[]) => mockClassifyLiveness(...args),
  };
});

vi.mock("@/app/api/chat/chat-runtime", () => ({
  buildAgentContext: (...args: unknown[]) => mockBuildAgentContext(...args),
  resolveChatRuntimePlan: (...args: unknown[]) => mockResolveChatRuntimePlan(...args),
  chatRuntimeStatus: (...args: unknown[]) => mockChatRuntimeStatus(...args),
  resolveChatRuntime: vi.fn(async () => ({ runner: "anthropic", model: "claude-test", source: "env" })),
  isProviderLimitError: vi.fn(() => false),
  recordChatRuntimeFailure: vi.fn(),
  recordChatRuntimeSuccess: vi.fn(),
}));

const LOOPBACK = "http://localhost";
const SIGNING_KEY = path.join(process.cwd(), "data", "skill-signing-key.json");

const MINIMAL_SKILL_MD = `---
name: batch20-import-skill
description: batch20 import route coverage
owner: ops
source_harness: claude
risk_tier: low
dispatch_status: enabled
---

## Preconditions
- none

## Allowed Tools
- read_file

## Verification Checks
- output ok

## Rollback
- revert
`;

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function syncRoots(root: string) {
  return {
    claude: path.join(root, "claude"),
    codex: path.join(root, "codex"),
    hermes: path.join(root, "hermes"),
    opencode: path.join(root, "opencode"),
  };
}

beforeEach(() => {
  mockAuthenticateAgent.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockClassifyLiveness.mockReset();
  mockBuildAgentContext.mockReset();
  mockResolveChatRuntimePlan.mockReset();
  mockChatRuntimeStatus.mockReset();
  mockAuthenticateAgent.mockReturnValue({ id: "agent-batch20" });
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  mockClassifyLiveness.mockReturnValue({
    state: "stale",
    source: "registry",
    observedAt: "2026-01-01T00:00:00.000Z",
    freshnessMs: 999_999,
    reason: "no recent heartbeat",
  });
  mockBuildAgentContext.mockResolvedValue({ systemPrompt: "You are an agent." });
  mockResolveChatRuntimePlan.mockResolvedValue({
    primary: { runner: "anthropic", model: "claude-test", source: "env" },
    candidates: [],
  });
  mockChatRuntimeStatus.mockReturnValue({ status: "ready", detail: "ready" });
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(SIGNING_KEY)) unlinkSync(SIGNING_KEY);
});

describe("api routes batch20 — skills reject, check, import", () => {
  it("POST /api/skills/proposals/[id]/reject validates body and rejects pending proposals", async () => {
    const created = detectSkillChange(testDb, {
      source_harness: "claude",
      skill_name: `prop-${randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body",
    });
    const { POST } = await import("../skills/proposals/[id]/reject/route");

    const missingReason = await POST(
      jsonBody(`${LOOPBACK}/api/skills/proposals/${created.proposal.id}/reject`, {
        operator: "operator",
      }),
      { params: Promise.resolve({ id: created.proposal.id }) } as never,
    );
    expect(missingReason.status).toBe(400);

    const rejected = await POST(
      jsonBody(`${LOOPBACK}/api/skills/proposals/${created.proposal.id}/reject`, {
        operator: "operator",
        reason: "not needed",
      }),
      { params: Promise.resolve({ id: created.proposal.id }) } as never,
    );
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).proposal.status).toBe("rejected");

    const notFound = await POST(
      jsonBody(`${LOOPBACK}/api/skills/proposals/${randomUUID()}/reject`, {
        operator: "operator",
        reason: "missing",
      }),
      { params: Promise.resolve({ id: randomUUID() }) } as never,
    );
    expect(notFound.status).toBe(404);
  });

  it("POST /api/skills/sync/proposals/[proposalId]/reject clears pending sync proposals", async () => {
    const skillName = `sync-${randomUUID().slice(0, 8)}`;
    const body = `---\nname: ${skillName}\nversion: 1.0.0\n---\n# body`;
    const { proposal } = createImportProposal(testDb, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
        file_path: null,
      },
      proposed_by: "batch20",
      source_root: null,
    });
    const proposalId = proposal.pending_proposal_id!;
    const { POST } = await import("../skills/sync/proposals/[proposalId]/reject/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/sync/proposals/${proposalId}/reject`, {
        operator: "operator",
        reason: "defer",
      }),
      { params: Promise.resolve({ proposalId }) } as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).proposal.status).toBe("rejected");

    const again = await POST(
      jsonBody(`${LOOPBACK}/api/skills/sync/proposals/${proposalId}/reject`, {
        operator: "operator",
        reason: "duplicate",
      }),
      { params: Promise.resolve({ proposalId }) } as never,
    );
    expect([404, 409]).toContain(again.status);
  });

  it("POST /api/skills/sync/check validates roots and returns scan envelope", async () => {
    const root = mkdtempSync(path.join(tmpdir(), `sync-b20-${randomUUID().slice(0, 6)}-`));
    for (const harness of ["claude", "codex", "hermes", "opencode"] as const) {
      mkdirSync(path.join(root, harness), { recursive: true });
      writeFileSync(path.join(root, harness, ".keep"), "", { flag: "w" });
    }
    const { POST } = await import("../skills/sync/check/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/sync/check`, { roots: syncRoots(root), proposed_by: "batch20" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST and GET /api/skills/import validate body and list malformed registry rows", async () => {
    const { POST, GET } = await import("../skills/import/route");
    const missingHarness = await POST(
      jsonBody(`${LOOPBACK}/api/skills/import`, {
        content: MINIMAL_SKILL_MD,
        imported_by: "batch20",
      }),
    );
    expect(missingHarness.status).toBe(400);

    const imported = await POST(
      jsonBody(`${LOOPBACK}/api/skills/import`, {
        content: MINIMAL_SKILL_MD,
        source_harness: "claude",
        imported_by: "batch20",
      }),
    );
    expect(imported.status).toBe(200);

    testDb
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
          public_key_fingerprint
        ) VALUES (
          ?, 'd', 'ops', 'codex', 'low', 'enabled',
          '1.0.0', '[]', '[]', '{bad-json', '[]',
          '# x', 100, '[]', 'batch20', datetime('now'),
          NULL, 'hash', NULL, NULL, NULL, 'unsigned',
          NULL
        )`,
      )
      .run(`list-${randomUUID().slice(0, 8)}`);

    const listed = await GET(new Request(`${LOOPBACK}/api/skills/import?limit=5`));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.items.some((item: { verification_checks_list: unknown[] }) => Array.isArray(item.verification_checks_list))).toBe(
      true,
    );
  });
});

describe("api routes batch20 — chat, agents, write-rules, document-directory", () => {
  it("POST /api/chat records operator question telemetry for question-like prompts", async () => {
    const { POST } = await import("../chat/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/chat`, {
        message: "What changed in the memory graph?",
        agentId: "ceo",
        history: [{ role: "user", content: "What changed in the memory graph?" }],
        memoryHits: ["mem-1"],
      }) as NextRequest,
    );
    expect(res.status).toBe(200);
    const row = testDb
      .prepare(`SELECT COUNT(*) AS count FROM efficiency_events WHERE event_type = 'operator_question'`)
      .get() as { count: number };
    expect(row.count).toBeGreaterThan(0);
  });

  it("GET /api/agents/[id] and PATCH validate agent detail updates", async () => {
    const agentId = `agent-${randomUUID().slice(0, 8)}`;
    const { registerAgent } = await import("@/lib/agent-registry");
    registerAgent({
      id: agentId,
      name: "Batch20 Agent",
      role: "ops",
      platform: "claude",
      protocol: "rest",
    });

    const { GET, PATCH } = await import("../agents/[id]/route");
    const detail = await GET(asReq(`${LOOPBACK}/api/agents/${agentId}`), {
      params: Promise.resolve({ id: agentId }),
    } as never);
    expect(detail.status).toBe(200);
    expect((await detail.json()).liveness.heartbeat.status).toBe("stale");

    const badCompany = await PATCH(
      jsonBody(`${LOOPBACK}/api/agents/${agentId}`, { company: 42 }),
      { params: Promise.resolve({ id: agentId }) } as never,
    );
    expect(badCompany.status).toBe(400);

    const updated = await PATCH(
      jsonBody(`${LOOPBACK}/api/agents/${agentId}`, { name: "Renamed Agent", company: null }),
      { params: Promise.resolve({ id: agentId }) } as never,
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).agent.name).toBe("Renamed Agent");
  });

  it("PATCH and DELETE /api/write-rules/[id] enforce auth and optimistic concurrency", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `wr-${randomUUID().slice(0, 6)}` });
    const rule = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "lesson",
      targetDocument: "lessons.md",
      actorId: "agent-batch20",
    });
    const { PATCH, DELETE } = await import("../write-rules/[id]/route");

    mockAuthenticateAgent.mockReturnValueOnce(null);
    const unauth = await PATCH(
      jsonBody(`${LOOPBACK}/api/write-rules/${rule.id}`, { expectedVersion: 1, targetDocument: "x.md" }),
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(unauth.status).toBe(401);

    mockAuthenticateAgent.mockReturnValue({ id: "agent-batch20" });
    const patched = await PATCH(
      jsonBody(`${LOOPBACK}/api/write-rules/${rule.id}`, {
        expectedVersion: 1,
        target_document: "updated-lessons.md",
      }),
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(patched.status).toBe(200);

    const deleted = await DELETE(
      jsonBody(`${LOOPBACK}/api/write-rules/${rule.id}`, { expectedVersion: 2 }),
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(deleted.status).toBe(200);
  });

  it("PATCH and DELETE /api/document-directory/[id] handle invalid ids and version mismatches", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `dir-${randomUUID().slice(0, 6)}` });
    const entry = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "Runbook",
      actorId: "agent-batch20",
    });
    const { PATCH, DELETE } = await import("../document-directory/[id]/route");

    const badId = await PATCH(
      jsonBody(`${LOOPBACK}/api/document-directory/not-id`, { expectedVersion: 1, name: "X" }),
      { params: Promise.resolve({ id: "not-id" }) } as never,
    );
    expect(badId.status).toBe(400);

    const deleted = await DELETE(
      jsonBody(`${LOOPBACK}/api/document-directory/${entry.id}`, { expectedVersion: 99 }),
      { params: Promise.resolve({ id: String(entry.id) }) } as never,
    );
    expect(deleted.status).toBe(400);
  });
});

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}
