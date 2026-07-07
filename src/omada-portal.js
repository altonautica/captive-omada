// Constants and configuration
const AUTH_TYPES = {
  NO_AUTH: 0,
  SIMPLE_PASSWORD: 1,
  EXTERNAL_RADIUS: 2,
  VOUCHER_ACCESS_TYPE: 3,
  LOCAL_USER_ACCESS_TYPE: 5,
  SMS_ACCESS_TYPE: 6,
  RADIUS_ACCESS_TYPE: 8,
  HOTSPOT: 11,
  FORM_AUTH_ACCESS_TYPE: 12,
  EXTERNAL_LDAP: 15,
};

const CONFIG = {
  MAX_INPUT_LENGTH: 2000,
  AJAX_TIMEOUT: 15000,
};

const ERROR_MESSAGES = {
  0: "ok",
  "-1": "General error.",
  "-41500": "Invalid authentication type.",
  "-41501": "Failed to authenticate.",
  "-41502": "Voucher code is incorrect.",
  "-41503": "Voucher is expired.",
  "-41504": "Voucher traffic has exceeded the limit.",
  "-41505": "The number of users has reached the limit.",
  "-41506": "Invalid authorization information.",
  "-41507":
    "Your authentication times out. You can get authenticated again until the next day.",
  "-41508": "Local User traffic has exceeded the limit.",
  "-41512": "Local User is expired.",
  "-41513": "Local User is disabled.",
  "-41514": "MAC address is incorrect.",
  "-41515": "Local User Quota has exceeded the limit.",
  "-41516": "The number of users has reached the limit.",
  "-41517": "Incorrect password.",
  "-41518": "This SSID does not exist.",
  "-41519": "Invalid code.",
  "-41520": "The code is expired.",
  "-41521": "The number of users has reached the limit.",
  "-41522": "Failed to validate the code.",
  "-41523": "Failed to send verification code.",
  "-41524": "Authentication failed because the username does not exist.",
  "-41525": "Authentication failed because of wrong password.",
  "-41526": "Authentication failed because the client is invalid.",
  "-41527": "Authentication failed because the local user is invalid.",
  "-41528": "Failed to decrypt data.",
  "-41529": "Incorrect username or password.",
  "-41530": "Connecting to the RADIUS server times out.",
  "-41531": "Your code has reached your Wi-Fi data limit.",
  "-41532": "Your account has reached your Wi-Fi data limit.",
  "-41533": "Form authentication request is invalid.",
  "-43408": "Invalid LDAP configuration.",
  "-43409": "Invalid LDAP credentials.",
  "-41538": "Voucher is not effective.",
};

// Improved Ajax utility with modern fetch-like interface
const Ajax = {
  async post(url, data) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.timeout = CONFIG.AJAX_TIMEOUT;

      const handleResponse = (ok) => {
        let parsed;
        const raw = xhr.responseText;

        try {
          parsed = raw && raw.length ? JSON.parse(raw) : {};
        } catch (error) {
          parsed = {
            error: "parse_error",
            message: "Non-JSON response",
            rawText: raw,
          };
        }

        resolve({
          ok,
          httpStatus: xhr.status,
          statusText: xhr.statusText,
          result: parsed,
          rawText: raw,
        });
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          handleResponse(xhr.status === 200 || xhr.status === 304);
        }
      };

      xhr.onerror = () => {
        resolve({
          ok: false,
          httpStatus: xhr.status,
          statusText: xhr.statusText,
          result: { error: "network_error" },
        });
      };

      xhr.ontimeout = () => {
        resolve({
          ok: false,
          httpStatus: xhr.status,
          statusText: "Timeout",
          result: { error: "timeout" },
        });
      };

      xhr.send(data);
    });
  },
};

// Utility functions
const DOM = {
  safeById: (id) => document.getElementById(id) || null,

  safeShow: (id, display = "block") => {
    const el = DOM.safeById(id);
    if (el?.style) el.style.display = display;
  },

  safeHide: (id) => {
    const el = DOM.safeById(id);
    if (el?.style) el.style.display = "none";
  },
};

const URLUtils = {
  getQueryParams: () => {
    const params = {};
    try {
      const usp = new URLSearchParams(window.location.search);
      for (const [key, value] of usp.entries()) {
        if (params[key]) {
          if (!Array.isArray(params[key])) params[key] = [params[key]];
          params[key].push(value);
        } else {
          params[key] = value;
        }
      }
    } catch (error) {
      console.error("URLSearchParams error:", error);
      // Fallback for older browsers
      const raw = window.location.search.replace(/^\?/, "");
      raw.split("&").forEach((pair) => {
        if (!pair) return;
        const [k, v] = pair.split("=");
        const key = decodeURIComponent(k || "");
        const val = decodeURIComponent(v || "");
        if (params[key]) {
          if (!Array.isArray(params[key])) params[key] = [params[key]];
          params[key].push(val);
        } else {
          params[key] = val;
        }
      });
    }
    return params;
  },

  getParam: (key) => URLUtils.getQueryParams()[key],
};

// Extract URL parameters
const urlParams = URLUtils.getQueryParams();
const clientMac = urlParams.clientMac;
const apMac = urlParams.apMac;
const gatewayMac = urlParams.gatewayMac;
const ssidName = urlParams.ssidName;
const radioId = urlParams.radioId ? Number(urlParams.radioId) : undefined;
const vid = urlParams.vid ? Number(urlParams.vid) : undefined;
const originUrl = urlParams.originUrl;
const previewSite = urlParams.previewSite;

// Global state
let isCommitted = false;
let globalConfig = {};

// Portal settings readiness promise
let __resolvePortalSettings;
window.__portalSettingsReady = new Promise((resolve) => {
  __resolvePortalSettings = resolve;
});

// Portal configuration handler
const handlePortalResponse = (response) => {
  const payload = response?.result || {};
  const data = payload?.result || {};
  const landingUrl = data.landingUrl;

  globalConfig = {
    authType: AUTH_TYPES.VOUCHER_ACCESS_TYPE,
    hotspotTypes: data.hotspot?.enabledTypes || [],
    buttonText: data.portalCustomize?.buttonText || "Log In",
    formAuthButtonText:
      data.portalCustomize?.formAuthButtonText || "Take the Survey",
    formAuth: data.formAuth || {},
    error: payload.errorCode === 0 ? "ok" : payload.msg || "error",
    countryCode: `+${data.sms?.countryCode || 1}`,
    landingUrl,
  };

  DOM.safeHide("oper-hint");

  // Validate Voucher access availability. In local dev the portal settings
  // endpoint isn't backed by a real Omada controller, so force-enable; in prod
  // derive it from the controller's advertised hotspot types.
  const isLocalDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
    location.hostname,
  );
  const voucherEnabled = isLocalDev
    ? true
    : Array.isArray(globalConfig.hotspotTypes) &&
      globalConfig.hotspotTypes.includes(AUTH_TYPES.VOUCHER_ACCESS_TYPE);

  window.__portalBlockAccess = !voucherEnabled;

  if (!voucherEnabled) {
    const errorMessage =
      "Session invalid: Portal configuration does not allow Voucher access for this SSID/site.";

    if (typeof window.showConfigError === "function") {
      try {
        window.showConfigError(errorMessage);
      } catch (error) {
        console.error("Failed to show config error:", error);
      }
    } else {
      // Fallback DOM operations
      try {
        const authSection = document.getElementById("auth-section");
        const captiveSection = document.getElementById("captive-section");
        const configError = document.getElementById("config-error");

        if (authSection) authSection.style.display = "none";
        if (captiveSection) captiveSection.style.display = "none";
        if (configError) {
          configError.textContent = errorMessage;
          configError.classList.remove("hidden");
        }
      } catch (error) {
        console.error("Fallback config error display failed:", error);
      }
    }
  }

  // Signal readiness regardless of validity
  if (typeof __resolvePortalSettings === "function") {
    __resolvePortalSettings(globalConfig);
  }
};

// Enhanced voucher authentication with better error handling
window.submitVoucherAuth = async function submitVoucherAuth(
  voucherCode,
  callbacks = {},
) {
  const { onStart, onSuccess, onError, onDone } = callbacks;

  // Validation
  if (!voucherCode || typeof voucherCode !== "string") {
    onError && onError("Invalid voucher code.");
    return;
  }

  if (onStart) onStart();

  const payload = JSON.stringify({
    clientMac,
    apMac,
    gatewayMac,
    ssidName,
    radioId,
    vid,
    originUrl,
    authType: AUTH_TYPES.VOUCHER_ACCESS_TYPE,
    voucherCode: voucherCode.trim().slice(0, CONFIG.MAX_INPUT_LENGTH),
  });

  try {
    const response = await Ajax.post("/portal/auth", payload);
    const result = response?.result || {};

    // Extract error code and message
    const errorCode = result.errCode ?? result.errorCode ?? result.code;
    const primaryMsg = result.error || result.message || result.msg;
    const isSuccess = errorCode === 0 || primaryMsg === "ok";

    if (isSuccess) {
      onSuccess && onSuccess(result);

      // Handle redirect
      const redirectUrl =
        (typeof result.result === "string" ? result.result : undefined) ||
        result.landingUrl ||
        globalConfig.landingUrl ||
        originUrl;

      if (redirectUrl) {
        try {
          window.location.replace(redirectUrl);
        } catch (error) {
          console.error("Redirect failed, using fallback:", error);
          window.location.href = redirectUrl;
        }
      }
    } else {
      // Handle authentication errors
      const numericCode = Number(errorCode);
      const misconfigCodes = new Set([-41500, -41533, -41538]);
      const errorKey = String(errorCode ?? (primaryMsg === "ok" ? 0 : -1));
      const fallbackMessage =
        ERROR_MESSAGES[errorKey] || primaryMsg || "Failed to authenticate.";

      const humanMessage = misconfigCodes.has(numericCode)
        ? "Voucher authentication failed on the controller. Please verify that Voucher is enabled and configured for this SSID/site."
        : fallbackMessage;

      onError && onError(humanMessage, result);

      // Update UI hint
      const hintElement = DOM.safeById("oper-hint");
      if (hintElement) {
        let fullMessage = humanMessage;
        if (errorCode !== undefined) fullMessage += ` (code ${errorCode})`;
        hintElement.textContent = fullMessage;
        hintElement.style.display = "block";
      }
    }
  } catch (error) {
    console.error("Voucher authentication error:", error);
    onError &&
      onError("Network error occurred. Please try again.", {
        error: error.message,
      });
  } finally {
    onDone && onDone();
  }
};

// Initialize portal settings
(async function initializePortal() {
  const payload = JSON.stringify({
    clientMac,
    apMac,
    gatewayMac,
    ssidName,
    radioId,
    vid,
    originUrl,
  });

  try {
    const response = await Ajax.post("/portal/getPortalPageSetting", payload);
    handlePortalResponse(response);
  } catch (error) {
    console.error("Failed to fetch portal settings:", error);
    // Signal readiness even on failure so UI can proceed
    if (typeof __resolvePortalSettings === "function") {
      __resolvePortalSettings({ error: "Failed to load portal settings" });
    }
  }
})();
