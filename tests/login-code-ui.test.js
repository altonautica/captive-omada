import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/app.js"), "utf8");
const markup = readFileSync(resolve("src/index.html"), "utf8");

// Drive the real portal markup so the panel wiring cannot drift from the page.
const bodyMarkup = markup
  .slice(markup.indexOf("<body"), markup.lastIndexOf("</body>"))
  .replace(/^<body[^>]*>/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

const boxes = () => [
  ...document.querySelectorAll("#login-code-inputs .login-code-input"),
];

const digits = () => boxes().map((input) => input.value).join("");

const click = (element) =>
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const typeCode = (code) => {
  code.split("").forEach((digit, index) => {
    const input = boxes().find((box) => !box.value) || boxes()[index];
    type(input, digit);
  });
};

const paste = (input, text) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => text };
  input.dispatchEvent(event);
};

const keydown = (input, key) =>
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const openCodePanel = () => click(document.getElementById("auth-method-code"));

// jsdom keeps one document per file, so a plain dispatch would also re-run the
// DOMContentLoaded listeners every earlier load left behind. Capture this load's
// listener and invoke only it.
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

  new Function(source)();
  spy.mockRestore();

  domReady?.();
  await flush();
};

describe("Captive portal sign-in with a code", () => {
  beforeEach(async () => {
    document.body.innerHTML = bodyMarkup;
    sessionStorage.clear();
    localStorage.clear();

    window.__portalBlockAccess = false;
    window.__portalSettingsReady = Promise.resolve();
    window.altonautApi = {
      login: vi.fn(),
      loginWithCode: vi.fn(),
      getMyVouchers: vi.fn().mockResolvedValue({
        success: true,
        vouchers: { active: [], past: [] },
      }),
      logCaptivePortalActivity: vi.fn(),
      clearIdToken: vi.fn(),
      getOmadaPathInfo: vi.fn(() => ({ siteId: "site" })),
    };
    window.submitVoucherAuth = vi.fn();

    await boot();
  });

  it("leads with the code, and keeps email and password one tap away", () => {
    expect(document.getElementById("login-code-form").classList).not.toContain(
      "hidden",
    );
    expect(document.getElementById("auth-form").classList).toContain("hidden");
    expect(document.getElementById("login-code-help").textContent).toBe(
      "Find your code on your profile in the app.",
    );

    // The alternative is never hidden behind a tap-and-search.
    const passwordTab = document.getElementById("auth-method-password");
    expect(passwordTab).not.toBeNull();
    click(passwordTab);

    expect(document.getElementById("auth-form").classList).not.toContain(
      "hidden",
    );
    expect(document.getElementById("login-code-form").classList).toContain(
      "hidden",
    );
  });

  it("serves the code panel first in the markup, so there is no flash on load", () => {
    // app.js is deferred; if the static default disagreed with it the user
    // would see the wrong panel until it ran.
    const codeForm = bodyMarkup.match(/<form id="login-code-form"[^>]*>/)[0];
    const passwordForm = bodyMarkup.match(/<form id="auth-form"[^>]*>/)[0];

    expect(codeForm).not.toContain("hidden");
    expect(passwordForm).toContain("hidden");
    expect(bodyMarkup.indexOf('id="auth-method-code"')).toBeLessThan(
      bodyMarkup.indexOf('id="auth-method-password"'),
    );
  });

  it("offers a number pad and one-time-code autofill on every box", () => {
    expect(boxes()).toHaveLength(6);
    boxes().forEach((input) => {
      expect(input.getAttribute("inputmode")).toBe("numeric");
      expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    });
  });

  it("distributes a code pasted with separators and submits it stripped", async () => {
    window.altonautApi.loginWithCode.mockResolvedValue({
      success: false,
      error: "nope",
    });
    openCodePanel();

    paste(boxes()[0], "041 820");
    await flush();

    expect(digits()).toBe("041820");
    expect(window.altonautApi.loginWithCode).toHaveBeenCalledWith("041820");
  });

  it("submits on the sixth digit, exactly once", async () => {
    let settle;
    window.altonautApi.loginWithCode.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    openCodePanel();

    typeCode("041820");
    await flush();

    expect(window.altonautApi.loginWithCode).toHaveBeenCalledTimes(1);

    // While the exchange is in flight the submit path is closed: a second
    // attempt would spend another of the vessel's shared attempts and fail.
    expect(document.getElementById("login-code-button").disabled).toBe(true);
    boxes().forEach((input) => expect(input.disabled).toBe(true));

    click(document.getElementById("login-code-button"));
    document
      .getElementById("login-code-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(window.altonautApi.loginWithCode).toHaveBeenCalledTimes(1);

    settle({ success: false, error: "nope" });
    await flush();
  });

  it("never sends an incomplete code to the server", async () => {
    openCodePanel();
    typeCode("041");

    document
      .getElementById("login-code-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(window.altonautApi.loginWithCode).not.toHaveBeenCalled();
    expect(
      document.getElementById("login-code-error-message").textContent,
    ).toBe("Enter all 6 digits.");
  });

  it("clears the boxes when the code is rejected, without retrying it", async () => {
    window.altonautApi.loginWithCode.mockResolvedValue({
      success: false,
      error:
        "That code isn't valid or has expired. Open your profile in the app for the current one.",
      meta: { status: 401 },
    });
    openCodePanel();

    typeCode("041820");
    await flush();

    expect(window.altonautApi.loginWithCode).toHaveBeenCalledTimes(1);
    expect(digits()).toBe("");
    expect(
      document.getElementById("login-code-error-message").textContent,
    ).toContain("Open your profile in the app");
    expect(document.getElementById("login-code-button").disabled).toBe(false);
  });

  it("sends the user back to entry when a spent code cannot be redeemed", async () => {
    window.altonautApi.loginWithCode.mockResolvedValue({
      success: false,
      codeSpent: true,
      error:
        "That code has already been used — check your profile for a new one.",
    });
    openCodePanel();

    typeCode("041820");
    await flush();

    expect(digits()).toBe("");
    expect(
      document.getElementById("login-code-error-message").textContent,
    ).toContain("already been used");
  });

  it("surfaces the password form when the shared throttle is exhausted", async () => {
    window.altonautApi.loginWithCode.mockResolvedValue({
      success: false,
      throttled: true,
      error:
        "Too many attempts from this network. Wait a few minutes, or sign in with your email and password.",
      meta: { status: 429 },
    });
    openCodePanel();

    typeCode("041820");
    await flush();

    expect(document.getElementById("auth-form").classList).not.toContain(
      "hidden",
    );
    expect(document.getElementById("login-code-form").classList).toContain(
      "hidden",
    );

    const message = document.getElementById("auth-error-message");
    expect(message.classList).not.toContain("hidden");
    expect(message.textContent).toContain("email and password");
  });

  it("hands a successful code login to the existing post-login path", async () => {
    window.altonautApi.loginWithCode.mockResolvedValue({
      success: true,
      user: { email: "crew@example.com", permissions: ["wifi"] },
    });
    openCodePanel();

    typeCode("041820");
    await flush();

    expect(document.getElementById("captive-section").style.display).toBe(
      "block",
    );
    expect(document.getElementById("logged-user-email").textContent).toBe(
      "crew@example.com",
    );
    expect(window.altonautApi.logCaptivePortalActivity).toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem("authUser"))).toMatchObject({
      email: "crew@example.com",
    });
  });

  it("never persists the code or leaves it in the page", async () => {
    window.altonautApi.loginWithCode.mockResolvedValue({
      success: true,
      user: { email: "crew@example.com" },
    });
    openCodePanel();

    typeCode("041820");
    await flush();

    expect(digits()).toBe("");
    const stored = [
      ...Object.values({ ...localStorage }),
      ...Object.values({ ...sessionStorage }),
    ].join(" ");
    expect(stored).not.toContain("041820");
  });

  it("remembers a switch away from the default, per device", async () => {
    click(document.getElementById("auth-method-password"));
    expect(localStorage.getItem("altonautPortalAuthMethod")).toBe("password");

    document.body.innerHTML = bodyMarkup;
    await boot();

    expect(document.getElementById("auth-form").classList).not.toContain(
      "hidden",
    );
    expect(document.getElementById("auth-method-code")).not.toBeNull();
  });

  it("never carries digits across a reload", async () => {
    typeCode("0418");
    expect(digits()).toBe("0418");

    document.body.innerHTML = bodyMarkup;
    await boot();

    expect(digits()).toBe("");
    expect(JSON.stringify({ ...localStorage })).not.toContain("0418");
  });

  it("falls back to the password form if the API client never loaded", async () => {
    delete window.altonautApi.loginWithCode;
    openCodePanel();

    typeCode("041820");
    await flush();

    expect(document.getElementById("auth-form").classList).not.toContain(
      "hidden",
    );
    expect(
      document.getElementById("auth-error-message").textContent,
    ).toContain("email and password");
  });

  it("steps back to the previous box on backspace", () => {
    openCodePanel();
    typeCode("04");

    const third = boxes()[2];
    third.focus();
    keydown(third, "Backspace");

    expect(digits()).toBe("0");
    expect(document.activeElement.id).toBe("login-code-2");
  });

  it("returns to the password form from the code panel in one tap", () => {
    openCodePanel();
    click(document.getElementById("use-password-instead"));

    expect(document.getElementById("auth-form").classList).not.toContain(
      "hidden",
    );
    expect(document.activeElement.id).toBe("auth-email");
  });
});
