// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQuickBooksAdapter } from "../quickbooks";

describe("quickbooks adapter batch35", () => {
  const since = new Date("2026-11-12T00:00:00.000Z");
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oauth failed b35", { status: 401 })),
    );
    process.env.QUICKBOOKS_CLIENT_ID = "client-b35";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret-b35";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh-b35";
    process.env.QUICKBOOKS_REALM_ID = "realm-b35";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envSnapshot };
  });

  it("refreshAccessToken logs failures and returns null (85)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Token refresh failed/));
    errSpy.mockRestore();
  });

  it("fetchInvoicesFromQBO logs query failures (116)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at-b35" }), { status: 200 }))
        .mockResolvedValueOnce(new Response("invoice query failed b35", { status: 500 })),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Invoice query failed/));
    errSpy.mockRestore();
  });
});
