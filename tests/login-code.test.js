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

/** A Firebase stub that fails the test if code login ever touches it. */
const stubFirebase = () => {
  const signInWithCustomToken = vi.fn();
  const signInWithEmailAndPassword = vi.fn();
  window.firebaseAuth = {
    currentUser: null,
    signInWithCustomToken,
    signInWithEmailAndPassword,
  };
  return { signInWithCustomToken, signInWithEmailAndPassword };
};

const SESSION = {
  data: {
    user: { email: "crew@example.com", permissions: ["wifi"] },
    token: "pcs_abc.def",
  },
};

const bodyOf = (call) => JSON.parse(call[1].body);

describe("altonautApi.loginWithCode", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/portal/entry/controller/site/portal");
    sessionStorage.clear();
    delete window.altonautApi;
    delete window.firebaseAuth;
  });

  it("signs in with one call and never touches Firebase", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(SESSION));
    vi.stubGlobal("fetch", fetchMock);
    const firebase = stubFirebase();
    loadAltonaut();

    const result = await window.altonautApi.loginWithCode("041820");

    // The backend checks the code and starts the session itself: no custom
    // token, no Google round trip, no second call to /auth/login.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [exchangeCall] = fetchMock.mock.calls;
    expect(exchangeCall[0]).toContain("/auth/login-code");
    expect(bodyOf(exchangeCall)).toEqual({ code: "041820" });
    expect(exchangeCall[1].headers.Authorization).toBeUndefined();
    expect(exchangeCall[1].credentials).toBe("include");

    expect(firebase.signInWithCustomToken).not.toHaveBeenCalled();
    expect(firebase.signInWithEmailAndPassword).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      success: true,
      user: { email: "crew@example.com", permissions: ["wifi"] },
    });
  });

  it("works when the Firebase SDK never loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(SESSION)));
    loadAltonaut();

    await expect(
      window.altonautApi.loginWithCode("041820"),
    ).resolves.toMatchObject({ success: true });
  });

  it("sends the session token as a Bearer header afterwards, for iOS", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SESSION))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    stubFirebase();
    loadAltonaut();

    await window.altonautApi.loginWithCode("041820");
    await window.altonautApi.getMyVouchers();

    // iOS refuses the cross-site cookie, so the header is what keeps it signed in.
    const [, vouchersCall] = fetchMock.mock.calls;
    expect(vouchersCall[0]).toContain("/me/vouchers");
    expect(vouchersCall[1].headers.Authorization).toBe("Bearer pcs_abc.def");
  });

  it("strips the spaces and dashes people type when a code is read aloud", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(SESSION));
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

  it("reports one indistinguishable message for a rejected code", async () => {
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

  it("treats the code as spent when a 200 carries no session, and does not resubmit it", async () => {
    // e.g. an old backend still answering with a Firebase custom token.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ customToken: "custom-token-123" }));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
