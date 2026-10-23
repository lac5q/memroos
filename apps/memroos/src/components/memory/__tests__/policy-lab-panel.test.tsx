import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useRunPolicyLabMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useRunPolicyLabMutation: api.useRunPolicyLabMutation,
}));

import { PolicyLabPanel } from "../policy-lab-panel";

describe("PolicyLabPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useRunPolicyLabMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      data: undefined,
    });
  });

  it("renders policy lab controls", () => {
    render(<PolicyLabPanel />);
    expect(screen.getByText("Memory Policy Lab")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run ranking" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/golden-sets/)).toBeInTheDocument();
  });

  it("shows parse error for invalid variants JSON", () => {
    render(<PolicyLabPanel />);
    const variantArea = document.querySelector("textarea");
    expect(variantArea).toBeTruthy();
    fireEvent.change(variantArea!, { target: { value: "not-json" } });
    fireEvent.click(screen.getByRole("button", { name: "Run ranking" }));
    expect(screen.getByText("Invalid JSON in variants field")).toBeInTheDocument();
  });

  it("renders ranked results when mutation succeeds", () => {
    api.useRunPolicyLabMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      data: {
        goldenSetId: "./golden-sets/business-ops-50.jsonl",
        ranked: [
          {
            rank: 1,
            name: "k=3 vector-only",
            compositeW: 0.82,
            layerScores: { l1: 0.9, l2: 0.8, l3: 0.7 },
            variantConfig: { k: 3 },
            evalRunId: "eval-1",
          },
        ],
      },
    });
    render(<PolicyLabPanel />);
    expect(screen.getByText(/W Rankings \(1 variants\)/)).toBeInTheDocument();
    expect(screen.getByText("k=3 vector-only")).toBeInTheDocument();
  });
});
