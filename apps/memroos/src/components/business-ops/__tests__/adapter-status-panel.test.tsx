import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdapterStatusPanel } from "../adapter-status-panel";

const useBusinessOutcomeEvents = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useBusinessOutcomeEvents: (...args: unknown[]) => useBusinessOutcomeEvents(...args),
}));

describe("AdapterStatusPanel coverage", () => {
  it("shows loading and blocked envelope while events are fetching", () => {
    useBusinessOutcomeEvents.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<AdapterStatusPanel dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />);

    expect(screen.getByText(/Loading\.\.\./i)).toBeInTheDocument();
    expect(document.querySelector("[data-adapter-events-status]")).toHaveTextContent("events: loading");
    expect(document.querySelector("[data-adapter-reason]")).toHaveTextContent(/Loading \/api\/l3\/events/);
  });

  it("surfaces API errors and non-Error failures", () => {
    useBusinessOutcomeEvents.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("upstream 503"),
    });

    const { rerender } = render(
      <AdapterStatusPanel agentId="ops-agent" dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />,
    );
    expect(screen.getAllByText(/upstream 503/).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-adapter-source]")).toHaveTextContent("agentId=ops-agent");

    useBusinessOutcomeEvents.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: "plain string failure",
    });
    rerender(<AdapterStatusPanel dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />);
    expect(document.querySelector("[data-adapter-reason]")).toHaveTextContent(/Failed to load \/api\/l3\/events/);
  });

  it("aggregates live adapter events and updates last-polled ordering", () => {
    useBusinessOutcomeEvents.mockReturnValue({
      data: {
        events: [
          {
            adapter: "hubspot",
            polledAt: "2026-07-01T10:00:00.000Z",
          },
          {
            adapter: "hubspot",
            polledAt: "2026-07-01T12:00:00.000Z",
          },
          {
            adapter: "quickbooks",
            polledAt: "2026-07-01T11:00:00.000Z",
          },
        ],
        timestamp: "2026-07-01T12:05:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<AdapterStatusPanel dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />);

    expect(document.querySelector("[data-adapter-events-status]")).toHaveTextContent("events: live");
    expect(document.querySelector('[data-adapter-events="hubspot"]')).toHaveTextContent("2");
    expect(document.querySelector('[data-adapter-row-status="live"]')).toBeTruthy();
    expect(document.querySelector('[data-adapter-row="salesforce"]')).toHaveAttribute(
      "data-adapter-row-status",
      "blocked",
    );
  });

  it("shows empty-window copy when the events API returns no rows", () => {
    useBusinessOutcomeEvents.mockReturnValue({
      data: { events: [], timestamp: "2026-07-01T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });

    render(<AdapterStatusPanel />);
    expect(document.querySelector("[data-adapter-events-status]")).toHaveTextContent("events: no events");
    expect(document.querySelector('[data-adapter-events="hubspot"]')).toHaveTextContent("0 (no events)");
    expect(document.querySelector("[data-adapter-reason]")).toHaveTextContent(/returned no business-outcome events/);
  });
});
