// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const getJobStatus = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/seal/behavioral-runner", () => ({
  getJobStatus: (...args: unknown[]) => getJobStatus(...args),
}));

const { GET } = await import("../route");

describe("GET /api/seal/jobs/[id]", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    getJobStatus.mockReset();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/seal/jobs/job-1") as never, {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns job status", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    getJobStatus.mockReturnValueOnce({ id: "job-1", status: "queued" });
    const res = await GET(new Request("http://localhost/api/seal/jobs/job-1") as never, {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).job.id).toBe("job-1");
  });

  it("returns 404 for unknown job", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    getJobStatus.mockReturnValueOnce(null);
    const res = await GET(new Request("http://localhost/api/seal/jobs/missing") as never, {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});
