/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdapterStatusPanel } from "../adapter-status-panel";

const useBusinessOutcomeEvents = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useBusinessOutcomeEvents: (...args: unknown[]) => useBusinessOutcomeEvents(...args),
}));

describe("AdapterStatusPanel batch38", () => {
  it("live window shows em dash for wired adapters with no matching events (216–224)", () => {
    useBusinessOutcomeEvents.mockReturnValue({
      data: {
        events: [
          {
            adapter: "intercom",
            polledAt: "2026-07-02T09:00:00.000Z",
          },
        ],
        timestamp: "2026-07-02T09:05:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<AdapterStatusPanel dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />);

    expect(document.querySelector('[data-adapter-events="hubspot"]')).toHaveTextContent("—");
    expect(document.querySelector('[data-adapter-events="intercom"]')).toHaveTextContent("1");
    expect(document.querySelector('[data-adapter-row-status="live"]')).toBeTruthy();
  });

  it("non-Error fetch failures render unknown error copy (161)", () => {
    useBusinessOutcomeEvents.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: "batch38 plain failure",
    });

    render(<AdapterStatusPanel dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />);

    expect(screen.getByText(/unknown error/i)).toBeInTheDocument();
    expect(document.querySelector("[data-adapter-events-status]")).toHaveTextContent("events: error");
  });

  it.skip("statusBadge default arm (93) — eventsEnvelope never emits stale/degraded/unavailable", () => {});
});