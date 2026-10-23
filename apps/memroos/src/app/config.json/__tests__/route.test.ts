import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /config.json", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns 403 without a valid understand token", async () => {
    vi.stubEnv("UNDERSTAND_GRAPH_TOKEN", "secret-token.test.local");
    const { GET } = await import("../route");
    const res = await GET(new Request("https://example.test/config.json"));
    expect(res.status).toBe(403);
  });

  it("returns JSON config when token matches", async () => {
    vi.stubEnv("UNDERSTAND_GRAPH_TOKEN", "secret-token.test.local");
    const { GET } = await import("../route");
    const res = await GET(
      new Request("https://example.test/config.json?token=secret-token.test.local")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });
});
