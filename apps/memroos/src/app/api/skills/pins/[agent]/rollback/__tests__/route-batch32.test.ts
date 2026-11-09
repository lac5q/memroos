// @vitest-environment node
import { describe, expect, it } from "vitest";

const { POST } = await import("../route");

describe("POST /api/skills/pins/:agent/rollback batch32", () => {
  it("rejects missing agent path param (lines 44-45)", async () => {
    const res = await POST(
      new Request("http://localhost/api/skills/pins//rollback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skill_name: "s1", operator: "op" }),
      }),
      { params: Promise.resolve({ agent: "" }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "agent is required" });
  });
});
