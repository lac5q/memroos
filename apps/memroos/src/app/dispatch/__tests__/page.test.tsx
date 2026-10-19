import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const searchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@/components/engagement/agent-engagement-console", () => ({
  AgentEngagementConsole: () => <div data-testid="engagement-console" />,
}));

vi.mock("@/components/orchestration/orchestration-hil-panel", () => ({
  OrchestrationHilPanel: () => <div data-testid="hil-panel" />,
}));

import DispatchPage from "../page";

describe("DispatchPage", () => {
  it("renders dispatch header and engagement panels", () => {
    searchParams.delete("from_window");
    render(<DispatchPage />);
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.getByTestId("engagement-console")).toBeInTheDocument();
    expect(screen.getByTestId("hil-panel")).toBeInTheDocument();
  });

  it("shows NOC drilldown banner when from_window is present", () => {
    searchParams.set("from_window", "24h");
    searchParams.set("from_workspace", "ops.test.local");
    render(<DispatchPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText(/window=24h/i)).toBeInTheDocument();
    searchParams.delete("from_window");
    searchParams.delete("from_workspace");
  });
});
