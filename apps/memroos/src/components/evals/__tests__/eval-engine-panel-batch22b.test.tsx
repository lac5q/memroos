/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useEvalConfig: vi.fn(),
  useEvalHistory: vi.fn(),
  useUpdateEvalConfigMutation: vi.fn(),
  useRunEvalTraceMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);

vi.mock("../PresetSelector", () => ({ PresetSelector: () => <div data-testid="preset-selector-batch22b" /> }));

import { EvalEnginePanel } from "../eval-engine-panel";

const baseConfig = {
  judgeModel: {
    model: "judge-batch22b",
    provider: "ollama",
    modelFamily: "llama",
    promptTemplateVersion: "v1",
  },
  weights: { l1: 0.2, l2: 0.3, l3: 0.5 },
};

const configMutate = vi.fn();
const runMutate = vi.fn(
  (_trace: unknown, opts: { onError: (err: Error) => void; onSuccess?: (data: unknown) => void }) => {
    opts.onError(new Error("eval run batch22b failed"));
  },
);

describe("EvalEnginePanel batch22b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMutate.mockReset();
    api.useEvalConfig.mockReturnValue({ data: { config: baseConfig }, isLoading: false });
    api.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            id: "run-1",
            agentId: "agent-batch22b",
            compositeW: 0.812,
            completedAt: "2026-07-01T12:00:00.000Z",
            layers: { l1: { score: 0.8 }, l2: { score: 0.7 }, l3: { score: 0.9 } },
            driftGuard: { status: "halted", agreement: 0.62, floor: 0.7, goldenSetVersion: "golden-batch22b" },
          },
        ],
      },
      isLoading: false,
    });
    api.useUpdateEvalConfigMutation.mockReturnValue({
      mutate: configMutate,
      isPending: false,
      isError: false,
      error: null,
    });
    runMutate.mockClear();
    api.useRunEvalTraceMutation.mockReturnValue({
      mutate: runMutate,
      isPending: false,
    });
  });

  it("edits weights, shows drift guard halted badge, and surfaces run errors", async () => {
    render(<EvalEnginePanel />);
    expect(screen.getByTestId("preset-selector-batch22b")).toBeInTheDocument();
    expect(screen.getAllByText(/halted/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/golden-b/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit weights" }));
    fireEvent.change(screen.getByDisplayValue("0.2"), { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(configMutate).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Run test eval/i }));
    expect(runMutate).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/eval run batch22b failed/i)).toBeInTheDocument());
  });
});
