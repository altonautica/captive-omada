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

const SESSION = {
  data: {
    user: { email: "crew@example.com", permissions: ["wifi"] },
    token: "pcs_abc.def",
  },
};

describe("altonautApi.login (email + password)", () => {
  let firebase;

  beforeEach(() => {
    window.history.replaceState({}, "", "/portal/entry/controller/site/portal");
    sessionStorage.clear();
    delete window.altonautApi;
    // Fails the test if the password path ever touches the Firebase SDK.
    firebase = {
      currentUser: null,
      signInWithEmailAndPassword: vi.fn(),
    };
    window.firebaseAuth = firebase;
  });

  it("checks the password on the backend in one call, never through Firebase", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(SESSION));
    vi.stubGlobal("fetch", fetchMock);
    loadAltonaut();

    const result = await window.altonautApi.login("crew@example.com", " pw ");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/auth/portal/login");
    expect(url).not.toContain("login-code");
    // The password goes exactly as typed — spaces can be part of it.
    expect(JSON.parse(init.body)).toEqual({
      email: "crew@example.com",
      password: " pw ",
    });
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.credentials).toBe("include");

    expect(firebase.signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      user: { email: "crew@example.com" },
    });
  });

  it("works when the Firebase SDK never loaded", async () => {
    delete window.firebaseAuth;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(SESSION)));
    loadAltonaut();

    await expect(
      window.altonautApi.login("crew@example.com", "pw"),
    ).resolves.toMatchObject({ success: true });
  });

  it("sends the session token as a Bearer header afterwards, for iOS", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SESSION))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    loadAltonaut();

    await window.altonautApi.login("crew@example.com", "pw");
    await window.altonautApi.getMyVouchers();

    const [, vouchersCall] = fetchMock.mock.calls;
    expect(vouchersCall[1].headers.Authorization).toBe("Bearer pcs_abc.def");
  });

  it.each([
    [401, { message: "Invalid email or password." }, "Invalid email or password. Please try again."],
    [429, { message: "Too many attempts." }, "Too many attempts. Please try again later."],
    [403, { message: "This account has been disabled." }, "This account has been disabled."],
    [
      503,
      { message: "Sign-in is temporarily unavailable. Please try again." },
      "Sign-in is temporarily unavailable. Please try again.",
    ],
  ])("maps a %i to the copy users already know", async (status, body, copy) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(body, { ok: false, status })),
    );
    loadAltonaut();

    const result = await window.altonautApi.login("crew@example.com", "pw");

    expect(result).toMatchObject({ success: false, error: copy });
    expect(sessionStorage.length).toBe(0);
  });

  it("reports a network failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    loadAltonaut();

    await expect(
      window.altonautApi.login("crew@example.com", "pw"),
    ).resolves.toEqual({
      success: false,
      error: "Network error. Please check your connection.",
    });
  });
});
