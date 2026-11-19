// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

const { POST } = await import("../route");

const validBody = {
  source: "claude" as const,
  agentId: "agent-1",
  userId: "user-1",
  content: "remember this fact\n",
  memoryPath: "~/.claude/projects/memory.md",
};

describe("POST /api/native-memory/ingest", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "op-1",
      role: "operator",
      email: "op@example.com",
    });
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const req = new Request("http://localhost/api/native-memory/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid json", async () => {
    const req = new Request("http://localhost/api/native-memory/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when validation fails", async () => {
    const req = new Request("http://localhost/api/native-memory/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, source: "invalid" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns ingest result for operator session", async () => {
    const req = new Request("http://localhost/api/native-memory/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.replay).toBe(validBody.content);
    expect(body.policy.neverDelete).toBe(true);
  });

  it("400 when JSON body is invalid", async () => {
    const req = new Request("http://localhost/api/native-memory/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("accepts operator API key bearer", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    process.env.MEMROOS_OPERATOR_API_KEY = "ingest-key";
    const req = new Request("http://localhost/api/native-memory/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer ingest-key",
      },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });
});
