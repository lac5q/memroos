import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredAgent } from "@/types";

const mutateRegister = vi.fn();
const mutateRegisterA2a = vi.fn();
const mutateDeregister = vi.fn();
const mutateInvite = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useRegisteredAgents: vi.fn(),
  useSecurityCapabilities: vi.fn(() => ({
    data: {
      summary: {
        totalAgents: 2,
        strictAgents: 0,
        standardAgents: 2,
        permissiveAgents: 0,
        agentsWithSecurityCapabilities: 0,
      },
      policies: {
        defaultMode: "standard",
        dispatchPolicy: "enforced",
        a2aPolicy: "enforced",
        memoryWritePolicy: "enforced",
      },
      agents: [],
      timestamp: "",
    },
    isLoading: false,
  })),
  useRegisterAgentMutation: vi.fn(() => ({ mutate: mutateRegister, isPending: false })),
  useRegisterA2aAgentCardMutation: vi.fn(() => ({ mutate: mutateRegisterA2a, isPending: false })),
  useCreateAgentOnboardingInviteMutation: vi.fn(() => ({ mutate: mutateInvite, isPending: false })),
  useDeregisterAgentMutation: vi.fn(() => ({ mutate: mutateDeregister, isPending: false })),
}));

import AgentRegistryPage from "@/app/agents/page";
import { useRegisteredAgents } from "@/lib/api-client";

const mockUseRegisteredAgents = vi.mocked(useRegisteredAgents);

const agents: RegisteredAgent[] = [
  {
    id: "rest-agent",
    name: "REST Agent",
    role: "Reports liveness",
    platform: "codex",
    protocol: "rest",
    status: "active",
    lastHeartbeat: "2026-05-05T06:00:00.000Z",
    currentTask: "checking in",
    lessonsCount: 0,
    todayMemoryCount: 0,
    location: "local",
    isRemote: false,
    latencyMs: null,
    capabilities: [{ id: "heartbeat", name: "Heartbeat", description: "", tags: [] }],
    metadata: {},
    host: null,
    port: null,
    healthEndpoint: null,
    tunnelUrl: null,
    createdAt: "2026-05-05T06:00:00.000Z",
    updatedAt: "2026-05-05T06:00:00.000Z",
    deregisteredAt: null,
  },
  {
    id: "adk-prime",
    name: "ADK Prime Agent",
    role: "Checks prime numbers",
    platform: "gemini",
    protocol: "a2a",
    status: "active",
    lastHeartbeat: "2026-05-05T06:05:00.000Z",
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    location: "tailscale",
    isRemote: true,
    latencyMs: 42,
    capabilities: [{ id: "check_prime", name: "Check Prime", description: "", tags: ["adk", "a2a"] }],
    metadata: {
      a2a: {
        cardUrl: "https://user:pass@example.test/.well-known/agent-card.json",
        endpointUrl: "https://user:pass@example.test/a2a/check_prime_agent",
        version: "1.0",
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          apiKeyAuth: { type: "apiKey", in: "header", name: "Authorization" },
        },
        inputModes: ["text"],
        outputModes: ["text"],
        validationStatus: "validated",
        lastFetchedAt: "2026-05-05T06:04:00.000Z",
        source: "adk",
        outboundAuth: { envKey: "REMOTE_A2A_TOKEN", token: "Bearer leaked", apiKey: "ak_leaked" },
      },
    },
    host: "worker.tailnet",
    port: 8001,
    healthEndpoint: "/.well-known/agent-card.json",
    tunnelUrl: null,
    createdAt: "2026-05-05T06:00:00.000Z",
    updatedAt: "2026-05-05T06:00:00.000Z",
    deregisteredAt: null,
  },
];

describe("AgentRegistryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRegisteredAgents.mockReturnValue({ data: { agents, timestamp: "" }, isLoading: false } as ReturnType<typeof useRegisteredAgents>);
  });

  it("lists registered agents with capabilities, status, heartbeat, and protocol", () => {
    render(<AgentRegistryPage />);

    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText("REST Agent")).toBeInTheDocument();
    expect(screen.getAllByText("rest").length).toBeGreaterThan(0);
    expect(screen.getAllByText("active").length).toBeGreaterThan(0);
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
    expect(screen.getByText("Last Heartbeat")).toBeInTheDocument();
  });

  it("submits registration and can deregister an agent", () => {
    render(<AgentRegistryPage />);

    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "New Agent" } });
    fireEvent.change(screen.getByLabelText("Agent role"), { target: { value: "Does work" } });
    fireEvent.change(screen.getByLabelText("Agent capabilities"), { target: { value: "Memory, Tools" } });
    fireEvent.click(screen.getByText("Register"));

    expect(mutateRegister).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-agent", protocol: "rest" }),
      expect.any(Object)
    );

    fireEvent.click(screen.getAllByText("Deregister")[0]);
    expect(mutateDeregister).toHaveBeenCalledWith("rest-agent");
  });

  it("creates a generic invite command for the selected platform", () => {
    render(<AgentRegistryPage />);

    expect(screen.getByLabelText("Agent platform")).toHaveTextContent("Cursor");
    fireEvent.change(screen.getByLabelText("Agent platform"), { target: { value: "pi" } });
    fireEvent.click(screen.getByText("Copy Invite"));

    expect(mutateInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "pi",
        protocol: "rest",
        ttlMinutes: 60,
        mcpTarget: "auto",
      }),
      expect.any(Object)
    );
  });

  it("copies an LLM-ready onboarding prompt when an invite is created", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<AgentRegistryPage />);

    fireEvent.click(screen.getByText("Copy Invite"));

    const [, options] = mutateInvite.mock.calls[0];
    await options.onSuccess({ command: "curl -fsSL 'https://memroos.example.test/invite' | bash" });

    await waitFor(() => {
      expect(screen.getByText("Onboarding prompt copied to clipboard.")).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Run this MemroOS onboarding command exactly as written.")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("infer your agent identity when no name is provided")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Command to run:\n```bash\ncurl -fsSL 'https://memroos.example.test/invite' | bash\n```")
    );
    expect(writeText).not.toHaveBeenCalledWith(
      expect.stringContaining("<PASTE COPIED INVITE COMMAND HERE>")
    );
    expect(screen.getByText(/Command to run:/)).toHaveTextContent(
      "curl -fsSL 'https://memroos.example.test/invite' | bash"
    );
    expect(screen.getByText("Agent onboarding prompt")).toBeInTheDocument();
  });

  it("copies the invite with a DOM fallback when the clipboard API is unavailable", async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    render(<AgentRegistryPage />);

    fireEvent.click(screen.getByText("Copy Invite"));

    const [, options] = mutateInvite.mock.calls[0];
    await options.onSuccess({ command: "curl -fsSL 'https://memroos.example.test/invite' | bash" });

    await waitFor(() => {
      expect(screen.getByText("Onboarding prompt copied to clipboard.")).toBeInTheDocument();
    });
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("supports A2A card registration mode", () => {
    render(<AgentRegistryPage />);

    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.click(screen.getByText("A2A card URL"));
    expect(screen.getByText("Register A2A Agent")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("A2A agent-card URL"), {
      target: { value: "http://localhost:8001/a2a/check_prime_agent/.well-known/agent-card.json" },
    });
    fireEvent.click(screen.getByText("Register A2A Agent"));

    expect(mutateRegisterA2a).toHaveBeenCalledWith(
      expect.objectContaining({
        cardUrl: "http://localhost:8001/a2a/check_prime_agent/.well-known/agent-card.json",
        source: "adk",
      }),
      expect.any(Object)
    );
  });

  it("renders A2A/ADK metadata without credential-bearing strings", () => {
    render(<AgentRegistryPage />);

    expect(screen.getAllByText("ADK").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("ADK Prime Agent"));

    expect(screen.getByText("Last validation")).toBeInTheDocument();
    expect(screen.getAllByText("example.test").length).toBeGreaterThan(0);
    expect(screen.queryByText(/user:pass@/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Authorization/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bearer /)).not.toBeInTheDocument();
    expect(screen.queryByText(/ak_/)).not.toBeInTheDocument();
  });

  it("shows loading spinner while agents are fetching", () => {
    mockUseRegisteredAgents.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as ReturnType<typeof useRegisteredAgents>);
    render(<AgentRegistryPage />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows API error banner when registry fetch fails", () => {
    mockUseRegisteredAgents.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("upstream timeout"),
    } as ReturnType<typeof useRegisteredAgents>);
    render(<AgentRegistryPage />);
    expect(screen.getByText(/Failed to load \/api\/agents/i)).toBeInTheDocument();
    expect(screen.getByText(/upstream timeout/)).toBeInTheDocument();
  });

  it("filters agents by protocol and shows empty-state guidance", () => {
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "a2a", exact: true }));
    expect(screen.getByText("ADK Prime Agent")).toBeInTheDocument();
    expect(screen.queryByText("REST Agent")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ui", exact: true }));
    expect(screen.getByText("No registered agents match this view.")).toBeInTheDocument();
    expect(screen.getByText(/Adjust the protocol, status, or liveness filters/i)).toBeInTheDocument();
  });

  it("surfaces invite errors with operator-key guidance", async () => {
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByText("Copy Invite"));
    const [, options] = mutateInvite.mock.calls[0];
    options.onError(new Error("Registry write authorization required"));
    await waitFor(() => {
      expect(screen.getByText(/Operator key required/i)).toBeInTheDocument();
    });
  });

  it("stores one-time API keys after registration succeeds", async () => {
    render(<AgentRegistryPage />);

    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Keyed Agent" } });
    fireEvent.change(screen.getByLabelText("Agent role"), { target: { value: "Stores key" } });
    fireEvent.click(screen.getByText("Register"));
    const [, registerOptions] = mutateRegister.mock.calls.at(-1)!;
    registerOptions.onSuccess({ apiKey: "one-time-key-123" });
    await waitFor(() => {
      expect(screen.getByText("one-time-key-123")).toBeInTheDocument();
    });
  });

  it("handles invite responses without commands and clipboard failures", async () => {
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByText("Copy Invite"));
    const [, inviteOptions] = mutateInvite.mock.calls.at(-1)!;
    await inviteOptions.onSuccess({});
    await waitFor(() => {
      expect(screen.getByText(/Invite response did not include a command/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Copy Invite"));
    const [, secondInviteOptions] = mutateInvite.mock.calls.at(-1)!;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    await secondInviteOptions.onSuccess({ command: "curl http://localhost/invite" });
    await waitFor(() => {
      expect(screen.getByText(/Copy it from the box below/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(screen.getByText(/Clipboard unavailable/i)).toBeInTheDocument();
    });
  });

  it("filters agents by status selection", () => {
    render(<AgentRegistryPage />);
    fireEvent.click(document.querySelector('[data-filter-value="idle"]')!);
    expect(screen.getByText(/No registered agents match this view/i)).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-filter-value="active"]')!);
    expect(screen.getByText("REST Agent")).toBeInTheDocument();
  });

  it("renders liveness and readiness banners when envelopes are present", () => {
    mockUseRegisteredAgents.mockReturnValue({
      data: {
        agents,
        timestamp: "",
        summary: {
          total: { value: 2, status: "live", source: "registry" },
          active: { value: 2, status: "live", source: "registry" },
        },
        liveness: { value: 2, status: "live", source: "heartbeat", reason: "fresh" },
        protocols: {
          rest: { value: 1, status: "live" },
          a2a: { value: 1, status: "live" },
          ui: { value: 0, status: "zero" },
          local: { value: 0, status: "zero" },
        },
        readiness: {
          average: { value: 0.9, status: "live", source: "registry" },
          withCapabilities: { value: 2, status: "live", source: "registry" },
        },
        localRuntime: {
          metric: { value: 1, status: "live", source: "scan", reason: null },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useRegisteredAgents>);
    render(<AgentRegistryPage />);
    expect(screen.getByTestId("agents-liveness-banner")).toHaveTextContent(/Liveness/i);
    expect(screen.getByText(/Readiness:/)).toBeInTheDocument();
    expect(screen.getByText(/Local runtime scan:/)).toBeInTheDocument();
  });
});
