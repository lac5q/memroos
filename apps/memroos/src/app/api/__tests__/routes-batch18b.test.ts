// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgent = vi.fn();

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

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthenticateAgent.mockReset();
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  vi.resetModules();
});

describe("routes batch18b — artifact gate, paperclip, slack", () => {
  it("GET /api/artifact-gate/auto-readme returns 400 without spaceId", async () => {
    const { GET } = await import("../artifact-gate/auto-readme/route");
    const res = await GET(asReq(`${LOOPBACK}/api/artifact-gate/auto-readme?agent=agent-1`));
    expect(res.status).toBe(400);
  });

  it("POST /api/artifact-gate/auto-readme toggles enabled flag", async () => {
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `readme-b18b-${randomUUID().slice(0, 6)}`,
    });
    const { POST, GET } = await import("../artifact-gate/auto-readme/route");
    const post = await POST(
      new Request(`${LOOPBACK}/api/artifact-gate/auto-readme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: space.id, agent: "agent-1", enabled: true }),
      }) as NextRequest,
    );
    expect(post.status).toBe(200);
    const get = await GET(asReq(`${LOOPBACK}/api/artifact-gate/auto-readme?spaceId=${space.id}&agent=agent-1`));
    expect((await get.json()).enabled).toBe(true);
  });

  it("GET /api/paperclip returns local summary when upstream unset", async () => {
    delete process.env.PAPERCLIP_BASE_URL;
    const { GET } = await import("../paperclip/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).summary.fleetStatus).toBe("offline");
  });

  it("POST /api/integrations/slack/events rejects missing signing secret", async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.MEMROOS_SLACK_SIGNING_SECRET;
    const { POST } = await import("../integrations/slack/events/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/integrations/slack/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "event_callback" }),
      }),
    );
    expect(res.status).toBe(503);
  });

  it("POST /api/integrations/slack/events rejects invalid JSON bodies", async () => {
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret-b18b";
    const { POST } = await import("../integrations/slack/events/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/integrations/slack/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-signature": "v0=abc",
          "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(401);
  });
});
