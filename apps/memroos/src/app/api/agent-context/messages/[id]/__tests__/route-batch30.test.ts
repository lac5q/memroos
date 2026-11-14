// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const LOOPBACK = "http://localhost";

const mockAuthenticate = vi.fn();
const mockGetMessage = vi.fn();
const mockFindReply = vi.fn();

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticate(...args),
}));

vi.mock("@/lib/agent-context-bus", () => ({
  getAgentContextMessage: (...args: unknown[]) => mockGetMessage(...args),
  findReplyForAgentContextMessage: (...args: unknown[]) => mockFindReply(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
}));

describe("GET /api/agent-context/messages/[id] batch30", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("clamps invalid wait_ms values and polls until reply arrives (11, 41-42)", async () => {
    const id = randomUUID();
    mockAuthenticate.mockReturnValue({ id: "agent-a" });
    mockGetMessage.mockReturnValue({ id, fromAgent: "agent-a", toAgent: "agent-b" });
    mockFindReply
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ id: "reply-b30", body: "ok batch30" });

    const { GET } = await import("../route");
    const req = new NextRequest(
      `${LOOPBACK}/api/agent-context/messages/${id}?wait_for=reply&wait_ms=999999&agent=agent-a`,
      { headers: { "x-agent-id": "agent-a" } },
    );
    const res = await GET(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timedOut).toBe(false);
    expect(body.reply?.body).toBe("ok batch30");
    expect(mockFindReply.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("treats non-finite wait_ms as zero (no extra polling)", async () => {
    const id = randomUUID();
    mockAuthenticate.mockReturnValue({ id: "agent-a" });
    mockGetMessage.mockReturnValue({ id, fromAgent: "agent-a", toAgent: "agent-b" });
    mockFindReply.mockReturnValue(null);

    const { GET } = await import("../route");
    const plain = new Request(
      `${LOOPBACK}/api/agent-context/messages/${id}?wait_for=reply&wait_ms=not-a-number`,
      { headers: { "x-agent-id": "agent-a" } },
    ) as NextRequest;
    const res = await GET(plain, { params: Promise.resolve({ id }) });
    const body = await res.json();
    expect(body.timedOut).toBe(true);
    expect(mockFindReply).toHaveBeenCalledTimes(1);
  });
});
