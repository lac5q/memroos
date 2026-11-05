/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useRunPolicyLabMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useRunPolicyLabMutation: api.useRunPolicyLabMutation,
}));

import { PolicyLabPanel } from "../policy-lab-panel";

describe("PolicyLabPanel batch16", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useRunPolicyLabMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
    });
  });

  it("rejects empty variant arrays before calling the mutation", () => {
    render(<PolicyLabPanel />);
    const variantArea = document.querySelector("textarea");
    fireEvent.change(variantArea!, { target: { value: "[]" } });
    fireEvent.click(screen.getByRole("button", { name: "Run ranking" }));
    expect(screen.getByText("variants must be a non-empty array")).toBeInTheDocument();
  });

  it("expands ranked rows to show variant JSON and eval run id", () => {
    api.useRunPolicyLabMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: {
        goldenSetId: "./golden-sets/batch16.jsonl",
        ranked: [
          {
            rank: 2,
            name: "batch16 silver",
            compositeW: 0.71,
            layerScores: { l1: 0.7, l2: 0.72, l3: 0.69 },
            variantConfig: { k: 4, tiers: ["vector"] },
            evalRunId: "eval-batch16-silver",
          },
        ],
      },
    });

    render(<PolicyLabPanel />);
    expect(screen.getByText("batch16 silver")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "▼" }));
    expect(screen.getByText(/eval-batch16-silver/)).toBeInTheDocument();
    expect(screen.getByText(/"k": 4/)).toBeInTheDocument();
  });

  it("shows mutation error messages", () => {
    api.useRunPolicyLabMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("batch16 ranking failed"),
      data: undefined,
    });
    render(<PolicyLabPanel />);
    expect(screen.getByText("batch16 ranking failed")).toBeInTheDocument();
  });
});
