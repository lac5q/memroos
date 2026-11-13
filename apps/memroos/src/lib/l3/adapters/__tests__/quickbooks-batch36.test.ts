// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { createQuickBooksAdapter } from "../quickbooks";

describe("quickbooks adapter batch36", () => {
  const since = new Date("2026-11-13T00:00:00.000Z");
  const envSnapshot = { ...process.env };
  const suffix = randomUUID().slice(0, 8);

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`oauth failed b36 ${suffix}`, { status: 401 })),
    );
    process.env.QUICKBOOKS_CLIENT_ID = `client-b36-${suffix}`;
    process.env.QUICKBOOKS_CLIENT_SECRET = `secret-b36-${suffix}`;
    process.env.QUICKBOOKS_REFRESH_TOKEN = `refresh-b36-${suffix}`;
    process.env.QUICKBOOKS_REALM_ID = `realm-b36-${suffix}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envSnapshot };
  });

  it("refreshAccessToken logs failures and returns null (85)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Token refresh failed 401/));
    errSpy.mockRestore();
  });

  it("fetchInvoicesFromQBO logs invoice query failures (116)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: `at-b36-${suffix}` }), { status: 200 }))
        .mockResolvedValueOnce(new Response(`invoice query failed b36 ${suffix}`, { status: 502 })),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Invoice query failed 502/));
    errSpy.mockRestore();
  });
});
