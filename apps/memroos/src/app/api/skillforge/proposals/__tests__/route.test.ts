// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
}));

vi.mock("@/lib/skillforge/operator-approval", () => ({
  listProposals: vi.fn(() => ({ pending: [], approved: [] })),
  applyApprovalAction: vi.fn(() => ({ success: true })),
  getProposal: vi.fn(() => ({ id: "p1", status: "approved" })),
}));

const { GET, PATCH } = await import("../route");

describe("/api/skillforge/proposals", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("GET returns 401 without operator auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    expect((await GET(new Request("http://localhost/api/skillforge/proposals") as never)).status).toBe(401);
  });

  it("GET lists proposals", async () => {
    const res = await GET(new Request("http://localhost/api/skillforge/proposals") as never);
    expect(res.status).toBe(200);
  });

  it("PATCH returns 400 without proposalId", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/skillforge/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });
});
