/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configMutate = vi.hoisted(() => vi.fn());
const runMutate = vi.hoisted(() => vi.fn());

const api = vi.hoisted(() => ({
  useEvalConfig: vi.fn(),
  useEvalHistory: vi.fn(),
  useUpdateEvalConfigMutation: vi.fn(),
  useRunEvalTraceMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);
vi.mock("../PresetSelector", () => ({ PresetSelector: () => null }));

import { EvalEnginePanel } from "../eval-engine-panel";

const sampleRun = {
  id: `run-${randomUUID().slice(0, 6)}`,
  traceId: "trace-b30b",
  agentId: "agent-b30b",
  role: "ops",
  compositeW: 0.88,
  trusted: true,
  layers: {
    l1: { score: 0.8, weight: 0.25, scorers: [] },
    l2: { score: 0.85, weight: 0.5, scorers: [] },
    l3: { score: 0.9, weight: 0.25, scorers: [] },
  },
  scorerResults: [],
  judge: {
    score: 0.85,
    rubricScores: { faithful: 0.8, useful: 0.85, policy: 0.9 },
    model: "judge",
    provider: "local",
    modelFamily: "local",
    promptTemplateVersion: "v1",
    promptHash: "hash",
    positionBiasMitigation: { swapAugmentation: true, orderAgreement: true },
  },
  driftGuard: {
    status: "passed" as const,
    agreement: 0.93,
    floor: 0.85,
    goldenSetVersion: "golden-b30b",
    examples: [],
  },
  configHash: "config",
  goldenSetPath: "./golden.jsonl",
  startedAt: "2026-11-07T00:00:00.000Z",
  completedAt: "2026-11-07T00:00:01.000Z",
};

describe("EvalEnginePanel batch30b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useEvalConfig.mockReturnValue({
      data: {
        config: {
          judgeModel: { model: "judge", provider: "ollama", modelFamily: "llama", promptTemplateVersion: "v1" },
          weights: { l1: 0.2, l2: 0.3, l3: 0.5 },
        },
      },
      isLoading: false,
    });
    api.useEvalHistory.mockReturnValue({ data: { runs: [sampleRun] }, isLoading: false });
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

  it("saves valid weight edits", () => {
    render(<EvalEnginePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit weights" }));
    fireEvent.change(screen.getByDisplayValue("0.2"), { target: { value: "0.15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(configMutate).toHaveBeenCalledWith(
      expect.objectContaining({ weights: { l1: 0.15, l2: 0.3, l3: 0.5 } }),
      expect.any(Object),
    );
  });

  it("renders drift guard and run history rows", () => {
    render(<EvalEnginePanel />);
    expect(screen.getAllByText(/passed — 93% agreement/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/agent-b30b/)).toBeInTheDocument();
  });

  it("surfaces test-run errors and success payload", async () => {
    runMutate.mockImplementation((_input, opts) => {
      opts?.onError?.(new Error("string failure b30b"));
    });
    render(<EvalEnginePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Run test eval/i }));
    await waitFor(() => expect(screen.getByText("string failure b30b")).toBeInTheDocument());

    runMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({ result: sampleRun });
    });
    fireEvent.click(screen.getByRole("button", { name: /Run test eval/i }));
    await waitFor(() => expect(screen.getAllByText(/W=0.880/).length).toBeGreaterThan(0));
  });
});
