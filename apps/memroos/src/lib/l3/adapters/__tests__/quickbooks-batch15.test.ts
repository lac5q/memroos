// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQuickBooksAdapter } from "../quickbooks";

const since = new Date("2026-06-01T00:00:00.000Z");

describe("quickbooks adapter batch15 — live error branches", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.QUICKBOOKS_CLIENT_ID;
    delete process.env.QUICKBOOKS_CLIENT_SECRET;
    delete process.env.QUICKBOOKS_REFRESH_TOKEN;
    delete process.env.QUICKBOOKS_REALM_ID;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty when OAuth credentials are incomplete", async () => {
    process.env.QUICKBOOKS_REALM_ID = "realm-1";
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty when token refresh fails", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh";
    process.env.QUICKBOOKS_REALM_ID = "realm-1";
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "denied" });
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
  });

  it("returns empty when invoice query fails", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh";
    process.env.QUICKBOOKS_REALM_ID = "realm-1";
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
  });

  it("skips invoices without memroos correlation custom field", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh";
    process.env.QUICKBOOKS_REALM_ID = "realm-1";
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          QueryResponse: {
            Invoice: [
              {
                Id: "inv-no-corr",
                Balance: 0,
                TotalAmt: 50,
                CustomField: [{ Name: "other_field", StringValue: "x" }],
                MetaData: { LastUpdatedTime: "2026-06-02T00:00:00Z" },
              },
            ],
          },
        }),
      });
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
  });
});
