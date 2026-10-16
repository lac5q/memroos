import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  BackgroundVariant: { Dots: "dots" },
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

import { ReactFlowCanvas } from "../react-flow-canvas";

describe("ReactFlowCanvas", () => {
  it("mounts React Flow with agent stats", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={2}
        activeCount={1}
        memoryCount={5}
        knowledgeCount={10}
        nodeActivity={{}}
        registeredAgents={[
          {
            id: "agent-1",
            name: "Agent One",
            status: "active",
            latencyMs: 12,
            location: "local",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByText("Live topology")).toBeInTheDocument();
    expect(screen.getByText(/15 nodes/)).toBeInTheDocument();
  });

  it("renders topology without registered agents", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        nodeActivity={{}}
        registeredAgents={[]}
      />,
    );
    expect(screen.getByText("Live topology")).toBeInTheDocument();
    expect(screen.getByText(/nodes/)).toBeInTheDocument();
  });
});
