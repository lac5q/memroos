// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { createIntercomAdapter } from "../intercom";

describe("intercom adapter batch30 — live branch gaps", () => {
  const since = new Date("2026-06-01T12:00:00.000Z");
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.INTERCOM_ACCESS_TOKEN = `tok-${randomUUID()}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INTERCOM_ACCESS_TOKEN;
    delete process.env.INTERCOM_CORRELATION_FIELD;
  });

  it("logs and returns empty when conversations fetch is not ok (line 91)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "service down batch30",
    });
    const events = await createIntercomAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("skips conversations without a string correlation id (line 119)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        conversations: [
          {
            id: "c-skip",
            state: "open",
            custom_attributes: { memroos_correlation_id: 42 },
            tags: { tags: [] },
          },
          {
            id: "c-ok",
            state: "closed",
            custom_attributes: { memroos_correlation_id: `corr-${randomUUID()}` },
            conversation_rating: { rating: 4 },
            tags: { tags: [{ name: "Escalated" }] },
          },
        ],
      }),
    });
    const events = await createIntercomAdapter({ mock: false }).poll(since);
    expect(events.some((e) => e.rawJson.includes("c-skip"))).toBe(false);
    expect(events.some((e) => e.eventType === "escalation" && e.kpiValue === 0)).toBe(true);
  });
});
