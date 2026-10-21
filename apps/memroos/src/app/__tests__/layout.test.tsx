import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const headersMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("next/font/google", () => ({
  Inter: () => ({ className: "inter-font" }),
}));

vi.mock("../providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <div data-testid="providers">{children}</div>,
}));

vi.mock("@/components/layout/shell", () => ({
  Shell: ({ children, publicLandingHost }: { children: React.ReactNode; publicLandingHost: boolean }) => (
    <div data-testid="shell" data-public={String(publicLandingHost)}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/analytics/google-analytics", () => ({
  GoogleAnalyticsTracking: () => null,
}));

vi.mock("@/lib/schema", () => ({
  organizationSchema: () => ({}),
  JsonLd: () => null,
}));

import RootLayout from "../layout";

describe("RootLayout", () => {
  it("wraps children in shell and providers", async () => {
    headersMock.mockResolvedValue({
      get: (name: string) => (name === "host" ? "localhost:3000" : null),
    });

    const ui = await RootLayout({ children: <span>child content</span> });
    render(ui);

    expect(screen.getByTestId("providers")).toBeInTheDocument();
    expect(screen.getByTestId("shell")).toHaveAttribute("data-public", "false");
    expect(screen.getByText("child content")).toBeInTheDocument();
  });
});
