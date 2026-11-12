/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("EvalEnginePanel batch31", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false });
    api.useRunEvalTraceMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    api.useUpdateEvalConfigMutation.mockReturnValue({
      mutate: configMutate,
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it("startEditWeights is a no-op while config is loading (line 85)", () => {
    api.useEvalConfig.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    render(<EvalEnginePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit weights" }));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("rejects invalid weight saves and clears edit mode on success (lines 94-101)", async () => {
    api.useEvalConfig.mockReturnValue({
      data: {
        config: {
          judgeModel: { model: "judge", provider: "ollama", modelFamily: "llama", promptTemplateVersion: "v1" },
          weights: { l1: 0.2, l2: 0.3, l3: 0.5 },
        },
      },
      isLoading: false,
    });

    configMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.();
    });

    render(<EvalEnginePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit weights" }));
    const l1Input = screen.getAllByRole("spinbutton")[0]!;
    fireEvent.change(l1Input, { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(configMutate).not.toHaveBeenCalled();

    fireEvent.change(l1Input, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(configMutate).not.toHaveBeenCalled();

    fireEvent.change(l1Input, { target: { value: `0.18` } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(configMutate).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Edit weights" })).toBeInTheDocument();
  });
});
