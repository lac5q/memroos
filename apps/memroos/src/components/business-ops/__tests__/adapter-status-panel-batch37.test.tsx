/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdapterStatusPanel } from "../adapter-status-panel";

const useBusinessOutcomeEvents = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useBusinessOutcomeEvents: (...args: unknown[]) => useBusinessOutcomeEvents(...args),
}));

describe("AdapterStatusPanel batch37", () => {
  it("marks per-adapter rows as error when the events envelope is error", () => {
    useBusinessOutcomeEvents.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("batch37 adapter outage"),
    });

    render(<AdapterStatusPanel dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />);
    expect(document.querySelector('[data-adapter-events-status="error"]')).toHaveTextContent(/events: error/i);
    expect(document.querySelector("[data-adapter-error]")).toHaveTextContent(/batch37 adapter outage/);
  });

  it.skip("statusBadge default arm (line 93) — eventsEnvelope never emits stale/degraded/unavailable", () => {});
});