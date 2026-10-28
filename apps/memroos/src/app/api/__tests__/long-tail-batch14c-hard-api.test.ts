// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
    recordMemoryWrite: vi.fn(),
  };
});

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

const LOOPBACK = "http://localhost";
const PROPOSAL_ID = "APO_PROPOSAL_demo_skill_demo_20260505_120000.md";
const APO_BODY = `# Proposal
**APO Constraint to add to SKILL.md:**
\`\`\`
Validate retries with auth context.
\`\`\`
`;

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadApoRoute(apoRoot: string) {
  vi.resetModules();
  vi.stubEnv("APO_PROPOSALS_PATH", path.join(apoRoot, "proposals"));
  vi.stubEnv("APO_SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("APO_AGENT_CONFIGS_PATH", path.join(apoRoot, "agents"));
  vi.stubEnv("APO_CRON_LOG_PATH", path.join(apoRoot, "cron.log"));
  vi.stubEnv("SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("HOME", apoRoot);
  return import("../apo/route");
}

describe("batch14c — hard API leftovers", () => {
  let apoRoot: string;

  beforeEach(() => {
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    apoRoot = mkdtempSync(path.join(tmpdir(), `apo-batch14c-${randomUUID()}-`));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(apoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("POST /api/apo returns 500 when filesystem read throws during apply-approved", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "approved", PROPOSAL_ID), APO_BODY);
    vi.doMock("fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("fs/promises")>();
      return {
        ...actual,
        readFile: vi.fn(async (filePath: string, encoding?: unknown) => {
          if (String(filePath).includes("approved")) {
            throw new Error("forced apply failure");
          }
          return actual.readFile(filePath, encoding as never);
        }),
      };
    });
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: PROPOSAL_ID })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "forced apply failure" });
  });

  it("POST /api/agent-context/messages/[id]/reply returns 400 when bus throws", async () => {
    vi.doMock("@/lib/content-scanner", () => ({
      scanContent: vi.fn(() => ({ cleanContent: "hello", blocked: false, findings: [], matches: [] })),
    }));
    vi.doMock("@/lib/audit", () => ({
      writeAuditLog: vi.fn(),
    }));
    vi.doMock("@/lib/agent-context-bus", () => ({
      replyToAgentContextMessage: vi.fn(() => {
        throw new Error("reply bus down");
      }),
    }));
    const { POST } = await import("../agent-context/messages/[id]/reply/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/agent-context/messages/msg-1/reply`, { body: "hello" }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "msg-1" }) } as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "reply bus down" });
  });

  it("POST /api/skills/import 400 when body is not an object", async () => {
    const { POST } = await import("../skills/import/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/skills/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["array"]),
      })
    );
    expect(res.status).toBe(400);
  });
});
