import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/agents/agent-proposals-panel", () => ({
  AgentProposalsPanel: () => <div data-testid="agent-proposals-panel" />,
}));

import AgentAutogenPage from "../page";

describe("AgentAutogenPage", () => {
  it("renders autogen heading and proposals panel", () => {
    render(<AgentAutogenPage />);
    expect(screen.getByRole("heading", { name: "Agent Autogen" })).toBeInTheDocument();
    expect(screen.getByText(/Agent self-improvement proposals/i)).toBeInTheDocument();
    expect(screen.getByTestId("agent-proposals-panel")).toBeInTheDocument();
  });
});
