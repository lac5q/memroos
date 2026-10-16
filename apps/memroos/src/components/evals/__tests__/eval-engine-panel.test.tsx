import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const RUN = {
  id: "run-1",
  traceId: "trace-1",
  agentId: "codex",
  role: "ops",
  compositeW: 0.912,
  trusted: true,
  layers: {
    l1: { score: 0.9, weight: 0.4 },
    l2: { score: 0.85, weight: 0.35 },
    l3: { score: 0.8, weight: 0.25 },
  },
  scorerResults: [],
  judge: {
    score: 0.88,
    rubricScores: { faithful: 0.9, useful: 0.85, policy: 0.88 },
  },
  driftGuard: {
    status: "passed" as const,
    agreement: 0.93,
    floor: 0.8,
    goldenSetVersion: "golden-set-v1",
    examples: [],
  },
  configHash: "hash",
  goldenSetPath: "/tmp/golden",
  startedAt: "2026-07-01T00:00:00.000Z",
  completedAt: "2026-07-01T00:00:01.000Z",
};

describe("EvalEnginePanel", () => {
  const configMutate = vi.fn();
  const runMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    api.useUpdateEvalConfigMutation.mockReturnValue({
      mutate: configMutate,
      isPending: false,
      isError: false,
      error: null,
    });
    api.useRunEvalTraceMutation.mockReturnValue({
      mutate: runMutate,
      isPending: false,
    });
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
    expect(screen.getByText(/No drift guard data yet/i)).toBeInTheDocument();
  });

  it("edits weights and shows drift guard + history rows", async () => {
    api.useEvalConfig.mockReturnValue({ data: { config: CONFIG }, isLoading: false });
    api.useEvalHistory.mockReturnValue({ data: { runs: [RUN] }, isLoading: false });

    render(<EvalEnginePanel />);
    expect(screen.getAllByText(/93% agreement/).length).toBeGreaterThan(0);
    expect(screen.getByText("codex")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit weights" }));
    fireEvent.change(screen.getByDisplayValue("0.4"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(configMutate).toHaveBeenCalledWith(
      expect.objectContaining({ weights: { l1: 0.5, l2: 0.35, l3: 0.25 } }),
      expect.any(Object),
    );
  });

  it("runs test eval and surfaces success and error callbacks", async () => {
    api.useEvalConfig.mockReturnValue({ data: { config: CONFIG }, isLoading: false });
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false });
    runMutate.mockImplementation((_input, opts: { onSuccess?: (data: { result: typeof RUN }) => void }) => {
      opts?.onSuccess?.({ result: RUN });
    });

    render(<EvalEnginePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Run test eval" }));
    await waitFor(() => expect(screen.getByText(/W=0\.912/)).toBeInTheDocument());

    runMutate.mockImplementation((_input, opts: { onError?: (err: Error) => void }) => {
      opts?.onError?.(new Error("Judge offline"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Run test eval" }));
    await waitFor(() => expect(screen.getByText("Judge offline")).toBeInTheDocument());
  });
});
