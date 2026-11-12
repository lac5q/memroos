import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../shell";

let mockPathname = "/dispatch";
const mockUseHealth = vi.hoisted(() => vi.fn(() => ({ data: { services: [] } })));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/lib/api-client", () => ({
  useHealth: mockUseHealth,
}));

vi.mock("../sidebar", () => ({
  Sidebar: ({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void }) => (
    <nav aria-label="Authenticated navigation">
      <span>{isOpen ? "sidebar-open" : "sidebar-closed"}</span>
      <button type="button" aria-label="Close menu" onClick={onClose}>
        Close
      </button>
    </nav>
  ),
}));

vi.mock("../top-bar", () => ({
  TopBar: ({ onMenuClick }: { onMenuClick?: () => void }) => (
    <header>
      <button type="button" aria-label="Open menu" onClick={onMenuClick}>
        Menu
      </button>
    </header>
  ),
}));

vi.mock("../section-tabs", () => ({
  SectionTabs: () => <div>SectionTabs</div>,
}));

vi.mock("../storage-panic-banner", () => ({
  StoragePanicBanner: () => null,
}));

describe("Shell batch21", () => {
  beforeEach(() => {
    mockPathname = "/dispatch";
  });

  it("opens and closes the mobile sidebar from TopBar menu interactions", () => {
    render(
      <Shell publicLandingHost={false}>
        <div>Dispatch page</div>
      </Shell>,
    );

    expect(screen.getByText("sidebar-closed")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Open menu"));
    expect(screen.getByText("sidebar-open")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close menu"));
    expect(screen.getByText("sidebar-closed")).toBeInTheDocument();
  });
});
