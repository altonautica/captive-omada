import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiSource = readFileSync(resolve("src/altonaut.js"), "utf8");
const appSource = readFileSync(resolve("src/app.js"), "utf8");
const markup = readFileSync(resolve("src/index.html"), "utf8");

const ACK =
  "If that account exists, we have emailed a link to reset its password. A login code is also ready: contact support to receive it.";

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
});

describe("altonautApi.requestPasswordReset", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/portal/entry/controller/site/portal");
    delete window.altonautApi;
  });

  const load = () => new Function(apiSource)();

  it("asks the backend, in one call, and passes on its answer as is", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: ACK }));
    vi.stubGlobal("fetch", fetchMock);
    load();

    const result = await window.altonautApi.requestPasswordReset(
      "  crew@example.com ",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/auth/portal/password-reset");
    expect(JSON.parse(init.body)).toEqual({ email: "crew@example.com" });
    expect(init.headers.Authorization).toBeUndefined();
    expect(result).toEqual({ success: true, message: ACK });
  });

  it("rejects a malformed address locally, without spending the shared budget", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    load();

    for (const bad of ["", "crew", "crew@", "crew@example", null]) {
      const result = await window.altonautApi.requestPasswordReset(bad);
      expect(result).toEqual({
        success: false,
        error: "Please enter a valid email address.",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags a throttled network", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "Too many" }, { ok: false, status: 429 }),
        ),
    );
    load();

    await expect(
      window.altonautApi.requestPasswordReset("crew@example.com"),
    ).resolves.toMatchObject({ success: false, throttled: true });
  });

  it("reports a network failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    load();

    await expect(
      window.altonautApi.requestPasswordReset("crew@example.com"),
    ).resolves.toEqual({
      success: false,
      error: "Network error. Please check your connection.",
    });
  });
});

// ---------------------------------------------------------------------------

const bodyMarkup = markup
  .slice(markup.indexOf("<body"), markup.lastIndexOf("</body>"))
  .replace(/^<body[^>]*>/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (element) =>
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const $ = (id) => document.getElementById(id);
const isHidden = (id) => $(id).classList.contains("hidden");

// Same harness as login-code-ui.test.js: run only this load's DOMContentLoaded.
const boot = async () => {
  let domReady;
  const addEventListener = document.addEventListener.bind(document);
  const spy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type, handler, options) => {
      if (type === "DOMContentLoaded") {
        domReady = handler;
        return;
      }
      addEventListener(type, handler, options);
    });
  new Function(appSource)();
  spy.mockRestore();
  domReady?.();
  await flush();
};

describe("Captive portal reset-password panel", () => {
  beforeEach(async () => {
    document.body.innerHTML = bodyMarkup;
    sessionStorage.clear();
    localStorage.clear();
    window.__portalBlockAccess = false;
    window.__portalSettingsReady = Promise.resolve();
    window.altonautApi = {
      login: vi.fn(),
      loginWithCode: vi.fn(),
      requestPasswordReset: vi
        .fn()
        .mockResolvedValue({ success: true, message: ACK }),
      getMyVouchers: vi.fn(),
      logCaptivePortalActivity: vi.fn(),
      clearSessionToken: vi.fn(),
      getOmadaPathInfo: vi.fn(() => ({ siteId: "site" })),
    };
    window.submitVoucherAuth = vi.fn();
    await boot();
    click($("auth-method-password"));
  });

  it("stays inside the portal instead of linking out", () => {
    expect($("reset-password-open").tagName).toBe("BUTTON");
    expect(markup).not.toContain("quota.altonaut.id/users/reset-password");
  });

  it("opens over the sign-in panels, carrying over the typed email", () => {
    $("auth-email").value = "crew@example.com";
    click($("reset-password-open"));

    expect(isHidden("reset-password-form")).toBe(false);
    expect(isHidden("auth-form")).toBe(true);
    expect(isHidden("login-code-form")).toBe(true);
    expect(isHidden("auth-method-tabs")).toBe(true);
    expect($("reset-password-email").value).toBe("crew@example.com");
  });

  it("shows the backend's answer after sending", async () => {
    click($("reset-password-open"));
    $("reset-password-email").value = "crew@example.com";
    $("reset-password-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flush();

    expect(window.altonautApi.requestPasswordReset).toHaveBeenCalledWith(
      "crew@example.com",
    );
    expect(isHidden("reset-password-success")).toBe(false);
    expect($("reset-password-success").textContent).toBe(ACK);
    expect(isHidden("reset-password-error")).toBe(true);
  });

  it("shows an error in place, and does not double-submit", async () => {
    let finish;
    window.altonautApi.requestPasswordReset.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    click($("reset-password-open"));
    $("reset-password-email").value = "crew@example.com";

    const submit = () =>
      $("reset-password-form").dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    submit();
    submit();
    expect(window.altonautApi.requestPasswordReset).toHaveBeenCalledTimes(1);

    finish({ success: false, error: "Please enter a valid email address." });
    await flush();
    expect(isHidden("reset-password-error")).toBe(false);
    expect($("reset-password-error").textContent).toBe(
      "Please enter a valid email address.",
    );
  });

  it("goes back to the email & password form", () => {
    click($("reset-password-open"));
    click($("reset-password-back"));

    expect(isHidden("reset-password-form")).toBe(true);
    expect(isHidden("auth-method-tabs")).toBe(false);
    expect(isHidden("auth-form")).toBe(false);
  });
});
