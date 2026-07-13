import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/app.js"), "utf8");

const voucher = (overrides = {}) => ({
  id: "internal-voucher-id",
  code: "WIFI-1234",
  status: 0,
  assignedAt: "2026-07-09T08:00:00.000Z",
  expirationDate: "2026-07-10T08:00:00.000Z",
  isActive: true,
  voucherGroupId: "internal-group-id",
  packageId: "internal-package-id",
  packageName: "Daily Access",
  usedQuota: 0,
  totalQuota: 1024,
  ...overrides,
});

const success = (active = [], past = []) => ({
  success: true,
  vouchers: { active, past },
});

const loadApp = () => {
  new Function(source)();
};

const click = (element) => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

describe("My Vouchers UI", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="auth-section"></section>
      <section id="captive-section"></section>
      <span id="step1-indicator"></span>
      <span id="step2-indicator"></span>
      <span id="logged-user-email"></span>
      <form id="auth-form"></form>
      <div id="auth-error-message" class="hidden"></div>
      <div id="oper-hint" class="hidden"></div>
      <div id="loading-overlay" class="hidden"></div>
      <div id="captive-success-message" class="hidden"></div>
      <div id="voucher-list-embedded"></div>
    `;
    sessionStorage.clear();
    sessionStorage.setItem(
      "authUser",
      JSON.stringify({ email: "crew@example.com" }),
    );
    window.altonautApi = {
      getMyVouchers: vi.fn(),
    };
    window.submitVoucherAuth = vi.fn();
    loadApp();
  });

  it("renders server order, tab counts, nullable fields, and unknown statuses", async () => {
    window.altonautApi.getMyVouchers.mockResolvedValue(
      success(
        [
          voucher({ code: "NEWEST", packageName: "Newest package" }),
          voucher({ code: "OLDER", packageName: "Older package" }),
        ],
        [
          voucher({
            id: "past-private-id",
            voucherGroupId: "past-private-group",
            packageId: "past-private-package",
            code: "PAST-CODE",
            packageName: null,
            status: 99,
            assignedAt: null,
            expirationDate: null,
            isActive: false,
          }),
        ],
      ),
    );

    await window.refreshMyVouchers();

    const tabs = document.querySelectorAll('[role="tab"]');
    expect(tabs[0].textContent).toBe("Active (2)");
    expect(tabs[1].textContent).toBe("Past (1)");
    expect(document.body.textContent.indexOf("Newest package")).toBeLessThan(
      document.body.textContent.indexOf("Older package"),
    );
    expect(document.body.textContent).not.toContain("NEWEST");
    expect(document.body.textContent).not.toContain("OLDER");

    click(tabs[1]);
    expect(document.body.textContent).toContain("Unknown package");
    expect(document.body.textContent).toContain("Unknown");
    expect(document.body.textContent).toContain("Not assigned");
    expect(document.body.textContent).toContain("Does not expire");
    expect(document.body.textContent).not.toContain("past-private-id");
    expect(document.body.textContent).not.toContain("past-private-group");
    expect(document.body.textContent).not.toContain("past-private-package");
    expect(document.querySelectorAll("button")).toHaveLength(2);
  });

  it("supports keyboard tab navigation and per-tab empty states", async () => {
    window.altonautApi.getMyVouchers.mockResolvedValue(success());

    await window.refreshMyVouchers();
    expect(document.body.textContent).toContain("You have no active vouchers.");

    const activeTab = document.getElementById("voucher-tab-active");
    activeTab.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(document.activeElement.id).toBe("voucher-tab-past");
    expect(document.body.textContent).toContain("You have no past vouchers.");
  });

  it("shows loading skeletons and retries failed requests", async () => {
    let resolveRequest;
    window.altonautApi.getMyVouchers
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      )
      .mockResolvedValueOnce(success([voucher()], []));

    const pending = window.refreshMyVouchers();
    expect(
      document.querySelector('[aria-label="Loading vouchers"]'),
    ).not.toBeNull();
    resolveRequest({
      success: false,
      error: "Voucher service unavailable",
      meta: { status: 503 },
    });
    await pending;

    expect(document.body.textContent).toContain("Voucher service unavailable");
    click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Retry",
      ),
    );

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("WIFI-1234");
    });
    expect(window.altonautApi.getMyVouchers).toHaveBeenCalledTimes(2);
  });

  it("hides voucher codes and copy controls", async () => {
    window.altonautApi.getMyVouchers.mockResolvedValue(
      success([voucher()], []),
    );

    await window.refreshMyVouchers();

    expect(document.body.textContent).not.toContain("WIFI-1234");
    expect(document.body.textContent).not.toContain("Copy Code");
    expect(
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent === "Copy Code",
      ),
    ).toBe(false);
  });

  it("formats dates as DD MMM YYYY and shows data usage", async () => {
    window.altonautApi.getMyVouchers.mockResolvedValue(
      success([voucher({ usedQuota: 256, totalQuota: 2048 })], []),
    );

    await window.refreshMyVouchers();

    expect(document.body.textContent).toMatch(/\d{2} Jul 2026/);
    expect(document.body.textContent).toContain("256 MB / 2 GB");
  });

  it("submits active vouchers through the existing Omada flow", async () => {
    window.altonautApi.getMyVouchers.mockResolvedValue(
      success([voucher()], []),
    );

    await window.refreshMyVouchers();
    click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Use Voucher",
      ),
    );

    expect(window.submitVoucherAuth).toHaveBeenCalledWith(
      "WIFI-1234",
      expect.objectContaining({
        onStart: expect.any(Function),
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
        onDone: expect.any(Function),
      }),
    );
  });

  it("returns authentication failures to sign-in and clears local session", async () => {
    window.altonautApi.getMyVouchers.mockResolvedValue({
      success: false,
      error: "Unauthorized",
      meta: { status: 401 },
    });

    await window.refreshMyVouchers();

    expect(sessionStorage.getItem("authUser")).toBeNull();
    expect(document.getElementById("auth-section").style.display).toBe("block");
    expect(document.getElementById("captive-section").style.display).toBe(
      "none",
    );
    expect(document.getElementById("auth-error-message").textContent).toContain(
      "session has expired",
    );
  });
});
