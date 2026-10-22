import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mutate = vi.fn();

const api = vi.hoisted(() => ({
  useEvalConfig: vi.fn(),
  useSetActivePresetMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useEvalConfig: api.useEvalConfig,
  useSetActivePresetMutation: () => ({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { PresetSelector } from "../PresetSelector";

describe("PresetSelector", () => {
  beforeEach(() => {
    mutate.mockClear();
    api.useEvalConfig.mockReturnValue({
      isLoading: false,
      data: {
        config: {
          activePreset: "balanced",
          weightPresets: {
            balanced: { l1: 0.4, l2: 0.35, l3: 0.25 },
            recall: { l1: 0.5, l2: 0.3, l3: 0.2 },
          },
        },
      },
    });
  });

  it("renders preset dropdown and active weight badges", () => {
    render(<PresetSelector />);
    expect(screen.getByText("Weight Preset")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("balanced");
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("mutates when selecting a different preset", () => {
    render(<PresetSelector />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "recall" } });
    expect(mutate).toHaveBeenCalledWith("recall");
  });

  it("returns null while loading", () => {
    api.useEvalConfig.mockReturnValue({ isLoading: true, data: undefined });
    const { container } = render(<PresetSelector />);
    expect(container.firstChild).toBeNull();
  });
});
