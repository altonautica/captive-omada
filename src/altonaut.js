// altonaut.js
// API client for login, sign up, and orders

// Backend base URL (includes the /api/v1 prefix). Resolution order:
//   1. window.__ALTONAUT_API_BASE_URL override (set before this script loads)
//   2. localhost/loopback -> dev backend
//   3. anything else (e.g. the deployed Omada portal) -> prod backend
// const API_BASE_URL = "http://localhost:3333/api/v1";
// uncomment this when ready to prod.
const API_BASE_URL = "https://data.altonaut.id/api/v1";

// Utility functions
const getQueryParams = () => {
  try {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  } catch {
    // Fallback for older browsers
    const params = {};
    const query = window.location.search.replace(/^\?/, "");
    query.split("&").forEach((pair) => {
      if (!pair) return;
      const [key, value = ""] = pair.split("=");
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    });
    return params;
  }
};

// Local-dev fallback: real portal URLs are /portal/entry/{controllerId}/{siteId}/
// {portalId}, but on localhost there is no `entry` segment. Gated to localhost so
// this dev site can never leak into a deployed portal.
const DEV_PATH_FALLBACK = {
  controllerId: "333014d5d63098ad88171974e4a51d77",
  siteId: "6881a70b470e30297893a8ee",
  portalId: "69113f3e9d56de541f9c99a2",
};

const getOmadaPathInfo = () => {
  try {
    const isLocalDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
      location.hostname,
    );
    const segments = window.location.pathname.split("/").filter(Boolean);

    // Find 'entry' index, preferring the one after 'portal'
    let entryIndex = -1;
    for (let i = 1; i < segments.length; i++) {
      if (segments[i] === "entry" && segments[i - 1] === "portal") {
        entryIndex = i;
        break;
      }
    }

    if (entryIndex === -1) {
      entryIndex = segments.indexOf("entry");
    }

    // No portal path (e.g. localhost dev server): fall back only in local dev,
    // otherwise there is no site to resolve.
    if (entryIndex === -1) return isLocalDev ? DEV_PATH_FALLBACK : null;

    const [controllerId, siteId, portalId] = segments.slice(entryIndex + 1);
    if (siteId) return { controllerId, siteId, portalId };
    return isLocalDev ? DEV_PATH_FALLBACK : null;
  } catch (error) {
    console.error("Failed to parse Omada path info:", error);
    return null;
  }
};

// API utilities
const extractUser = (result) => {
  if (!result || typeof result !== "object") return undefined;
  return result.data?.user || result.user || undefined;
};

const extractError = (result, fallback = "Request failed") => {
  if (!result || typeof result !== "object") return fallback;
  return result.error || result.message || result.msg || fallback;
};

// Bearer-token auth (iOS fix)
// --------------------------------------------------------------------------
// The backend's AuthToken cookie is a *cross-site* cookie here: the portal is
// served by the Omada controller while the API lives on data.altonaut.id.
// iOS Safari (and the captive-network mini browser) block cross-site cookies
// outright under "Prevent Cross-Site Tracking", which is on by default — so on
// iPhone the cookie is never stored and every follow-up call comes back 401,
// surfacing as "Your session has expired". Android Chrome still accepts
// SameSite=None cookies, which is why it only broke on iOS.
//
// The backend accepts `Authorization: Bearer <session token>` on protected
// routes, so we send that on every request as well. The cookie is still sent
// (credentials: "include") for browsers where it works; the header is what
// makes iOS work. The token is the 24-hour portal session that
// /auth/portal/login and /auth/portal/login-code return (NXS-1503).
const SESSION_TOKEN_STORAGE_KEY = "altonautSessionToken";

const readStoredSessionToken = () => {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

const storeSessionToken = (token) => {
  try {
    if (token) sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage can be unavailable (private mode); the cookie still carries the
    // session where the browser accepts it.
  }
};

const clearSessionToken = () => {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // no-op
  }
};

const createApiRequest = async (url, options = {}) => {
  const { auth = true, headers: extraHeaders, ...rest } = options;

  const send = async (token) => {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    };
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      // The backend also sets an HttpOnly session cookie on login and accepts
      // it back where the browser allows it. `include` is required for the
      // cross-origin (portal -> API) cookie flow, and the backend permits it
      // via Access-Control-Allow-Credentials: true.
      credentials: "include",
      ...rest,
      headers,
    });

    // Tolerate empty (204) and non-JSON bodies (e.g. a 502/500 HTML page) instead
    // of letting response.json() throw a SyntaxError.
    let result = {};
    if (response.status !== 204) {
      const text = await response.text();
      if (text) {
        try {
          result = JSON.parse(text);
        } catch {
          result = { message: text };
        }
      }
    }

    return { response, result };
  };

  try {
    // No refresh: a portal session lasts 24 hours, and a 401 after that means
    // signing in again.
    const token = auth ? readStoredSessionToken() : null;
    const { response, result } = await send(token);

    return {
      response,
      result,
      meta: { status: response.status, url },
    };
  } catch (error) {
    console.error("API request failed:", error);
    throw error;
  }
};

// Copy for POST /auth/portal/login's answers — the same wording the portal
// showed before sign-in moved to the backend, so users see no difference.
const PASSWORD_LOGIN_MESSAGES = {
  401: "Invalid email or password. Please try again.",
  429: "Too many attempts. Please try again later.",
  network: "Network error. Please check your connection.",
  failed: "Login failed.",
};

/**
 * Login function
 *
 * Sends the email + password to the backend, which checks them and starts a
 * 24-hour session (NXS-1503). The device never talks to Google, so this works
 * on a vessel whose pre-auth allowlist cannot reach it. The backend sets the
 * AuthToken cookie and returns { data: { user, token } }; the token is kept
 * for the Bearer header that iOS needs (it refuses the cross-site cookie).
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: object, error?: string, meta?: object }>}
 */
const login = async (email, password) => {
  try {
    const { response, result, meta } = await createApiRequest(
      `${API_BASE_URL}/auth/portal/login`,
      {
        method: "POST",
        // The credentials are in the body; no bearer header, and a 401 here
        // means "wrong password", so the retry-on-401 must not fire.
        auth: false,
        body: JSON.stringify({ email, password }),
      },
    );

    const user = extractUser(result);
    const token = result?.data?.token;
    if (response.ok && user && token) {
      storeSessionToken(token);
      return { success: true, user, meta };
    }

    // 403 carries the backend's own reason (disabled account, unverified
    // email), so show it; 401 and 429 get the established wording.
    return {
      success: false,
      error:
        PASSWORD_LOGIN_MESSAGES[response.status] ||
        extractError(result, PASSWORD_LOGIN_MESSAGES.failed),
      meta: { ...meta, body: result },
    };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: PASSWORD_LOGIN_MESSAGES.network };
  }
};

// Sign in with a login code
// --------------------------------------------------------------------------
// The user reads a 6-digit code off their profile in the app — where they are
// already signed in — instead of typing an email and password on a laptop that
// has just joined the Wi-Fi.
//
// One call: POST /auth/portal/login-code checks the code and starts a 24-hour
// backend session itself, so this works even on a vessel whose pre-auth
// allowlist cannot reach Google. Requests carry the session in the cookie and
// in the Bearer header, like the password path.
//
// Failed attempts are rate limited per IP, and on a vessel one IP is the whole
// boat: every guest shares the budget. So this never sends a request it can
// reject itself, and never retries on its own.
const LOGIN_CODE_LENGTH = 6;
const LOGIN_CODE_PATTERN = /^\d{6}$/;

const LOGIN_CODE_MESSAGES = {
  // A 422 costs the vessel a throttle attempt, so this copy should only ever be
  // reached client-side.
  incomplete: `Enter all ${LOGIN_CODE_LENGTH} digits.`,
  // The backend returns one indistinguishable 401 for unknown / expired /
  // already-used / disabled — deliberately, so guessing cannot confirm that a
  // code was ever real. Never infer a more specific reason than this.
  invalid:
    "That code isn't valid or has expired. Open your profile in the app for the current one.",
  throttled:
    "Too many attempts from this network. Wait a few minutes, or sign in with your email and password.",
  spent: "That code has already been used — check your profile for a new one.",
  failed: "Sign in failed. Please try again.",
  network: "Network error. Please check your connection and try again.",
};

/**
 * Strips the separators people type when a code is read aloud ("041 820",
 * "041-820") so formatting never reaches the server as a 422.
 * @param {string} value
 * @returns {string}
 */
const normalizeLoginCode = (value) =>
  typeof value === "string" ? value.replace(/[\s-]/g, "") : "";

/**
 * Sign in with a 6-digit login code.
 *
 * Spending the code is irreversible: if the response is lost or malformed, the
 * code is gone and resubmitting it returns 401. The caller must send the user
 * back to code entry — never retry the same digits.
 *
 * @param {string} rawCode - Digits, with or without spaces/dashes.
 * @returns {Promise<{ success: boolean, user?: object, error?: string,
 *   throttled?: boolean, codeSpent?: boolean, meta?: object }>}
 */
const loginWithCode = async (rawCode) => {
  const code = normalizeLoginCode(rawCode);

  // Reject locally rather than burning an attempt the whole vessel shares.
  if (!LOGIN_CODE_PATTERN.test(code)) {
    return { success: false, error: LOGIN_CODE_MESSAGES.incomplete };
  }

  try {
    const { response, result, meta } = await createApiRequest(
      `${API_BASE_URL}/auth/portal/login-code`,
      {
        method: "POST",
        // Unauthenticated by definition — the caller has no identity yet — and
        // the 401 here means "bad code", so the retry-on-401 must not fire.
        auth: false,
        body: JSON.stringify({ code }),
      },
    );

    if (!response.ok) {
      const error =
        {
          401: LOGIN_CODE_MESSAGES.invalid,
          422: LOGIN_CODE_MESSAGES.incomplete,
          429: LOGIN_CODE_MESSAGES.throttled,
        }[response.status] || extractError(result, LOGIN_CODE_MESSAGES.failed);

      return {
        success: false,
        error,
        throttled: response.status === 429,
        meta: { ...meta, body: result },
      };
    }

    // The backend has already set the AuthToken cookie. The token in the body
    // is the same session, kept for the Bearer header on browsers that refuse
    // the cross-site cookie (iOS) — the slot the password path's ID token uses.
    const user = extractUser(result);
    const token = result?.data?.token;
    if (!user || !token) {
      console.error("[altonautApi] Login code response had no session.");
      return {
        success: false,
        error: LOGIN_CODE_MESSAGES.spent,
        codeSpent: true,
        meta: { ...meta, body: result },
      };
    }

    storeSessionToken(token);
    return { success: true, user, meta };
  } catch (error) {
    // The code may or may not have been spent here, but nothing downstream ran,
    // so the same digits are still worth one more manual try.
    console.error("[altonautApi] Login code exchange failed:", error);
    return { success: false, error: LOGIN_CODE_MESSAGES.network };
  }
};

// Forgot password (NXS-1503)
// --------------------------------------------------------------------------
// POST /auth/portal/password-reset emails the account's reset link and leaves
// a login code waiting at support, both from the server — the device never
// talks to Google. It answers the same whether or not the address has an
// account, so the caller shows that answer as is.
//
// Rate limited per IP (5 per 15 minutes, every call counted), and on a vessel
// one IP is the whole boat, so malformed addresses are rejected locally and
// nothing is ever retried automatically.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_RESET_MESSAGES = {
  invalid: "Please enter a valid email address.",
  throttled:
    "Too many requests from this network. Please wait a few minutes and try again.",
  failed: "Could not send the reset request. Please try again.",
  network: "Network error. Please check your connection.",
};

/**
 * Request a password reset for `email`.
 * @param {string} rawEmail
 * @returns {Promise<{ success: boolean, message?: string, error?: string, throttled?: boolean }>}
 */
const requestPasswordReset = async (rawEmail) => {
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  if (!EMAIL_PATTERN.test(email)) {
    return { success: false, error: PASSWORD_RESET_MESSAGES.invalid };
  }

  try {
    const { response, result } = await createApiRequest(
      `${API_BASE_URL}/auth/portal/password-reset`,
      {
        method: "POST",
        auth: false,
        body: JSON.stringify({ email }),
      },
    );

    if (response.ok) {
      return { success: true, message: extractError(result, "") };
    }

    if (response.status === 429) {
      return {
        success: false,
        throttled: true,
        error: PASSWORD_RESET_MESSAGES.throttled,
      };
    }

    return {
      success: false,
      error:
        response.status === 422
          ? PASSWORD_RESET_MESSAGES.invalid
          : PASSWORD_RESET_MESSAGES.failed,
    };
  } catch (error) {
    console.error("[altonautApi] Password reset request failed:", error);
    return { success: false, error: PASSWORD_RESET_MESSAGES.network };
  }
};

/**
 * Get user info. Auth is carried by the session cookie (credentials: include).
 * @returns {Promise<{ success: boolean, user?: object, error?: string, meta?: object }>}
 */
const getUser = async () => {
  try {
    const { response, result, meta } = await createApiRequest(
      `${API_BASE_URL}/auth/user`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!response.ok || response.status === 204) {
      return {
        success: false,
        error: extractError(result, "Failed to fetch user."),
        meta: { ...meta, body: result },
      };
    }

    // Extract user data from various possible structures
    const user = result?.data || result?.user || result;
    const isValidUser =
      user &&
      typeof user === "object" &&
      !Array.isArray(user) &&
      Object.keys(user).length > 0;

    if (!isValidUser) {
      return {
        success: false,
        error: "No user info returned from server.",
        meta: { ...meta, body: result },
      };
    }

    return { success: true, user, meta };
  } catch (error) {
    console.error("Get user error:", error);
    throw error;
  }
};

/**
 * Get all orders for a user. Auth is carried by the session cookie.
 * @param {string} [siteId] - Site ID (optional, defaults to path value)
 * @returns {Promise<{ success: boolean, orders?: object[], error?: string, meta?: object }>}
 */
const getOrders = async (siteId) => {
  const pathInfo = getOmadaPathInfo();
  const effectiveSiteId = siteId || pathInfo?.siteId;

  if (!effectiveSiteId) {
    return {
      success: false,
      error: "Site not found. Please contact technical support.",
    };
  }

  const url = `${API_BASE_URL}/site-orders?siteId=${encodeURIComponent(effectiveSiteId)}`;

  try {
    const { response, result, meta } = await createApiRequest(url, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        success: false,
        error: extractError(result, "Failed to fetch orders."),
        meta: { ...meta, body: result },
      };
    }

    const orders = result?.data?.orders || [];
    if (!Array.isArray(orders)) {
      return {
        success: false,
        error: "Invalid orders payload.",
        meta: { ...meta, body: result },
      };
    }

    return { success: true, orders, meta };
  } catch (error) {
    console.error("[altonautApi] Site orders error:", error);
    throw error;
  }
};

/**
 * @typedef {object} OwnedVoucher
 * @property {string} id
 * @property {string} code
 * @property {number} status
 * @property {string|null} assignedAt
 * @property {string|null} expirationDate
 * @property {boolean} isActive
 * @property {string} voucherGroupId
 * @property {string|null} packageId
 * @property {string|null} packageName
 */

/**
 * @typedef {object} MyVouchersData
 * @property {OwnedVoucher[]} active
 * @property {OwnedVoucher[]} past
 */

/**
 * Get the authenticated user's vouchers. The backend owns grouping and
 * ordering; callers must not reclassify or sort these arrays.
 *
 * GET {API_BASE_URL}/me/vouchers
 *
 * @returns {Promise<{ success: boolean, vouchers?: MyVouchersData, error?: string, meta?: object }>}
 */
const getMyVouchers = async () => {
  try {
    const { response, result, meta } = await createApiRequest(
      `${API_BASE_URL}/me/vouchers`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return {
        success: false,
        error: extractError(result, "Failed to fetch vouchers."),
        meta: { ...meta, body: result },
      };
    }

    const vouchers = result?.data;
    if (
      !vouchers ||
      typeof vouchers !== "object" ||
      !Array.isArray(vouchers.active) ||
      !Array.isArray(vouchers.past)
    ) {
      return {
        success: false,
        error: "Invalid vouchers payload.",
        meta: { ...meta, body: result },
      };
    }

    return {
      success: true,
      vouchers: {
        active: vouchers.active,
        past: vouchers.past,
      },
      meta,
    };
  } catch (error) {
    console.error("[altonautApi] My vouchers error:", error);
    throw error;
  }
};

/**
 * Log a captive-portal login activity (best-effort / fire-and-forget).
 *
 * Call this ONLY after a successful login/signup — the backend derives the user
 * from the AuthToken session cookie set at login, so calling it earlier yields a
 * 401. Required fields (siteId, controllerId, portalId) come from the portal
 * path; optional network context comes from the Omada redirect query params.
 *
 * Never throws and never blocks portal access: a missing session/site or a
 * failed request is logged and swallowed.
 *
 * @param {object} [overrides] - Optional explicit values (merged over the
 *   values derived from the path/query params).
 * @returns {Promise<{ success: boolean, activity?: object, error?: string, meta?: object }>}
 */
const logCaptivePortalActivity = async (overrides = {}) => {
  try {
    const pathInfo = getOmadaPathInfo();
    const query = getQueryParams();

    const siteId = overrides.siteId ?? pathInfo?.siteId;
    const controllerId = overrides.controllerId ?? pathInfo?.controllerId;
    const portalId = overrides.portalId ?? pathInfo?.portalId;

    // Required fields — skip the call rather than send an invalid (422) request.
    if (!siteId || !controllerId || !portalId) {
      console.warn(
        "[altonautApi] Skipping activity log: missing site/controller/portal id.",
      );
      return {
        success: false,
        error: "Missing required site/controller/portal id.",
      };
    }

    // Optional network context from the Omada redirect. Omada uses these query
    // keys; normalize to null so absent params are explicitly empty, not "".
    const present = (value) =>
      value !== undefined && value !== null && value !== "";
    const pick = (...keys) => {
      // Explicit overrides win over any query param, so check all overrides
      // before falling back to the query string.
      for (const key of keys) {
        if (present(overrides[key])) return overrides[key];
      }
      for (const key of keys) {
        if (present(query[key])) return query[key];
      }
      return null;
    };

    const body = {
      siteId,
      controllerId,
      portalId,
      apMac: pick("apMac"),
      clientMac: pick("clientMac"),
      clientIp: pick("clientIp"),
      ssidName: pick("ssidName", "ssid"),
      radioId: pick("radioId"),
      originUrl: pick("originUrl", "redirectUrl"),
    };

    const { response, result, meta } = await createApiRequest(
      `${API_BASE_URL}/captive-portal-activities`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      console.error("Failed to log captive-portal activity", {
        status: meta.status,
        body: result,
      });
      return {
        success: false,
        error: extractError(result, "Failed to log activity."),
        meta: { ...meta, body: result },
      };
    }

    return { success: true, activity: result?.data || result, meta };
  } catch (error) {
    // Best-effort: never block portal access on a logging failure.
    console.error("Failed to log captive-portal activity", error);
    return { success: false, error: error?.message || "Request failed." };
  }
};

// Export API
window.altonautApi = {
  login,
  loginWithCode,
  requestPasswordReset,
  getUser,
  getOrders,
  getMyVouchers,
  getOmadaPathInfo,
  logCaptivePortalActivity,
  clearSessionToken,
};
