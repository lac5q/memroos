/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentRegistrationForm } from "../agent-registration-form";

describe("AgentRegistrationForm batch25b", () => {
  function openAdvanced() {
    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
  }

  it("does not submit A2A mode when card URL is blank", () => {
    const onA2aSubmit = vi.fn();
    render(<AgentRegistrationForm onSubmit={vi.fn()} onA2aSubmit={onA2aSubmit} />);
    openAdvanced();
    fireEvent.click(screen.getByRole("button", { name: /A2A card URL/i }));
    fireEvent.click(screen.getByRole("button", { name: /Register A2A Agent/i }));
    expect(onA2aSubmit).not.toHaveBeenCalled();
  });

  it("submits manual registration with derived agent id", () => {
    const onSubmit = vi.fn();
    render(<AgentRegistrationForm onSubmit={onSubmit} />);
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/Agent name/i), { target: { value: "Batch25b Agent" } });
    fireEvent.change(screen.getByLabelText(/Agent role/i), { target: { value: "Worker" } });
    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "batch25b-agent", name: "Batch25b Agent", role: "Worker" }),
    );
  });
});
