// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const getJobStatus = vi.hoisted(() => vi.fn());
const getJobEvidence = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/seal/behavioral-runner", () => ({
  getJobStatus: (...args: unknown[]) => getJobStatus(...args),
  getJobEvidence: (...args: unknown[]) => getJobEvidence(...args),
}));

const { GET } = await import("../route");

describe("GET /api/seal/jobs/[id]/evidence", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    getJobStatus.mockReset();
    getJobEvidence.mockReset();
  });

  it("returns 401 without a session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/seal/jobs/job-1/evidence") as never, {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when evidence not yet available", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    getJobStatus.mockReturnValueOnce({ id: "job-1", status: "running" });
    getJobEvidence.mockReturnValueOnce(null);
    const res = await GET(new Request("http://localhost/api/seal/jobs/job-1/evidence") as never, {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns evidence bundle when persisted", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    getJobStatus.mockReturnValueOnce({ id: "job-1", status: "passed" });
    getJobEvidence.mockReturnValueOnce({ jobId: "job-1", agentId: "agent-1" });
    const res = await GET(new Request("http://localhost/api/seal/jobs/job-1/evidence") as never, {
      params: Promise.resolve({ id: "job-1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).evidence.jobId).toBe("job-1");
  });
});
