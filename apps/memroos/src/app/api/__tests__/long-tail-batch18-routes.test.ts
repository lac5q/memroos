// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import {
  createDocumentDirectoryEntry,
  createWriteRule,
} from "@/lib/write-rules";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgent = vi.fn();
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

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("long-tail batch18 — workspace & document-directory", () => {
  beforeEach(() => {
    mockAuthenticateAgent.mockReset();
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    mockAuthenticateUser.mockReset();
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_AGENT_API_KEY;
    testDb.exec("DELETE FROM document_directory");
    testDb.exec("DELETE FROM active_workspace");
    vi.resetModules();
  });

  it("GET /api/workspace returns 401 without agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../workspace/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(res.status).toBe(401);
  });

  it("GET /api/workspace surfaces errors from active workspace query", async () => {
    const origPrepare = testDb.prepare.bind(testDb);
    testDb.prepare = vi.fn((sql: string) => {
      if (typeof sql === "string" && sql.includes("active_workspace")) {
        throw new Error("workspace store offline");
      }
      return origPrepare(sql);
    }) as typeof testDb.prepare;
    const { GET } = await import("../workspace/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/workspace store offline/i);
    testDb.prepare = origPrepare;
  });

  it("POST /api/workspace accepts space_id and is_headless aliases", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `ws-${randomUUID().slice(0, 8)}`,
    });
    const { POST } = await import("../workspace/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/workspace`, {
        space_id: space.id,
        agentId: "agent-1",
        is_headless: true,
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).workspace.isHeadless).toBe(true);
  });

  it("POST /api/workspace returns 400 when space does not exist", async () => {
    const { POST } = await import("../workspace/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/workspace`, {
        spaceId: `missing-${randomUUID()}`,
        agent: "agent-1",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("DELETE /api/workspace clears active workspace", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `ws-del-${randomUUID().slice(0, 8)}`,
    });
    const { POST, DELETE } = await import("../workspace/route");
    await POST(
      jsonBody(`${LOOPBACK}/api/workspace`, { spaceId: space.id, agent: "agent-1" }) as unknown as NextRequest,
    );
    const res = await DELETE(asReq(`${LOOPBACK}/api/workspace?agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/document-directory requires spaceId and lists via space_id", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../document-directory/route");
    expect((await GET(asReq(`${LOOPBACK}/api/document-directory?agent=a`))).status).toBe(401);

    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `dd-${randomUUID().slice(0, 8)}`,
    });
    createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "Guide.md",
      actorId: "agent-1",
    });
    const res = await GET(asReq(`${LOOPBACK}/api/document-directory?space_id=${space.id}&agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(1);
  });

  it("GET /api/document-directory returns 500 when listing throws", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `dd-err-${randomUUID().slice(0, 8)}`,
    });
    const origPrepare = testDb.prepare.bind(testDb);
    testDb.prepare = vi.fn((sql: string) => {
      if (typeof sql === "string" && sql.includes("document_directory")) {
        throw new Error("directory query failed");
      }
      return origPrepare(sql);
    }) as typeof testDb.prepare;
    const { GET } = await import("../document-directory/route");
    const res = await GET(asReq(`${LOOPBACK}/api/document-directory?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(500);
    testDb.prepare = origPrepare;
  });

  it("POST /api/document-directory validates name and handles create errors", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `dd-post-${randomUUID().slice(0, 8)}`,
    });
    const { POST } = await import("../document-directory/route");
    expect(
      (
        await POST(
          jsonBody(`${LOOPBACK}/api/document-directory`, {
            spaceId: space.id,
            agent: "agent-1",
            name: "  ",
          }) as unknown as NextRequest,
        )
      ).status,
    ).toBe(400);

    const badSpace = await POST(
      jsonBody(`${LOOPBACK}/api/document-directory`, {
        spaceId: `ghost-${randomUUID()}`,
        agent: "agent-1",
        name: "X.md",
      }) as unknown as NextRequest,
    );
    expect(badSpace.status).toBe(400);
  });

  it("PATCH /api/document-directory/[id] uses expected_version and agentId", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `dd-patch-${randomUUID().slice(0, 8)}`,
    });
    const entry = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "A.md",
      actorId: "agent-1",
    });
    const { PATCH } = await import("../document-directory/[id]/route");
    expect(
      (
        await PATCH(
          jsonBody(
            `${LOOPBACK}/api/document-directory/${entry.id}`,
            { agentId: "agent-1", expected_version: 1, name: "B.md" },
            "PATCH",
          ) as unknown as NextRequest,
          { params: Promise.resolve({ id: String(entry.id) }) } as never,
        )
      ).status,
    ).toBe(200);
  });

  it("DELETE /api/document-directory/[id] rejects invalid id", async () => {
    const { DELETE } = await import("../document-directory/[id]/route");
    const res = await DELETE(
      jsonBody(`${LOOPBACK}/api/document-directory/0`, { agent: "agent-1", expectedVersion: 1 }, "DELETE") as unknown as NextRequest,
      { params: Promise.resolve({ id: "0" }) } as never,
    );
    expect(res.status).toBe(400);
  });
});

describe("long-tail batch18 — write-rules & artifact-gate", () => {
  beforeEach(() => {
    mockAuthenticateAgent.mockReset();
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    testDb.exec("DELETE FROM write_rules");
    vi.resetModules();
  });

  it("GET /api/write-rules returns 401 without agent", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../write-rules/route");
    const res = await GET(asReq(`${LOOPBACK}/api/write-rules?spaceId=x`));
    expect(res.status).toBe(401);
  });

  it("GET /api/write-rules returns 500 when query throws", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `wr-${randomUUID().slice(0, 8)}`,
    });
    const origPrepare = testDb.prepare.bind(testDb);
    testDb.prepare = vi.fn((sql: string) => {
      if (typeof sql === "string" && sql.includes("write_rules")) {
        throw new Error("rules unavailable");
      }
      return origPrepare(sql);
    }) as typeof testDb.prepare;
    const { GET } = await import("../write-rules/route");
    const res = await GET(asReq(`${LOOPBACK}/api/write-rules?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(500);
    testDb.prepare = origPrepare;
  });

  it("POST /api/write-rules creates via snake_case fields", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `wr-post-${randomUUID().slice(0, 8)}`,
    });
    const { POST } = await import("../write-rules/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/write-rules`, {
        space_id: space.id,
        agentId: "agent-1",
        data_type: "lesson",
        target_document: "lessons.md",
        fallback_rule: "reject",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).rule.dataType).toBe("lesson");
  });

  it("PATCH /api/write-rules/[id] updates target_document alias", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `wr-id-${randomUUID().slice(0, 8)}`,
    });
    const rule = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "task",
      targetDocument: "tasks.md",
      actorId: "agent-1",
    });
    const { PATCH } = await import("../write-rules/[id]/route");
    const res = await PATCH(
      jsonBody(
        `${LOOPBACK}/api/write-rules/${rule.id}`,
        { agentId: "agent-1", expected_version: 1, target_document: "tasks-v2.md" },
        "PATCH",
      ) as unknown as NextRequest,
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(res.status).toBe(200);
  });

  it("DELETE /api/write-rules/[id] returns 400 on version mismatch", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `wr-del-${randomUUID().slice(0, 8)}`,
    });
    const rule = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "task",
      targetDocument: "tasks.md",
      actorId: "agent-1",
    });
    const { DELETE } = await import("../write-rules/[id]/route");
    const res = await DELETE(
      jsonBody(`${LOOPBACK}/api/write-rules/${rule.id}`, { expectedVersion: 99 }, "DELETE") as unknown as NextRequest,
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/artifact-gate/auto-readme validates spaceId and enabled POST", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET, POST } = await import("../artifact-gate/auto-readme/route");
    expect((await GET(asReq(`${LOOPBACK}/api/artifact-gate/auto-readme?agent=a`))).status).toBe(401);

    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `readme-${randomUUID().slice(0, 8)}`,
    });
    expect(
      (await POST(jsonBody(`${LOOPBACK}/api/artifact-gate/auto-readme`, { spaceId: space.id, agent: "agent-1" }) as unknown as NextRequest))
        .status,
    ).toBe(400);

    const ok = await POST(
      jsonBody(`${LOOPBACK}/api/artifact-gate/auto-readme`, {
        space_id: space.id,
        agentId: "agent-1",
        enabled: false,
      }) as unknown as NextRequest,
    );
    expect(ok.status).toBe(200);
    const listed = await GET(asReq(`${LOOPBACK}/api/artifact-gate/auto-readme?spaceId=${space.id}&agent=agent-1`));
    expect((await listed.json()).enabled).toBe(false);
  });
});

describe("long-tail batch18 — easy API long-tail", () => {
  beforeEach(() => {
    mockAuthenticateAgent.mockReset();
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    mockAuthenticateUser.mockReset();
    vi.resetModules();
  });

  it("GET /api/paperclip returns local summary without upstream", async () => {
    delete process.env.PAPERCLIP_BASE_URL;
    const { GET } = await import("../paperclip/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.fleetStatus).toBe("offline");
  });

  it("GET /api/agents/[id] returns agent detail when registered", async () => {
    const { registerAgent } = await import("@/lib/agent-registry");
    const agentId = `agent-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id: agentId,
      name: "Batch18 Agent",
      role: "worker",
      platform: "codex",
      protocol: "rest",
    });
    const { GET } = await import("../agents/[id]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/${agentId}`), {
      params: Promise.resolve({ id: agentId }),
    } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).agent.id).toBe(agentId);
  });

  it("GET /api/memory/proposals filters memory proposal types", async () => {
    const { GET } = await import("../memory/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/proposals?status=pending`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.proposals)).toBe(true);
    expect(body.types.memory_rewrite).toBeDefined();
  });

  it("GET /api/recall rejects crossProject without allowlist", async () => {
    const { GET } = await import("../recall/route");
    const res = await GET(
      asReq(`${LOOPBACK}/api/recall?q=hello&crossProject=true&agent=agent-1`),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/allowed_project_ids/i);
  });

  it("POST /api/classification/reviews/:id/decision returns 401 without session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../classification/reviews/[reviewId]/decision/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/classification/reviews/r1/decision`, { decision: "approve" }) as unknown as NextRequest,
      { params: Promise.resolve({ reviewId: "r1" }) } as never,
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/escalations/:id/resolve returns 404 for missing escalation", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const { POST } = await import("../escalations/[id]/resolve/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/escalations/${randomUUID()}/resolve`, {}) as unknown as NextRequest,
      { params: Promise.resolve({ id: randomUUID() }) } as never,
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/tools/connect/api-key returns 400 for invalid JSON", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const { POST } = await import("../tools/connect/api-key/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/tools/connect/api-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid JSON/i);
  });

  it("GET /api/agent-context/messages/[id] returns 404 for unknown message", async () => {
    const { GET } = await import("../agent-context/messages/[id]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-context/messages/${randomUUID()}?agent=agent-1`), {
      params: Promise.resolve({ id: randomUUID() }),
    } as never);
    expect(res.status).toBe(404);
  });

  it("GET /api/agent-memory/traces requires runId on loopback", async () => {
    const { GET } = await import("../agent-memory/traces/route");
    const res = await GET(new Request(`${LOOPBACK}/api/agent-memory/traces`));
    expect(res.status).toBe(400);
  });

  it("GET /api/integrations/slack/events manifest on loopback", async () => {
    const { GET } = await import("../integrations/slack/events/route");
    const res = await GET(new Request(`${LOOPBACK}/api/integrations/slack/events`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_information?.name).toBe("MemroOS Memory");
  });

  it("GET /api/time-series returns skill_failures metric", async () => {
    const { GET } = await import("../time-series/route");
    const res = await GET(asReq(`${LOOPBACK}/api/time-series?metric=skill_failures&window=day`));
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).points)).toBe(true);
  });
});

const quarantineTmp = path.join(os.tmpdir(), `batch18-quarantine-${randomUUID()}`);

describe("long-tail batch18 — skills quarantine reject/approve error paths", () => {
  beforeEach(() => {
    fs.rmSync(quarantineTmp, { recursive: true, force: true });
    fs.mkdirSync(quarantineTmp, { recursive: true });
    process.env.MEMROOS_ROOT = quarantineTmp;
    process.env.SQLITE_DB_PATH = path.join(quarantineTmp, `db-${randomUUID()}.db`);
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.MEMROOS_ROOT;
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    try {
      const dbModule = await import("@/lib/db");
      dbModule.closeDb();
    } catch {
      /* ignore */
    }
    vi.resetModules();
    fs.rmSync(quarantineTmp, { recursive: true, force: true });
    const signingKey = path.join(process.cwd(), "skill-signing-key.json");
    if (fs.existsSync(signingKey)) {
      fs.unlinkSync(signingKey);
    }
  });

  async function seedPendingSkill(): Promise<number> {
    const { getDb } = await import("@/lib/db");
    const { initSchema: init } = await import("@/lib/db-schema");
    const db = getDb();
    init(db);
    const result = db
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
          public_key_fingerprint
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?
        )`,
      )
      .run(
        `skill-${randomUUID().slice(0, 8)}`,
        "desc",
        "ops",
        "claude",
        "low",
        "quarantined",
        "1.0.0",
        "none",
        "read_file",
        "verify",
        "revert",
        "body",
        100,
        "[]",
        "operator",
        new Date().toISOString(),
        "evidence",
        null,
        null,
        null,
        null,
        "unsigned",
        null,
      );
    const skillId = Number(result.lastInsertRowid);
    const { upsertQuarantineRecord } = await import("@/lib/skills/skill-quarantine");
    upsertQuarantineRecord(db, {
      skillId,
      stage: "pending_approval",
      approvalStatus: "pending",
    });
    return skillId;
  }

  it("POST /api/skills/quarantine/reject returns 400 for invalid JSON and non-object body", async () => {
    const rejectRoute = await import("../skills/quarantine/reject/route");
    const badJson = await rejectRoute.POST(
      new Request(`${LOOPBACK}/api/skills/quarantine/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(badJson.status).toBe(400);

    const notObject = await rejectRoute.POST(
      new Request(`${LOOPBACK}/api/skills/quarantine/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["nope"]),
      }),
    );
    expect(notObject.status).toBe(400);
  });

  it("POST /api/skills/quarantine/reject returns 500 on unexpected errors", async () => {
    vi.doMock("@/lib/skills/skill-quarantine", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/skills/skill-quarantine")>();
      return {
        ...actual,
        getQuarantineRecord: actual.getQuarantineRecord,
        rejectQuarantine: () => {
          throw new Error("simulated reject failure");
        },
      };
    });
    const skillId = await seedPendingSkill();
    const rejectRoute = await import("../skills/quarantine/reject/route");
    const res = await rejectRoute.POST(
      new Request(`${LOOPBACK}/api/skills/quarantine/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skill_id: skillId, operator: "ops", reason: "bad" }),
      }),
    );
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/skills/skill-quarantine");
  });

  it("POST /api/skills/quarantine/approve returns 409 on QuarantineTransitionError", async () => {
    const { QuarantineTransitionError } = await import("@/lib/skills/skill-quarantine");
    vi.doMock("@/lib/skills/skill-quarantine", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/skills/skill-quarantine")>();
      return {
        ...actual,
        approveQuarantine: () => {
          throw new QuarantineTransitionError("illegal transition");
        },
      };
    });
    const skillId = await seedPendingSkill();
    const approveRoute = await import("../skills/quarantine/approve/route");
    const res = await approveRoute.POST(
      new Request(`${LOOPBACK}/api/skills/quarantine/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skill_id: skillId, operator: "ops" }),
      }),
    );
    expect(res.status).toBe(409);
    vi.doUnmock("@/lib/skills/skill-quarantine");
  });
});
