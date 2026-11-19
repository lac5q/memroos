// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { authorizeQuarantineWrite } from "../_auth";

describe("authorizeQuarantineWrite", () => {
  afterEach(() => {
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  it("allows loopback hosts without an operator key", () => {
    expect(authorizeQuarantineWrite(new Request("http://localhost/api/skills/quarantine/approve"))).toMatchObject({
      ok: true,
      operator: "loopback",
    });
    expect(
      authorizeQuarantineWrite(new Request("http://127.0.0.1/api/skills/quarantine/approve")) // pragma: allowlist secret
    ).toMatchObject({ ok: true, operator: "loopback" });
  });

  it("returns 401 when no operator key is configured on non-loopback hosts", async () => {
    const result = authorizeQuarantineWrite(new Request("https://memroos.example.com/api/skills/quarantine/approve"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toMatchObject({ ok: false });
    }
  });

  it("returns 403 when the operator key does not match", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";
    const result = authorizeQuarantineWrite(
      new Request("https://memroos.example.com/api/skills/quarantine/approve", {
        headers: { "x-memroos-operator-key": "wrong" },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it("accepts bearer operator keys on remote hosts", () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";
    expect(
      authorizeQuarantineWrite(
        new Request("https://memroos.example.com/api/skills/quarantine/approve", {
          headers: { authorization: "Bearer operator-secret" },
        })
      )
    ).toMatchObject({ ok: true, operator: "operator-key" });
  });
});
