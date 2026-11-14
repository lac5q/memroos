/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn() }));

import { VoicePanel } from "@/components/voice/VoicePanel";
import { useAgents } from "@/lib/api-client";

function mockAgents(agents: NonNullable<ReturnType<typeof useAgents>["data"]>["agents"]) {
  vi.mocked(useAgents).mockReturnValue({
    data: { agents },
  } as ReturnType<typeof useAgents>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgents([
    {
      id: `b37-${randomUUID().slice(0, 6)}`,
      name: "Voice B37",
      role: "Operator",
      company: null,
      platform: "local",
      protocol: "local",
      metadata: {},
    },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoicePanel batch37", () => {
  it("send() uses generic Error label for non-Error throws (295)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "voice-string-b37";
      }),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: "trigger b37 string throw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText(/⚠ Error/)).toBeInTheDocument());
  });

  it("does not send when input is whitespace only (275)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});