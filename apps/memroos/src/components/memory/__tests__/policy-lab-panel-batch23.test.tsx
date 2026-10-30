/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useRunPolicyLabMutation: vi.fn(),
}));

import { useRunPolicyLabMutation } from "@/lib/api-client";
import { PolicyLabPanel } from "../policy-lab-panel";

describe("PolicyLabPanel batch23", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRunPolicyLabMutation).mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: undefined,
    } as ReturnType<typeof useRunPolicyLabMutation>);
  });

  it("passes trimmed golden set id into the ranking mutation", () => {
    render(<PolicyLabPanel />);
    fireEvent.change(screen.getByPlaceholderText(/golden-sets/i), {
      target: { value: "  ./golden-sets/batch23.jsonl  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run ranking" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ goldenSetId: "./golden-sets/batch23.jsonl" }),
    );
  });
});
