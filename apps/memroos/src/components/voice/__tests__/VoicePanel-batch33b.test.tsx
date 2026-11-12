/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn() }));

import { VoicePanel } from "@/components/voice/VoicePanel";
import { useAgents } from "@/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAgents).mockReturnValue({
    data: {
      agents: [
        {
          id: `voice-b33b-${randomUUID().slice(0, 8)}`,
          name: "Voice Batch33b",
          role: "Engineer",
          company: null,
          platform: "claude",
          protocol: "local",
          metadata: {},
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
});

describe("VoicePanel batch33b", () => {
  it("send() ignores whitespace-only messages (line 275)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
