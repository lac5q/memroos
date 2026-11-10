// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import type { NextRequest as NextRequestType } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createDocumentDirectoryEntry, createWriteRule } from "@/lib/write-rules";
import { computeContentHash } from "@/lib/skills/registry";
import { createImportProposal, SkillSyncError } from "@/lib/skills/skill-sync";
import { detectSkillChange } from "@/lib/skills/skill-sync-governance";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgent = vi.fn();
const mockCheckSync = vi.fn();
const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  };
});

vi.mock("@/lib/skills/skill-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/skill-sync")>();
  return {
    ...actual,
    checkSync: (...args: unknown[]) => mockCheckSync(...args),
  };
});

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

const LOOPBACK = "http://localhost";
const SIGNING_KEY = path.join(process.cwd(), "data", "skill-signing-key.json");

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
  mockCheckSync.mockReset();
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReturnValue({ id: "agent-batch21" });
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(SIGNING_KEY)) unlinkSync(SIGNING_KEY);
});

describe("api routes batch21 — skills reject and sync check", () => {
  it("POST reject routes validate params and non-object bodies", async () => {
    const { POST: rejectImport } = await import("../skills/proposals/[id]/reject/route");
    const missingId = await rejectImport(
      jsonBody(`${LOOPBACK}/api/skills/proposals//reject`, { operator: "op", reason: "x" }),
      { params: Promise.resolve({ id: "" }) } as never,
    );
    expect(missingId.status).toBe(400);

    const arrayBody = await rejectImport(
      new Request(`${LOOPBACK}/api/skills/proposals/x/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["not", "object"]),
      }),
      { params: Promise.resolve({ id: randomUUID() }) } as never,
    );
    expect(arrayBody.status).toBe(400);
    expect((await arrayBody.json()).error).toMatch(/object/i);

    const { POST: rejectSync } = await import("../skills/sync/proposals/[proposalId]/reject/route");
    const missingProposalId = await rejectSync(
      jsonBody(`${LOOPBACK}/api/skills/sync/proposals//reject`, { operator: "op", reason: "x" }),
      { params: Promise.resolve({ proposalId: "" }) } as never,
    );
    expect(missingProposalId.status).toBe(400);
  });

  it("POST reject routes surface 500 on unexpected failures", async () => {
    vi.doMock("@/lib/skills/skill-sync-governance", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/skills/skill-sync-governance")>();
      return {
        ...actual,
        rejectImportProposal: () => {
          throw new Error("unexpected governance fault");
        },
      };
    });
    const { POST } = await import("../skills/proposals/[id]/reject/route");
    const created = detectSkillChange(testDb, {
      source_harness: "claude",
      skill_name: `prop-${randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body",
    });
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/proposals/${created.proposal.id}/reject`, {
        operator: "operator",
        reason: "fail path",
      }),
      { params: Promise.resolve({ id: created.proposal.id }) } as never,
    );
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/skills/skill-sync-governance");
  });

  it("POST /api/skills/sync/check maps SkillSyncError to 400", async () => {
    mockCheckSync.mockImplementation(() => {
      throw new SkillSyncError("roots unreadable");
    });
    const { POST } = await import("../skills/sync/check/route");
    const root = mkdtempSync(path.join(tmpdir(), `sync-b21-${randomUUID().slice(0, 6)}-`));
    for (const harness of ["claude", "codex", "hermes", "opencode"] as const) {
      mkdirSync(path.join(root, harness), { recursive: true });
      writeFileSync(path.join(root, harness, ".keep"), "");
    }
    const res = await POST(jsonBody(`${LOOPBACK}/api/skills/sync/check`, { roots: syncRoots(root) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unreadable/i);
  });

  it("POST sync reject returns 500 when rejectSyncProposalById throws unexpectedly", async () => {
    vi.doMock("@/lib/skills/skill-sync", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/skills/skill-sync")>();
      return {
        ...actual,
        rejectSyncProposalById: () => {
          throw new Error("sync store fault");
        },
      };
    });
    const { POST } = await import("../skills/sync/proposals/[proposalId]/reject/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/sync/proposals/${randomUUID()}/reject`, {
        operator: "operator",
        reason: "fail",
      }),
      { params: Promise.resolve({ proposalId: randomUUID() }) } as never,
    );
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/skills/skill-sync");
  });
});

describe("api routes batch21 — write-rules and document-directory", () => {
  it("PATCH and DELETE /api/write-rules/[id] validate ids and surface update errors", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `wr-b21-${randomUUID().slice(0, 6)}` });
    const rule = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "lesson",
      targetDocument: "lessons.md",
      actorId: "agent-batch21",
    });
    const { PATCH, DELETE } = await import("../write-rules/[id]/route");

    const badRule = await PATCH(
      jsonBody(`${LOOPBACK}/api/write-rules/0`, { expectedVersion: 1 }),
      { params: Promise.resolve({ id: "0" }) } as never,
    );
    expect(badRule.status).toBe(400);

    const conflict = await PATCH(
      jsonBody(`${LOOPBACK}/api/write-rules/${rule.id}`, {
        expectedVersion: 99,
        targetDocument: "other.md",
      }),
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(conflict.status).toBe(400);
    expect((await conflict.json()).error).toBeTruthy();

    const badDelete = await DELETE(
      jsonBody(`${LOOPBACK}/api/write-rules/not-a-number`, { expectedVersion: 1 }),
      { params: Promise.resolve({ id: "not-a-number" }) } as never,
    );
    expect(badDelete.status).toBe(400);
  });

  it("PATCH and DELETE /api/document-directory/[id] require expectedVersion and handle conflicts", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `dir-b21-${randomUUID().slice(0, 6)}` });
    const entry = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "Runbook",
      actorId: "agent-batch21",
    });
    const { PATCH, DELETE } = await import("../document-directory/[id]/route");

    const missingVersion = await DELETE(
      jsonBody(`${LOOPBACK}/api/document-directory/${entry.id}`, {}),
      { params: Promise.resolve({ id: String(entry.id) }) } as never,
    );
    expect(missingVersion.status).toBe(400);

    const patchConflict = await PATCH(
      jsonBody(`${LOOPBACK}/api/document-directory/${entry.id}`, {
        expectedVersion: 99,
        name: "Renamed",
      }),
      { params: Promise.resolve({ id: String(entry.id) }) } as never,
    );
    expect(patchConflict.status).toBe(400);
    expect((await patchConflict.json()).error).toBeTruthy();
  });
});

function asReq(url: string, init?: RequestInit): NextRequestType {
  return new Request(url, init) as unknown as NextRequestType;
}

describe("api routes batch21 spray — directives diff and artifact gate", () => {
  it("GET /api/directives/diff requires JSON body with local and canonical", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "directive-key-b21";
    const { GET } = await import("../directives/diff/route");
    const missingBody = await GET(
      new NextRequest(`${LOOPBACK}/api/directives/diff?tenant=default-tenant`, {
        method: "GET",
        headers: { authorization: "Bearer directive-key-b21" },
      }),
    );
    expect(missingBody.status).toBe(400);

    const diff = await GET(
      new NextRequest(`${LOOPBACK}/api/directives/diff`, {
        method: "POST",
        headers: { authorization: "Bearer directive-key-b21", "content-type": "application/json" },
        body: JSON.stringify({ local: "line-a\n", canonical: "line-b\n" }),
      }),
    );
    expect(diff.status).toBe(200);
    expect((await diff.json()).diff.identical).toBe(false);
  });

  it("POST /api/artifact-gate/save rejects missing required fields", async () => {
    const { POST } = await import("../artifact-gate/save/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/artifact-gate/save`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "agent-batch21" },
        body: JSON.stringify({ spaceId: "space-1" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
