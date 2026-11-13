// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { createHubSpotAdapter } from "../hubspot";
import { createIntercomAdapter } from "../intercom";
import { createQuickBooksAdapter } from "../quickbooks";

function responseWithRejectingText(status: number): Response {
  return {
    ok: false,
    status,
    text: () => Promise.reject(new Error(`text-fail-${randomUUID().slice(0, 6)}`)),
    json: async () => ({}),
  } as unknown as Response;
}

describe("l3 adapters batch36 — text().catch fallbacks", () => {
  const since = new Date("2026-11-12T00:00:00.000Z");
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envSnapshot };
  });

  it("quickbooks token refresh uses empty text when body read rejects (85)", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "qb-b36";
    process.env.QUICKBOOKS_CLIENT_SECRET = "sec-b36";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "rt-b36";
    process.env.QUICKBOOKS_REALM_ID = "realm-b36";
    vi.mocked(fetch).mockResolvedValueOnce(responseWithRejectingText(401));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Token refresh failed 401:/));
    errSpy.mockRestore();
  });

  it("quickbooks invoice query uses empty text when body read rejects (116)", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "qb-b36";
    process.env.QUICKBOOKS_CLIENT_SECRET = "sec-b36";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "rt-b36";
    process.env.QUICKBOOKS_REALM_ID = "realm-b36";
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at-b36" }), { status: 200 }))
      .mockResolvedValueOnce(responseWithRejectingText(503));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Invoice query failed 503:/));
    errSpy.mockRestore();
  });

  it("intercom conversations fetch uses empty text when body read rejects (91)", async () => {
    process.env.INTERCOM_ACCESS_TOKEN = `tok-b36-${randomUUID()}`;
    vi.mocked(fetch).mockResolvedValueOnce(responseWithRejectingText(502));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createIntercomAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Conversations fetch failed/));
    errSpy.mockRestore();
  });

  it("hubspot deal search uses empty text when body read rejects (91)", async () => {
    process.env.HUBSPOT_ACCESS_TOKEN = `hs-b36-${randomUUID()}`;
    vi.mocked(fetch).mockResolvedValueOnce(responseWithRejectingText(500));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await createHubSpotAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Deal search failed/));
    errSpy.mockRestore();
  });
});
