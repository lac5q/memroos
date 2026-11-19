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
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 403 }),
}));

const { GET, POST } = await import("../route");

describe("/api/evidence/task-bundles", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("GET returns 400 without taskId", async () => {
    const res = await GET(new Request("http://localhost/api/evidence/task-bundles") as never);
    expect(res.status).toBe(400);
  });

  it("GET lists bundles for task", async () => {
    const res = await GET(new Request("http://localhost/api/evidence/task-bundles?taskId=task-1") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.bundles)).toBe(true);
  });

  it("POST returns 403 without operator auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/evidence/task-bundles", {
        method: "POST",
        body: JSON.stringify({ taskId: "task-1" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST creates bundle", async () => {
    const res = await POST(
      new Request("http://localhost/api/evidence/task-bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-1", status: "open", plan: ["step-1"] }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bundle.taskId).toBe("task-1");
  });
});
