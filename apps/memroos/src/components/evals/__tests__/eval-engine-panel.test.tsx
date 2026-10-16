import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useEvalConfig: vi.fn(),
  useEvalHistory: vi.fn(),
  useUpdateEvalConfigMutation: vi.fn(),
  useRunEvalTraceMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useEvalConfig: api.useEvalConfig,
  useEvalHistory: api.useEvalHistory,
  useUpdateEvalConfigMutation: api.useUpdateEvalConfigMutation,
  useRunEvalTraceMutation: api.useRunEvalTraceMutation,
}));

vi.mock("../PresetSelector", () => ({
  PresetSelector: () => <div data-testid="preset-selector" />,
}));

import { EvalEnginePanel } from "../eval-engine-panel";

const CONFIG = {
  weights: { l1: 0.4, l2: 0.35, l3: 0.25 },
  judgeModel: {
    model: "llama3",
    provider: "ollama",
    modelFamily: "llama",
    promptTemplateVersion: "v1",
  },
};

describe("EvalEnginePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useUpdateEvalConfigMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useRunEvalTraceMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("shows config loading spinner", () => {
    api.useEvalConfig.mockReturnValue({ data: undefined, isLoading: true });
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false });
    const { container } = render(<EvalEnginePanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders judge model and empty run history", () => {
    api.useEvalConfig.mockReturnValue({ data: { config: CONFIG }, isLoading: false });
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false });

    render(<EvalEnginePanel />);
    expect(screen.getByText("Eval Config")).toBeInTheDocument();
    expect(screen.getByText("llama3")).toBeInTheDocument();
    expect(screen.getByText("No eval runs yet.")).toBeInTheDocument();
    expect(screen.getByTestId("preset-selector")).toBeInTheDocument();
  });
});
