// altonaut.js
// API client for login, sign up, and orders

// Backend base URL (includes the /api/v1 prefix). Resolution order:
//   1. window.__ALTONAUT_API_BASE_URL override (set before this script loads)
//   2. localhost/loopback -> dev backend
//   3. anything else (e.g. the deployed Omada portal) -> prod backend
const API_BASE_URL = "http://localhost:3333/api/v1";
// uncomment this when ready to prod.
// const API_BASE_URL = 'https://data.altonaut.id/api/v1'

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
    console.log("Path segments:", segments);

    console.log("1", DEV_PATH_FALLBACK);

    // Find 'entry' index, preferring the one after 'portal'
    let entryIndex = -1;
    for (let i = 1; i < segments.length; i++) {
      if (segments[i] === "entry" && segments[i - 1] === "portal") {
        entryIndex = i;
        break;
      }
    }

    console.log("2", DEV_PATH_FALLBACK);
    if (entryIndex === -1) {
      entryIndex = segments.indexOf("entry");
    }

    // No portal path (e.g. localhost dev server): fall back only in local dev,
    // otherwise there is no site to resolve.

    console.log("3", DEV_PATH_FALLBACK);
    if (entryIndex === -1) return isLocalDev ? DEV_PATH_FALLBACK : null;

    const [controllerId, siteId, portalId] = segments.slice(entryIndex + 1);
    return siteId ? { controllerId, siteId, portalId } : DEV_PATH_FALLBACK;
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

// Maps Firebase Auth error codes to the friendly copy already used in the UI.
const mapFirebaseAuthError = (error) => {
  switch (error?.code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password. Please try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection.";
    default:
      return error?.message || "Authentication failed. Please try again.";
  }
};

const createApiRequest = async (url, options = {}) => {
  const config = {
    // Auth is cookie-based: the backend sets an HttpOnly session cookie on
    // login and expects it back on every subsequent request. `include` is
    // required for cross-origin (portal :4173 -> API :3333) cookie flow, and
    // the backend allows it via Access-Control-Allow-Credentials: true.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    const result = await response.json();

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

/**
 * Login function
 *
 * Signs the user in with Firebase (client-side), then exchanges the resulting
 * Firebase ID token with the backend. On success the backend sets an HttpOnly
 * session cookie (the credential downstream getUser/getOrders calls rely on)
 * and returns the user profile in the body — there is no token in the payload.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: object, error?: string, meta?: object }>}
 */
const login = async (email, password) => {
  let idToken;
  try {
    if (!window.firebaseAuth) {
      throw new Error("Firebase is not initialized.");
    }
    const cred = await window.firebaseAuth.signInWithEmailAndPassword(
      email,
      password,
    );
    idToken = await cred.user.getIdToken();
  } catch (error) {
    // Firebase throws on bad credentials; convert to the {success,error} shape
    // handleAuthResponse expects so the user sees a specific message.
    console.error("Firebase sign-in error:", error);
    return { success: false, error: mapFirebaseAuthError(error) };
  }

  try {
    const { response, result, meta } = await createApiRequest(
      `${API_BASE_URL}/auth/login`,
      {
        method: "POST",
        body: JSON.stringify({ idToken }),
      },
    );

    const user = extractUser(result);
    if (response.ok && user) {
      return { success: true, user, meta };
    }

    return {
      success: false,
      error: extractError(result, "Login failed."),
      meta: { ...meta, body: result },
    };
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
};

/**
 * Sign up function
 * @param {string} name
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: object, error?: string, meta?: object }>}
 */
const signUp = async (name, email, password) => {
  let idToken;
  try {
    if (!window.firebaseAuth) {
      throw new Error("Firebase is not initialized.");
    }
    const cred = await window.firebaseAuth.createUserWithEmailAndPassword(
      email,
      password,
    );
    if (name) {
      await cred.user.updateProfile({ displayName: name });
    }
    idToken = await cred.user.getIdToken();
  } catch (error) {
    console.error("Firebase sign-up error:", error);
    return { success: false, error: mapFirebaseAuthError(error) };
  }

  try {
    // Assumes the backend /api/auth/signup accepts { idToken, name }, sets the
    // session cookie, and returns the user profile. If it still owns account
    // creation with raw credentials, revert to the email/password payload.
    const { response, result, meta } = await createApiRequest(
      `${API_BASE_URL}/auth/signup`,
      {
        method: "POST",
        body: JSON.stringify({ idToken, name }),
      },
    );

    const user = extractUser(result);
    if (response.ok && user) {
      return { success: true, user, meta };
    }

    return {
      success: false,
      error: extractError(result, "Sign up failed."),
      meta: { ...meta, body: result },
    };
  } catch (error) {
    console.error("Sign up error:", error);
    throw error;
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
  console.debug("[altonautApi] Fetching site orders", {
    siteId: effectiveSiteId,
    url,
  });

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

    console.debug("[altonautApi] Site orders fetched successfully", {
      count: orders.length,
    });
    return { success: true, orders, meta };
  } catch (error) {
    console.error("[altonautApi] Site orders error:", error);
    throw error;
  }
};

/**
 * Get the list of packages available at a site.
 *
 * Unlike getOrders (which returns what a user has already purchased), this
 * returns the site's catalog of purchasable packages. Any authenticated user
 * may call it — auth is carried by the session cookie, no admin headers.
 *
 * GET {API_BASE_URL}/site/{siteId}/vouchers
 *
 * @param {string} [siteId] - Site ID (optional, defaults to path value)
 * @returns {Promise<{ success: boolean, packages?: object[], error?: string, meta?: object }>}
 */
const getPackages = async (siteId) => {
  const pathInfo = getOmadaPathInfo();
  const effectiveSiteId = siteId || pathInfo?.siteId;

  if (!effectiveSiteId) {
    return {
      success: false,
      error: "Site not found. Please contact technical support.",
    };
  }

  const url = `${API_BASE_URL}/site/${encodeURIComponent(effectiveSiteId)}/vouchers`;
  console.debug("[altonautApi] Fetching site packages", {
    siteId: effectiveSiteId,
    url,
  });

  try {
    const { response, result, meta } = await createApiRequest(url, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      // Backend errors (404 "Location not found for site", 401, ...) carry a
      // readable `message`; surface it so the caller can show it verbatim.
      return {
        success: false,
        error: extractError(result, "Failed to fetch packages."),
        meta: { ...meta, body: result },
      };
    }

    // `data` may legitimately be [] when the site has no packages assigned.
    const packages = result?.data || [];
    if (!Array.isArray(packages)) {
      return {
        success: false,
        error: "Invalid packages payload.",
        meta: { ...meta, body: result },
      };
    }

    console.debug("[altonautApi] Site packages fetched successfully", {
      count: packages.length,
    });
    return { success: true, packages, meta };
  } catch (error) {
    console.error("[altonautApi] Site packages error:", error);
    throw error;
  }
};

// Export API
window.altonautApi = {
  login,
  signUp,
  getUser,
  getOrders,
  getPackages,
  getOmadaPathInfo,
};
