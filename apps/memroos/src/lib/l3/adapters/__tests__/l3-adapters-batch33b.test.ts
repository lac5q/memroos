// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNetSuiteAdapter } from "../netsuite";
import { createQuickBooksAdapter } from "../quickbooks";
import { createSalesforceAdapter } from "../salesforce";
import { createZendeskAdapter } from "../zendesk";

describe("L3 adapters batch33b", () => {
  const since = new Date("2026-06-01T12:00:00.000Z");
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.QUICKBOOKS_CLIENT_ID;
    delete process.env.QUICKBOOKS_CLIENT_SECRET;
    delete process.env.QUICKBOOKS_REFRESH_TOKEN;
    delete process.env.QUICKBOOKS_REALM_ID;
    process.env.NODE_ENV = "test";
  });

  it("quickbooks logs token refresh failures (85)", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh";
    process.env.QUICKBOOKS_REALM_ID = "realm-b33b";
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "denied" });
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
  });

  it("quickbooks logs invoice query failures (116)", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh";
    process.env.QUICKBOOKS_REALM_ID = "realm-b33b";
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-b33b" }) })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "busy" });
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
  });

  it("fixture adapters throw in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let netsuiteErr: unknown;
    let salesforceErr: unknown;
    let zendeskErr: unknown;
    try {
      await createNetSuiteAdapter().poll(since);
    } catch (e) {
      netsuiteErr = e;
    }
    try {
      await createSalesforceAdapter().poll(since);
    } catch (e) {
      salesforceErr = e;
    }
    try {
      await createZendeskAdapter().poll(since);
    } catch (e) {
      zendeskErr = e;
    }
    expect(netsuiteErr).toBeInstanceOf(Error);
    expect(salesforceErr).toBeInstanceOf(Error);
    expect(zendeskErr).toBeInstanceOf(Error);
    expect((netsuiteErr as Error).message).toMatch(/Fixture adapter/);
  });
});
