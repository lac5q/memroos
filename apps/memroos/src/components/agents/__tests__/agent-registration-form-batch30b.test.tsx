/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentRegistrationForm } from "../agent-registration-form";

describe("AgentRegistrationForm batch30b", () => {
  it("skips manual submit when role is blank", () => {
    const onSubmit = vi.fn();
    render(<AgentRegistrationForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
    fireEvent.change(screen.getByLabelText(/Agent name/i), {
      target: { value: `Agent ${randomUUID().slice(0, 4)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Register$/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fires create-invite with selected platform", () => {
    const onCreateInvite = vi.fn();
    render(<AgentRegistrationForm onSubmit={vi.fn()} onCreateInvite={onCreateInvite} />);
    fireEvent.change(screen.getByLabelText(/Agent platform/i), { target: { value: "qwen" } });
    fireEvent.click(screen.getByRole("button", { name: /Copy Invite/i }));
    expect(onCreateInvite).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "qwen", protocol: "rest", ttlMinutes: 60 }),
    );
  });
});
