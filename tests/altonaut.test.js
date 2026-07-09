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

describe("altonautApi.getMyVouchers", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/portal/entry/controller/site/portal");
    delete window.altonautApi;
  });

  it("requests the authenticated endpoint without query parameters and maps both groups", async () => {
    const payload = {
      data: {
        active: [
          { id: "internal-2", code: "NEWEST", status: 0 },
          { id: "internal-1", code: "OLDER", status: 0 },
        ],
        past: [{ id: "internal-3", code: "PAST", status: 1 }],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    loadAltonaut();

    const result = await window.altonautApi.getMyVouchers();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3333/api/v1/me/vouchers",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "include",
      }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("?");
    expect(result).toMatchObject({
      success: true,
      vouchers: {
        active: [{ code: "NEWEST" }, { code: "OLDER" }],
        past: [{ code: "PAST" }],
      },
    });
  });

  it("rejects malformed success payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: { active: [] } })),
    );
    loadAltonaut();

    await expect(window.altonautApi.getMyVouchers()).resolves.toMatchObject({
      success: false,
      error: "Invalid vouchers payload.",
      meta: { status: 200 },
    });
  });

  it("preserves backend authentication errors and status metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { message: "Authentication required" },
            { ok: false, status: 401 },
          ),
        ),
    );
    loadAltonaut();

    await expect(window.altonautApi.getMyVouchers()).resolves.toMatchObject({
      success: false,
      error: "Authentication required",
      meta: { status: 401 },
    });
  });
});
