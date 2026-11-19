// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("nango-client batch15 — fetchNangoCredentials", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("NANGO_SECRET_KEY", "test-secret-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns access token and expiry from Nango connection payload", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          credentials: { access_token: "tok-live", expires_at: "2026-12-31T00:00:00Z" },
        }),
    })) as typeof fetch;

    const { fetchNangoCredentials } = await import("../nango-client");
    const creds = await fetchNangoCredentials("conn-1", "linear");
    expect(creds).toEqual({
      accessToken: "tok-live",
      expiresAt: "2026-12-31T00:00:00Z",
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain(encodeURIComponent("conn-1"));
    expect(url).toContain(encodeURIComponent("linear"));
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-secret-key" });
  });

  it("returns null when Nango responds 404", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => "not found",
    })) as typeof fetch;

    const { fetchNangoCredentials } = await import("../nango-client");
    await expect(fetchNangoCredentials("missing", "linear")).resolves.toBeNull();
  });

  it("rethrows upstream errors other than 404", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "upstream down",
    })) as typeof fetch;

    const { fetchNangoCredentials, ToolAuthUpstreamError } = await import("../nango-client");
    await expect(fetchNangoCredentials("conn-2", "linear")).rejects.toBeInstanceOf(ToolAuthUpstreamError);
  });
});
