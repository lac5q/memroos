/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentRegistrationForm } from "../agent-registration-form";

describe("AgentRegistrationForm batch32", () => {
  it("toggles manual REST mode and A2A source selection (lines 134, 173)", () => {
    const onA2aSubmit = vi.fn();
    render(<AgentRegistrationForm onSubmit={vi.fn()} onA2aSubmit={onA2aSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
    fireEvent.click(screen.getByRole("button", { name: /A2A card URL/i }));
    fireEvent.click(screen.getByRole("button", { name: /Manual REST/i }));

    fireEvent.click(screen.getByRole("button", { name: /A2A card URL/i }));
    const tag = randomUUID().slice(0, 6);
    fireEvent.change(screen.getByLabelText(/A2A agent-card URL/i), {
      target: { value: `http://localhost:8001/.well-known/agent-card-${tag}.json` },
    });
    fireEvent.change(screen.getByLabelText(/A2A source/i), { target: { value: "a2a" } });
    fireEvent.click(screen.getByRole("button", { name: /Register A2A Agent/i }));

    expect(onA2aSubmit).toHaveBeenCalledWith({
      cardUrl: `http://localhost:8001/.well-known/agent-card-${tag}.json`,
      source: "a2a",
    });
  });
});
