import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/altonaut.js"), "utf8");

const loadAltonaut = () => {
  new Function(source)();
};

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
});

const stubFirebase = ({ idToken = "id-token-abc" } = {}) => {
  const getIdToken = vi.fn().mockResolvedValue(idToken);
  const signInWithCustomToken = vi
    .fn()
    .mockResolvedValue({ user: { getIdToken } });
  window.firebaseAuth = { signInWithCustomToken };
  return { signInWithCustomToken, getIdToken };
};

const bodyOf = (call) => JSON.parse(call[1].body);

describe("altonautApi.loginWithCode", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/portal/entry/controller/site/portal");
    sessionStorage.clear();
    delete window.altonautApi;
    delete window.firebaseAuth;
  });

  it("spends the code, trades the custom token for an ID token, then opens the session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ customToken: "custom-token-123" }))
      .mockResolvedValueOnce(
        jsonResponse({
          user: { email: "crew@example.com", permissions: ["wifi"] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const firebase = stubFirebase();
    loadAltonaut();

    const result = await window.altonautApi.loginWithCode("041820");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [exchangeCall, loginCall] = fetchMock.mock.calls;
    expect(exchangeCall[0]).toContain("/auth/login-code");
    expect(bodyOf(exchangeCall)).toEqual({ code: "041820" });
    expect(exchangeCall[1].headers.Authorization).toBeUndefined();

    // The custom token is not a credential until Firebase trades it in.
    expect(firebase.signInWithCustomToken).toHaveBeenCalledWith(
      "custom-token-123",
    );

    expect(loginCall[0]).toContain("/auth/login");
    expect(loginCall[0]).not.toContain("login-code");
    expect(bodyOf(loginCall)).toEqual({ idToken: "id-token-abc" });
    expect(loginCall[1].credentials).toBe("include");

    expect(result).toMatchObject({
      success: true,
      user: { email: "crew@example.com", permissions: ["wifi"] },
    });
  });

  it("strips the spaces and dashes people type when a code is read aloud", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ customToken: "custom-token-123" }))
      .mockResolvedValueOnce(jsonResponse({ user: { email: "a@b.c" } }));
    vi.stubGlobal("fetch", fetchMock);
    stubFirebase();
    loadAltonaut();

    await window.altonautApi.loginWithCode(" 041-820 ");

    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ code: "041820" });
  });

  it("rejects malformed codes locally rather than spending a shared throttle attempt", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubFirebase();
    loadAltonaut();

    for (const bad of ["", "12345", "1234567", "04182a", null]) {
      const result = await window.altonautApi.loginWithCode(bad);
      expect(result).toEqual({ success: false, error: "Enter all 6 digits." });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports one indistinguishable message for a rejected code and never calls Firebase", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { message: "Invalid or expired code" },
            { ok: false, status: 401 },
          ),
        ),
    );
    const firebase = stubFirebase();
    loadAltonaut();

    const result = await window.altonautApi.loginWithCode("041820");

    expect(result).toMatchObject({
      success: false,
      error:
        "That code isn't valid or has expired. Open your profile in the app for the current one.",
      meta: { status: 401 },
    });
    expect(result.codeSpent).toBeUndefined();
    expect(firebase.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("flags a throttled network so the caller can surface the password form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { message: "Too many attempts. Please wait before trying again." },
          { ok: false, status: 429 },
        ),
      ),
    );
    stubFirebase();
    loadAltonaut();

    await expect(
      window.altonautApi.loginWithCode("041820"),
    ).resolves.toMatchObject({
      success: false,
      throttled: true,
      error:
        "Too many attempts from this network. Wait a few minutes, or sign in with your email and password.",
    });
  });

  it("treats the code as spent when Firebase fails, and does not resubmit it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ customToken: "custom-token-123" }));
    vi.stubGlobal("fetch", fetchMock);
    window.firebaseAuth = {
      signInWithCustomToken: vi
        .fn()
        .mockRejectedValue(new Error("network request failed")),
    };
    loadAltonaut();

    const result = await window.altonautApi.loginWithCode("041820");

    expect(result).toMatchObject({
      success: false,
      codeSpent: true,
      error:
        "That code has already been used — check your profile for a new one.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats the code as spent when the session exchange fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ customToken: "custom-token-123" }))
      .mockResolvedValueOnce(
        jsonResponse({ message: "Bad gateway" }, { ok: false, status: 502 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    stubFirebase();
    loadAltonaut();

    const result = await window.altonautApi.loginWithCode("041820");

    expect(result).toMatchObject({
      success: false,
      codeSpent: true,
      error:
        "That code has already been used — check your profile for a new one.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets the user retry when the exchange itself never completed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    stubFirebase();
    loadAltonaut();

    const result = await window.altonautApi.loginWithCode("041820");

    expect(result).toMatchObject({ success: false });
    expect(result.codeSpent).toBeUndefined();
  });
});
