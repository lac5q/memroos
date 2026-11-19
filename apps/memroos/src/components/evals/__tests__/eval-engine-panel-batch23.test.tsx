/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configMutate = vi.hoisted(() => vi.fn());

const api = vi.hoisted(() => ({
  useEvalConfig: vi.fn(),
  useEvalHistory: vi.fn(),
  useUpdateEvalConfigMutation: vi.fn(),
  useRunEvalTraceMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);
vi.mock("../PresetSelector", () => ({ PresetSelector: () => null }));

import { EvalEnginePanel } from "../eval-engine-panel";

const baseConfig = {
  judgeModel: { model: "judge-batch23", provider: "ollama", modelFamily: "llama", promptTemplateVersion: "v1" },
  weights: { l1: 0.2, l2: 0.3, l3: 0.5 },
};

describe("EvalEnginePanel batch23", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useEvalConfig.mockReturnValue({ data: { config: baseConfig }, isLoading: false });
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false });
    api.useUpdateEvalConfigMutation.mockReturnValue({
      mutate: configMutate,
      isPending: false,
      isError: true,
      error: new Error("save failed batch23"),
    });
    api.useRunEvalTraceMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("cancels weight edits and rejects invalid numeric weights", () => {
    render(<EvalEnginePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit weights" }));
    fireEvent.change(screen.getByDisplayValue("0.2"), { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(configMutate).not.toHaveBeenCalled();

    expect(screen.getByText(/save failed batch23/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByDisplayValue("not-a-number")).not.toBeInTheDocument();
  });

  it("shows config unavailable when config query returns empty", () => {
    api.useEvalConfig.mockReturnValue({ data: undefined, isLoading: false });
    render(<EvalEnginePanel />);
    expect(screen.getByText("Config unavailable")).toBeInTheDocument();
  });
});
