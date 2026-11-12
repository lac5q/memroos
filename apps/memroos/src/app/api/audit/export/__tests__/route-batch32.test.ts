// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const streamAuditEntries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/audit/query", () => ({
  streamAuditEntries: (...args: unknown[]) => streamAuditEntries(...args),
}));

const operatorSession = {
  userId: "op-b32",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Op",
  tenantId: "default-tenant",
};

const { GET } = await import("../route");

describe("GET /api/audit/export batch32", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    streamAuditEntries.mockReset();
    authenticateUser.mockResolvedValue(operatorSession);
  });

  it("surfaces CSV stream iterator failures (line 87)", async () => {
    streamAuditEntries.mockImplementation(function* () {
      yield { id: "a1" };
      throw new Error("csv-stream-broken");
    });
    const res = await GET(new Request("http://localhost/api/audit/export?format=csv") as never);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await expect(async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    }).rejects.toThrow();
  });

  it("surfaces NDJSON stream iterator failures (line 110)", async () => {
    streamAuditEntries.mockImplementation(function* () {
      throw new Error("ndjson-stream-broken");
    });
    const res = await GET(new Request("http://localhost/api/audit/export?format=ndjson") as never);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await expect(reader.read()).rejects.toThrow();
  });
});
