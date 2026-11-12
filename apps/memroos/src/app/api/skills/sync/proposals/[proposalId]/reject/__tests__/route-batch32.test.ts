// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const { POST } = await import("../route");

describe("POST /api/skills/sync/proposals/:id/reject batch32", () => {
  it("rejects array JSON bodies (lines 56-57)", async () => {
    const res = await POST(
      new Request("http://localhost/api/skills/sync/proposals/x/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ operator: "op", reason: "no" }]),
      }),
      { params: Promise.resolve({ proposalId: randomUUID() }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Body must be an object" });
  });
});
