import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Key } from "lucide-react";

vi.mock("@/lib/tool-auth/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tool-auth/providers")>();
  const testApiProvider = {
    key: "test-local-api",
    label: "Local Test API",
    icon: Key,
    description: "Coverage-only API key provider at docs.test.local.",
    category: "other" as const,
    authMode: "api-key" as const,
    apiKeyField: "Secret key",
    docsUrl: "https://docs.test.local/tools/api-key",
  };
  const unavailableOAuth = {
    key: "test-local-oauth",
    label: "Local OAuth Blocked",
    icon: Key,
    description: "OAuth provider blocked for coverage.",
    category: "other" as const,
    authMode: "oauth" as const,
    providerConfigKey: "test-local-oauth",
    scopes: ["read"],
    unavailableReason: "Missing client credentials in Nango (test.local)",
  };
  return {
    ...actual,
    PROVIDERS_BY_KEY: {
      ...actual.PROVIDERS_BY_KEY,
      [testApiProvider.key]: testApiProvider,
      [unavailableOAuth.key]: unavailableOAuth,
    },
    getGroupedProviders: () => [
      {
        category: actual.CATEGORIES.other,
        providers: [testApiProvider, unavailableOAuth],
      },
    ],
  };
});

import ConnectedToolsPage from "../page";
import { providerCard, stubToolsFetch, wrap } from "./test-helpers";

describe("ConnectedToolsPage unavailable OAuth provider", () => {
  beforeEach(() => {
    stubToolsFetch();
  });

  it("shows unavailable reason and disabled action", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("Local OAuth Blocked")).toBeInTheDocument();
      expect(
        screen.getByText(/Not connectable yet — Missing client credentials/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Unavailable$/i })).toBeDisabled();
    });
  });
});

describe("ConnectedToolsPage API key connect sheet", () => {
  beforeEach(() => {
    stubToolsFetch();
  });

  it("validates minimum key length and toggles visibility", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Local Test API")).toBeInTheDocument());

    fireEvent.click(
      within(providerCard(screen, "Local Test API")).getByRole("button", { name: /Connect/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Connect Local Test API/i })).toBeInTheDocument(),
    );

    const keyInput = screen.getByPlaceholderText(/Paste your API key/i);
    expect(keyInput).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: /Show API key/i }));
    expect(keyInput).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: /Hide API key/i }));

    fireEvent.change(keyInput, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /Save connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/API key must be at least 8 characters/i)).toBeInTheDocument();
    });
  });

  it("saves a valid API key and closes the sheet", async () => {
    let posted: string | undefined;
    stubToolsFetch({
      apiKeyConnect: async (body) => {
        posted = body;
        return { ok: true, json: async () => ({}) } as Response;
      },
    });

    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Local Test API")).toBeInTheDocument());
    fireEvent.click(
      within(providerCard(screen, "Local Test API")).getByRole("button", { name: /Connect/i }),
    );
    await waitFor(() => screen.getByPlaceholderText(/Paste your API key/i));

    fireEvent.change(screen.getByPlaceholderText(/Paste your API key/i), {
      target: { value: "test-local-secret-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save connection/i }));

    await waitFor(() => {
      expect(posted).toBeDefined();
      expect(JSON.parse(posted!)).toEqual({
        providerKey: "test-local-api",
        credentials: { apiKey: "test-local-secret-key" },
      });
      expect(screen.queryByRole("heading", { name: /Connect Local Test API/i })).not.toBeInTheDocument();
    });
  });

  it("shows API errors and supports cancel", async () => {
    stubToolsFetch({
      apiKeyConnect: async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({ error: "invalid_key", message: "Key rejected at test.local" }),
        }) as Response,
    });

    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Local Test API")).toBeInTheDocument());
    fireEvent.click(
      within(providerCard(screen, "Local Test API")).getByRole("button", { name: /Connect/i }),
    );
    await waitFor(() => screen.getByPlaceholderText(/Paste your API key/i));

    fireEvent.change(screen.getByPlaceholderText(/Paste your API key/i), {
      target: { value: "test-local-secret-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save connection/i }));
    await waitFor(() => {
      expect(screen.getByText("Key rejected at test.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /Connect Local Test API/i })).not.toBeInTheDocument(),
    );
  });

  it("surfaces network failures when saving an API key", async () => {
    stubToolsFetch({
      apiKeyConnect: async () => {
        throw new Error("vault unreachable");
      },
    });

    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Local Test API")).toBeInTheDocument());
    fireEvent.click(
      within(providerCard(screen, "Local Test API")).getByRole("button", { name: /Connect/i }),
    );
    await waitFor(() => screen.getByPlaceholderText(/Paste your API key/i));

    fireEvent.change(screen.getByPlaceholderText(/Paste your API key/i), {
      target: { value: "test-local-secret-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save connection/i }));
    await waitFor(() => {
      expect(screen.getByText("vault unreachable")).toBeInTheDocument();
    });
  });
});
