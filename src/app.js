/**
 * Application configuration constants
 */
const APP_CONFIG = {
  MAX_WAIT_MS: 15000,
  HIDE_ERROR_DELAY: 5000,
};

window.addEventListener("error", (e) => {
  console.error("Global error:", e.error || e.message || e);
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason || e);
});

/**
 * Optimizes rendering for Android WebView environments
 */
const optimizeForAndroidWebView = () => {
  try {
    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = ua.includes("android");
    const isWebView =
      ua.includes("wv") ||
      ua.includes("version/") ||
      (ua.includes("chrome/") && !ua.includes("safari/"));

    if (isAndroid && isWebView) {
      document.documentElement.classList.add("no-gpu-effects");
    }
  } catch (error) {
    console.error("Android WebView optimization failed:", error);
  }
};

/**
 * UI utility functions for managing interface states and notifications
 */
const UI = {
  showLoading: () =>
    document.getElementById("loading-overlay")?.classList.remove("hidden"),
  hideLoading: () =>
    document.getElementById("loading-overlay")?.classList.add("hidden"),

  /**
   * Displays an error message in a specified element
   * @param {string} elementId - The ID of the element to show the error in
   * @param {string} message - The error message to display
   * @param {boolean} autoHide - Whether to automatically hide the message after a delay
   */
  showError: (elementId, message, autoHide = true) => {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = message;
    element.classList.remove("hidden");

    if (autoHide) {
      setTimeout(
        () => element.classList.add("hidden"),
        APP_CONFIG.HIDE_ERROR_DELAY,
      );
    }
  },

  showAuthError: (message) => UI.showError("auth-error-message", message),
  showCaptiveError: (message) => UI.showError("oper-hint", message, false),

  /**
   * Shows a sign-in error inside whichever sign-in panel the user is looking at,
   * so a message never lands in the hidden one.
   * @param {string} message
   */
  showActiveAuthError: (message) => {
    if (
      AuthMethodManager.current === "code" &&
      document.getElementById("login-code-error-message")
    ) {
      UI.showError("login-code-error-message", message);
      return;
    }
    UI.showAuthError(message);
  },

  /**
   * Displays a configuration error and hides other UI sections
   * @param {string} message - The error message to display
   */
  showConfigError: (message) => {
    const errorMsg =
      message ||
      "Session invalid: Portal configuration is not supported for this portal.";
    const elements = {
      configError: document.getElementById("config-error"),
      authSection: document.getElementById("auth-section"),
      captiveSection: document.getElementById("captive-section"),
      stepNav: document.getElementById("step-nav"),
    };

    if (elements.configError) {
      elements.configError.textContent = errorMsg;
      elements.configError.classList.remove("hidden");
    }

    [elements.authSection, elements.captiveSection, elements.stepNav].forEach(
      (el) => {
        if (el) el.style.display = "none";
      },
    );
  },
};

/**
 * Resolves the site ID from the Omada portal path information
 * @returns {string|null} The site ID or null if not found
 */
const resolveSiteId = () => {
  try {
    return window.altonautApi?.getOmadaPathInfo?.()?.siteId || null;
  } catch (error) {
    console.error("Failed to resolve site ID:", error);
    return null;
  }
};

/**
 * Manages application sections and step indicators
 */
const SectionManager = {
  /**
   * Updates the visual state of step indicators
   * @param {number} activeStep - The step number to highlight (1 or 2)
   */
  updateStepIndicators: (activeStep) => {
    const step1 = document.getElementById("step1-indicator");
    const step2 = document.getElementById("step2-indicator");

    if (!step1 || !step2) return;

    const activeClasses = ["bg-primary", "text-white"];
    const inactiveClasses = ["bg-gray-200", "text-gray-600"];

    [step1, step2].forEach((step) => {
      step.classList.remove(...activeClasses, ...inactiveClasses);
    });

    if (activeStep === 1) {
      step1.classList.add(...activeClasses);
      step2.classList.add(...inactiveClasses);
    } else {
      step1.classList.add(...inactiveClasses);
      step2.classList.add(...activeClasses);
    }
  },

  /**
   * Shows the captive portal section with user information
   * @param {Object} user - User object containing email and other details
   */
  showCaptiveSection: (user) => {
    const elements = {
      authSection: document.getElementById("auth-section"),
      captiveSection: document.getElementById("captive-section"),
      userEmail: document.getElementById("logged-user-email"),
    };

    if (elements.authSection) elements.authSection.style.display = "none";
    if (elements.captiveSection)
      elements.captiveSection.style.display = "block";
    if (elements.userEmail) elements.userEmail.textContent = user.email;

    SectionManager.updateStepIndicators(2);
    MyVouchersManager.renderEmbedded();
  },

  /**
   * Shows the authentication section
   */
  showAuthSection: () => {
    const elements = {
      authSection: document.getElementById("auth-section"),
      captiveSection: document.getElementById("captive-section"),
    };

    if (elements.authSection) elements.authSection.style.display = "block";
    if (elements.captiveSection) elements.captiveSection.style.display = "none";

    SectionManager.updateStepIndicators(1);
  },
};

/**
 * Handles user authentication operations
 */
const AuthManager = {
  /**
   * Clears an invalid local session and returns the user to sign-in.
   * @param {string} [message]
   */
  expireSession(message = "Your session has expired. Please sign in again.") {
    sessionStorage.removeItem("authUser");
    window.altonautApi?.clearIdToken?.();
    LoginCodeManager.reset();
    SectionManager.showAuthSection();
    UI.showActiveAuthError(message);
  },

  /**
   * Creates a timeout handler for authentication requests
   * @param {Function} [showError] - Where to report the timeout (defaults to the
   *   password panel's error area).
   * @returns {Function} Cleanup function to clear the timeout
   */
  createTimeoutHandler: (showError = UI.showAuthError) => {
    const timeoutId = setTimeout(() => {
      UI.hideLoading();
      showError(
        "Request is taking too long. Please check your connection and try again.",
      );
    }, APP_CONFIG.MAX_WAIT_MS);

    return () => clearTimeout(timeoutId);
  },

  /**
   * Handles authentication response and user session setup
   * @param {Promise} authPromise - Promise that resolves to auth result
   * @param {string} email - User's email address
   * @param {Function} clearTimeout - Function to clear the timeout
   * @param {Function} [onFailure] - Handles an unsuccessful result; defaults to
   *   showing its error in the password panel.
   * @returns {Promise<object>} The auth result (or a failure stub on throw).
   */
  async handleAuthResponse(authPromise, email, clearTimeout, onFailure) {
    const handleFailure =
      onFailure ||
      ((result) =>
        UI.showAuthError(
          result?.error || "Authentication failed. Please try again.",
        ));

    try {
      const result = await authPromise;
      clearTimeout();

      if (result.success) {
        // Auth lives in the session cookie set by the backend; the login
        // response already carries the user profile, so no getUser round-trip
        // is needed. Persist the user as the client-side "logged in" marker.
        const user = result.user || { email };
        sessionStorage.setItem("authUser", JSON.stringify(user));

        // Fire-and-forget: log the login activity now that the AuthToken session
        // cookie is set. Never awaited/blocking — a logging failure must not gate
        // the user's internet access (handled/swallowed inside the API helper).
        window.altonautApi?.logCaptivePortalActivity?.();

        UI.hideLoading();
        SectionManager.showCaptiveSection(user);
        return result;
      }

      UI.hideLoading();
      handleFailure(result);
      return result;
    } catch (error) {
      clearTimeout();
      UI.hideLoading();
      console.error("Authentication error:", error);
      const failure = {
        success: false,
        error: "Authentication failed. Please try again.",
      };
      handleFailure(failure);
      return failure;
    }
  },

  /**
   * Handles user sign in process
   * @param {string} email - User's email address
   * @param {string} password - User's password
   */
  async signIn(email, password) {
    UI.showLoading();
    const clearTimeout = AuthManager.createTimeoutHandler();
    const authPromise = window.altonautApi.login(email, password);
    await AuthManager.handleAuthResponse(authPromise, email, clearTimeout);
  },

  /**
   * Logs out the current user and resets the interface
   */
  logout() {
    sessionStorage.removeItem("authUser");
    window.altonautApi?.clearIdToken?.();
    window.firebaseAuth?.signOut?.().catch(() => {});
    document.getElementById("auth-form")?.reset();
    AuthManager.setPasswordVisibility(false);
    LoginCodeManager.reset();
    document.getElementById("auth-error-message")?.classList.add("hidden");
    SectionManager.showAuthSection();
  },

  /**
   * Sets whether the password value is visible.
   * @param {boolean} isVisible
   */
  setPasswordVisibility(isVisible) {
    const input = document.getElementById("auth-password");
    const toggle = document.getElementById("toggle-password");
    if (!input || !toggle) return;

    input.type = isVisible ? "text" : "password";
    toggle.textContent = isVisible ? "Hide" : "Unhide";
    toggle.setAttribute("aria-pressed", String(isVisible));
  },
};

/**
 * Chooses between the two ways in: the 6-digit login code (the default) and the
 * email + password form. Both options stay visible at all times — a user who
 * cannot use one must always be able to reach the other in a single tap. That
 * matters more now that codes lead: the per-IP attempt budget is shared by the
 * whole vessel, so the password form is the fallback for everyone it locks out.
 */
const AUTH_METHOD_STORAGE_KEY = "altonautPortalAuthMethod";

const AuthMethodManager = {
  current: "code",

  panels: () => ({
    password: document.getElementById("auth-form"),
    code: document.getElementById("login-code-form"),
  }),

  tabs: () => ({
    password: document.getElementById("auth-method-password"),
    code: document.getElementById("auth-method-code"),
  }),

  /**
   * The method this device last used. Only ever the *choice* — a login code is
   * a live credential and is never persisted anywhere.
   * @returns {"password"|"code"|null}
   */
  readRemembered() {
    try {
      const value = localStorage.getItem(AUTH_METHOD_STORAGE_KEY);
      return value === "code" || value === "password" ? value : null;
    } catch {
      // Storage can be unavailable (private mode); fall back to the default.
      return null;
    }
  },

  remember(method) {
    try {
      localStorage.setItem(AUTH_METHOD_STORAGE_KEY, method);
    } catch {
      // no-op
    }
  },

  /**
   * @param {"password"|"code"} method
   * @param {{ remember?: boolean, focusPanel?: boolean }} [options]
   */
  select(method, { remember = true, focusPanel = false } = {}) {
    if (method !== "password" && method !== "code") return;

    this.current = method;
    if (remember) this.remember(method);

    const panels = this.panels();
    Object.keys(panels).forEach((name) => {
      panels[name]?.classList.toggle("hidden", name !== method);
    });

    const tabs = this.tabs();
    Object.keys(tabs).forEach((name) => {
      const tab = tabs[name];
      if (!tab) return;
      const selected = name === method;
      tab.classList.toggle("is-selected", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    // An error belongs to the panel that produced it; drop the other one's.
    document
      .getElementById(
        method === "code" ? "auth-error-message" : "login-code-error-message",
      )
      ?.classList.add("hidden");

    if (focusPanel) {
      const field =
        method === "code"
          ? document.getElementById("login-code-1")
          : document.getElementById("auth-email");
      field?.focus();
    }
  },

  handleTabKeydown(event, method) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;

    event.preventDefault();
    const next =
      event.key === "Home"
        ? "code"
        : event.key === "End"
          ? "password"
          : method === "code"
            ? "password"
            : "code";
    this.select(next);
    this.tabs()[next]?.focus();
  },

  setup() {
    const tabs = this.tabs();
    Object.keys(tabs).forEach((method) => {
      const tab = tabs[method];
      if (!tab) return;
      tab.addEventListener("click", () => this.select(method));
      tab.addEventListener("keydown", (event) =>
        this.handleTabKeydown(event, method),
      );
    });

    document
      .getElementById("use-password-instead")
      ?.addEventListener("click", () =>
        this.select("password", { focusPanel: true }),
      );

    // Remembering only changes which option starts selected; the other stays
    // visible without a tap-and-search.
    this.select(this.readRemembered() || "code", { remember: false });
  },
};

/**
 * Drives the 6-digit login code panel.
 *
 * Every failed attempt spends from a rate-limit budget that is shared by the
 * whole vessel (10 per 15 minutes, per IP — and one Wi-Fi is one IP), so this
 * rejects malformed input itself, refuses to double-submit, and never retries
 * on its own.
 */
const LoginCodeManager = {
  LENGTH: 6,
  submitting: false,

  inputs() {
    return Array.from(
      document.querySelectorAll("#login-code-inputs .login-code-input"),
    );
  },

  /** @returns {string} The digits entered so far. */
  value() {
    return this.inputs()
      .map((input) => input.value.replace(/\D/g, "").slice(0, 1))
      .join("");
  },

  showError(message) {
    UI.showError("login-code-error-message", message, false);
  },

  hideError() {
    document
      .getElementById("login-code-error-message")
      ?.classList.add("hidden");
  },

  clear({ focus = true } = {}) {
    const inputs = this.inputs();
    inputs.forEach((input) => {
      input.value = "";
    });
    if (focus) inputs[0]?.focus();
  },

  /** Returns the panel to a clean, usable state. */
  reset() {
    this.setSubmitting(false);
    this.clear({ focus: false });
    this.hideError();
  },

  setSubmitting(isSubmitting) {
    this.submitting = isSubmitting;

    const button = document.getElementById("login-code-button");
    if (button) button.disabled = isSubmitting;
    this.inputs().forEach((input) => {
      input.disabled = isSubmitting;
    });
  },

  /**
   * Writes digits left to right from `startIndex`, then parks the caret on the
   * first still-empty box.
   */
  fill(startIndex, digits) {
    const inputs = this.inputs();

    digits.split("").forEach((digit, offset) => {
      const input = inputs[startIndex + offset];
      if (input) input.value = digit;
    });

    const nextEmpty = inputs.findIndex((input) => !input.value);
    const target = nextEmpty === -1 ? inputs[inputs.length - 1] : inputs[nextEmpty];
    target?.focus();
    target?.select?.();
  },

  handleInput(index, event) {
    const input = event.target;
    const digits = input.value.replace(/\D/g, "");

    // A box can receive more than one digit — a paste into it, or a browser
    // autofilling the whole code into the first field. Spread it instead of
    // dropping the rest.
    input.value = "";
    this.hideError();

    if (!digits) return;

    this.fill(index, digits.slice(0, this.LENGTH - index));

    // Submitting on the sixth digit is the point of this screen: typing six
    // characters and then hunting for a button is the friction it removes.
    if (this.value().length === this.LENGTH) this.submit();
  },

  handleKeydown(index, event) {
    const inputs = this.inputs();

    if (event.key === "Backspace") {
      // Let the browser clear a filled box; step back out of an empty one.
      if (inputs[index]?.value) return;
      const previous = inputs[index - 1];
      if (!previous) return;
      event.preventDefault();
      previous.value = "";
      previous.focus();
      return;
    }

    if (event.key === "ArrowLeft" && inputs[index - 1]) {
      event.preventDefault();
      inputs[index - 1].focus();
      return;
    }

    if (event.key === "ArrowRight" && inputs[index + 1]) {
      event.preventDefault();
      inputs[index + 1].focus();
    }
  },

  handlePaste(index, event) {
    const text = event.clipboardData?.getData("text") ?? "";
    // People read codes aloud in groups and paste them that way ("041 820",
    // "041-820"). Strip the separators rather than letting them reach the API,
    // where they would cost the vessel a 422.
    const digits = text.replace(/\D/g, "");
    if (!digits) return;

    event.preventDefault();
    this.hideError();

    // A whole code replaces whatever is there; a single digit lands where it
    // was dropped.
    const start = digits.length > 1 ? 0 : index;
    if (start === 0) this.clear({ focus: false });
    this.fill(start, digits.slice(0, this.LENGTH - start));

    if (this.value().length === this.LENGTH) this.submit();
  },

  async submit() {
    // A double submit spends two of the vessel's shared attempts, and the
    // second always fails because the first consumed the code.
    if (this.submitting) return;

    const code = this.value();
    if (code.length !== this.LENGTH) {
      this.showError(`Enter all ${this.LENGTH} digits.`);
      const firstEmpty = this.inputs().find((input) => !input.value);
      firstEmpty?.focus();
      return;
    }

    // The Omada controller has been seen dropping script files outright; fail
    // over to the form that still works rather than hanging on a disabled one.
    if (typeof window.altonautApi?.loginWithCode !== "function") {
      this.showError(
        "Signing in with a code is unavailable. Please use your email and password.",
      );
      AuthMethodManager.select("password", { remember: false });
      UI.showError(
        "auth-error-message",
        "Signing in with a code is unavailable. Please use your email and password.",
        false,
      );
      return;
    }

    this.hideError();
    this.setSubmitting(true);
    UI.showLoading();

    const clearTimeout = AuthManager.createTimeoutHandler((message) =>
      this.showError(message),
    );

    const result = await AuthManager.handleAuthResponse(
      window.altonautApi.loginWithCode(code),
      undefined,
      clearTimeout,
      (failure) => this.handleFailure(failure),
    );

    this.setSubmitting(false);

    // Success lands on the existing post-login path — same session, same
    // activity log, same voucher screens. Nothing branches on how we got here;
    // all that is left is to not leave a live credential sitting in the DOM.
    if (result?.success) this.clear({ focus: false });
  },

  handleFailure(result) {
    // Re-enable first so the handlers below can move focus.
    this.setSubmitting(false);

    const message = result?.error || "Sign in failed. Please try again.";

    if (result?.throttled) {
      // The per-IP budget is spent for everyone on this Wi-Fi, so the password
      // form is the only way in — put the user on it rather than leaving them
      // to find it.
      this.clear({ focus: false });
      AuthMethodManager.select("password", {
        remember: false,
        focusPanel: true,
      });
      UI.showError("auth-error-message", message, false);
      return;
    }

    this.showError(message);

    // A rejected or spent code is dead: the next move is a fresh one off the
    // profile, never a retry of the same six digits.
    if (result?.codeSpent || result?.meta?.status === 401) {
      this.clear();
      return;
    }

    const firstEmpty = this.inputs().find((input) => !input.value);
    (firstEmpty || this.inputs()[0])?.focus();
  },

  setup() {
    this.inputs().forEach((input, index) => {
      input.addEventListener("input", (event) => this.handleInput(index, event));
      input.addEventListener("keydown", (event) =>
        this.handleKeydown(index, event),
      );
      input.addEventListener("paste", (event) => this.handlePaste(index, event));
      // Focusing a filled box selects it, so the next digit replaces it.
      input.addEventListener("focus", () => input.select?.());
    });

    document
      .getElementById("login-code-form")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submit();
      });
  },
};

/**
 * Manages order display and interaction
 */
const OrderManager = {
  /**
   * Fetches orders from API and renders them in the specified container
   * @param {HTMLElement} containerElement - Container to render orders in
   * @param {boolean} isEmbedded - Whether this is embedded in the main flow
   */
  async fetchAndRender(containerElement, isEmbedded = false) {
    if (!containerElement) return;

    containerElement.innerHTML =
      "<div class='text-gray-500 text-center'>Loading...</div>";

    if (!sessionStorage.getItem("authUser")) {
      containerElement.innerHTML =
        "<div class='text-red-500 text-center'>Not authenticated.</div>";
      return;
    }

    const siteId = resolveSiteId();
    if (!siteId) {
      containerElement.innerHTML =
        "<div class='text-red-500 text-center'>Site not found. Please contact technical support.</div>";
      return;
    }

    try {
      const result = await window.altonautApi.getOrders(siteId);

      if (result.success && Array.isArray(result.orders)) {
        if (result.orders.length === 0) {
          containerElement.innerHTML =
            "<div class='text-gray-500 text-center'>No orders found.</div>";
        } else {
          containerElement.innerHTML = "";
          result.orders.forEach((order) => {
            const orderCard = OrderManager.createOrderCard(order, isEmbedded);
            containerElement.appendChild(orderCard);
          });
        }
      } else {
        const errorMsg =
          result?.error === "Site not found. Please contact technical support."
            ? "Site not found. Please contact technical support."
            : "Error loading orders. Please try again later.";
        containerElement.innerHTML = `<div class='text-red-500 text-center'>${errorMsg}</div>`;
      }
    } catch (error) {
      containerElement.innerHTML =
        "<div class='text-red-500 text-center'>Error loading orders. Please try again later.</div>";
      console.error("Error fetching orders:", error);
    }
  },

  /**
   * Creates a DOM element for displaying an order
   * @param {Object} order - Order data object
   * @param {boolean} isEmbedded - Whether this card is in embedded mode
   * @returns {HTMLElement} The created order card element
   */
  createOrderCard(order, isEmbedded = false) {
    const validUntil = order.validUntil ? new Date(order.validUntil) : null;
    const validText = validUntil
      ? validUntil.toLocaleString()
      : order.validUntil || "N/A";

    const card = document.createElement("div");
    card.className =
      "border rounded-lg p-4 shadow hover:bg-blue-100 cursor-pointer transition";

    card.innerHTML = `
            <div class="font-bold text-lg text-primary mb-1">${order.packageName || "Unknown Package"}</div>
            <div class="text-gray-700 mb-2">${order.description || ""}</div>
            <div class="text-xs text-gray-500">Valid Until: ${validText}</div>
            <div class="text-xs text-gray-500">Speed: ${order.speed || "N/A"}</div>
        `;

    if (isEmbedded) {
      card.addEventListener("click", () => VoucherManager.useOrder(order));
    }

    return card;
  },

  /**
   * Shows the order list modal
   */
  showModal() {
    document.getElementById("order-list-section")?.classList.remove("hidden");
    const orderList = document.getElementById("order-list");
    OrderManager.fetchAndRender(orderList, false);
  },

  /**
   * Renders the embedded order list in the captive portal section
   */
  renderEmbedded() {
    const orderList = document.getElementById("order-list-embedded");
    OrderManager.fetchAndRender(orderList, true);
  },
};

/**
 * Manages the authenticated user's server-grouped voucher history.
 */
const MyVouchersManager = {
  container: null,
  activeTab: "active",
  vouchers: { active: [], past: [] },

  statusLabel(status) {
    return (
      {
        0: "Unused",
        1: "Used",
        2: "Expired",
      }[status] || "Unknown"
    );
  },

  formatDate(value, nullFallback) {
    if (value === null || value === undefined || value === "") {
      return nullFallback;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown date";

    const day = String(date.getDate()).padStart(2, "0");
    const month = date.toLocaleString("en-US", { month: "short" });
    return `${day} ${month} ${date.getFullYear()}`;
  },

  formatQuota(value) {
    if (value === null || value === undefined || value === "") return null;

    const mb = Number(value);
    if (Number.isNaN(mb)) return null;

    if (mb >= 1024) {
      const gb = mb / 1024;
      return `${Number.isInteger(gb) ? gb : gb.toFixed(2)} GB`;
    }
    return `${mb} MB`;
  },

  createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  },

  showLoading(containerElement) {
    containerElement.innerHTML = `
      <div class="space-y-3" role="status" aria-label="Loading vouchers">
        <span class="sr-only">Loading vouchers...</span>
        <div class="animate-pulse bg-gray-200 rounded-lg h-24"></div>
        <div class="animate-pulse bg-gray-200 rounded-lg h-24"></div>
      </div>
    `;
  },

  async fetchAndRender(containerElement, resetTab = false) {
    if (!containerElement) return;

    this.container = containerElement;
    if (resetTab) this.activeTab = "active";
    this.showLoading(containerElement);

    if (!sessionStorage.getItem("authUser")) {
      AuthManager.expireSession("Please sign in to view your vouchers.");
      return;
    }

    try {
      const result = await window.altonautApi.getMyVouchers();

      if (result.success && result.vouchers) {
        this.vouchers = result.vouchers;
        this.render();
        return;
      }

      if (result?.meta?.status === 401 || result?.meta?.status === 403) {
        AuthManager.expireSession();
        return;
      }

      this.renderError(
        result?.error || "Unable to load vouchers. Please try again.",
      );
    } catch (error) {
      console.error("Error fetching vouchers:", error);
      this.renderError("Unable to load vouchers. Please try again.");
    }
  },

  renderError(message) {
    if (!this.container) return;
    this.container.innerHTML = "";

    const error = this.createTextElement(
      "p",
      "text-red-600 text-center mb-3",
      message,
    );
    error.setAttribute("role", "alert");

    const retry = this.createTextElement(
      "button",
      "w-full border border-primary text-primary font-semibold py-2 px-4 rounded-lg focus-ring",
      "Retry",
    );
    retry.type = "button";
    retry.addEventListener("click", () => this.refresh());

    this.container.append(error, retry);
  },

  render() {
    if (!this.container) return;
    this.container.innerHTML = "";

    const tabList = document.createElement("div");
    tabList.className = "voucher-tab-list mb-4";
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "Voucher history");

    ["active", "past"].forEach((tabName) => {
      const selected = this.activeTab === tabName;
      const label = tabName === "active" ? "Active" : "Past";
      const button = this.createTextElement(
        "button",
        selected
          ? "bg-primary text-white font-semibold py-2 px-3 rounded-lg focus-ring"
          : "bg-gray-100 text-gray-700 font-semibold py-2 px-3 rounded-lg focus-ring",
        `${label} (${this.vouchers[tabName].length})`,
      );

      button.type = "button";
      button.id = `voucher-tab-${tabName}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute("aria-controls", "voucher-tab-panel");
      button.tabIndex = selected ? 0 : -1;
      button.addEventListener("click", () => this.selectTab(tabName, true));
      button.addEventListener("keydown", (event) =>
        this.handleTabKeydown(event, tabName),
      );
      tabList.appendChild(button);
    });

    const panel = document.createElement("div");
    panel.id = "voucher-tab-panel";
    panel.className = "space-y-4";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `voucher-tab-${this.activeTab}`);
    panel.tabIndex = 0;

    const selectedVouchers = this.vouchers[this.activeTab];
    if (selectedVouchers.length === 0) {
      panel.appendChild(
        this.createTextElement(
          "p",
          "text-gray-500 text-center py-6",
          this.activeTab === "active"
            ? "You have no active vouchers."
            : "You have no past vouchers.",
        ),
      );
    } else {
      selectedVouchers.forEach((voucher) => {
        panel.appendChild(
          this.createVoucherCard(voucher, this.activeTab === "active"),
        );
      });
    }

    this.container.append(tabList, panel);
  },

  selectTab(tabName, focusTab = false) {
    if (tabName !== "active" && tabName !== "past") return;
    this.activeTab = tabName;
    this.render();
    if (focusTab) document.getElementById(`voucher-tab-${tabName}`)?.focus();
  },

  handleTabKeydown(event, tabName) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;

    event.preventDefault();
    const nextTab =
      event.key === "Home"
        ? "active"
        : event.key === "End"
          ? "past"
          : tabName === "active"
            ? "past"
            : "active";
    this.selectTab(nextTab, true);
  },

  createDetail(label, value) {
    const row = document.createElement("p");
    row.className = "text-sm text-gray-600";

    const labelElement = this.createTextElement(
      "span",
      "font-medium text-gray-700",
      `${label}: `,
    );
    row.append(labelElement, document.createTextNode(value));
    return row;
  },

  createVoucherCard(voucher, isActive) {
    const card = document.createElement("article");
    card.className =
      "border border-gray-200 rounded-lg p-4 shadow flex items-center justify-between gap-4";

    const content = document.createElement("div");
    content.className = "flex-1 min-w-0";

    const header = document.createElement("div");
    header.className = "flex items-center flex-wrap gap-3 mb-3";

    const packageName = this.createTextElement(
      "h3",
      "font-bold text-lg text-primary",
      voucher.packageName || "Unknown package",
    );
    const status = this.createTextElement(
      "span",
      "text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1",
      this.statusLabel(voucher.status),
    );
    header.append(packageName, status);

    content.append(
      header,
      this.createDetail(
        "Assigned",
        this.formatDate(voucher.assignedAt, "Not assigned"),
      ),
      this.createDetail(
        "Expires",
        this.formatDate(voucher.expirationDate, "Does not expire"),
      ),
    );

    const totalQuota = this.formatQuota(voucher.totalQuota);
    if (totalQuota !== null) {
      const usedQuota = this.formatQuota(voucher.usedQuota) || "0 MB";
      content.appendChild(
        this.createDetail("Data", `${usedQuota} / ${totalQuota}`),
      );
    }

    card.appendChild(content);

    if (isActive) {
      const useButton = this.createTextElement(
        "button",
        "flex-shrink-0 bg-primary hover:bg-primary-dark text-white font-semibold py-2 px-4 rounded-lg focus-ring",
        "Use Voucher",
      );
      useButton.type = "button";
      useButton.setAttribute(
        "aria-label",
        `Use voucher for ${voucher.packageName || "package"}`.trim(),
      );
      useButton.addEventListener("click", () =>
        VoucherManager.useOrder(voucher),
      );

      card.appendChild(useButton);
    }

    return card;
  },

  refresh() {
    const container =
      this.container || document.getElementById("voucher-list-embedded");
    return this.fetchAndRender(container);
  },

  renderEmbedded() {
    const container = document.getElementById("voucher-list-embedded");
    return this.fetchAndRender(container, true);
  },
};

/**
 * Handles voucher authentication operations
 */
const VoucherManager = {
  /**
   * Uses an order's voucher code for authentication
   * @param {Object} order - Order object containing voucher information
   */
  useOrder(order) {
    const voucher = order?.voucherCode || order?.voucher || order?.code;
    if (!voucher) {
      UI.showCaptiveError(
        "Selected order has no voucher code. Please contact support.",
      );
      return;
    }

    if (typeof window.submitVoucherAuth !== "function") {
      UI.showCaptiveError(
        "Voucher authentication is not available. Please contact support.",
      );
      return;
    }

    const callbacks = {
      onStart: () => {
        UI.showLoading();
        const success = document.getElementById("captive-success-message");
        if (success) success.classList.add("hidden");
      },
      onSuccess: () => {
        const success = document.getElementById("captive-success-message");
        if (success) {
          success.textContent = "Authentication successful! Redirecting...";
          success.classList.remove("hidden");
        }
      },
      onError: (message) => {
        UI.showCaptiveError(message || "Failed to authenticate with voucher.");
      },
      onDone: () => UI.hideLoading(),
    };

    window.submitVoucherAuth(voucher, callbacks);
  },
};

/**
 * Sets up and manages DOM event listeners
 */
const EventManager = {
  /**
   * Initializes all event listeners for the application
   */
  setup() {
    AuthMethodManager.setup();
    LoginCodeManager.setup();

    document
      .getElementById("toggle-password")
      ?.addEventListener("click", () => {
        const password = document.getElementById("auth-password");
        AuthManager.setPasswordVisibility(password?.type === "password");
      });

    document.getElementById("auth-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email")?.value;
      const password = document.getElementById("auth-password")?.value;

      if (!email || !password) {
        UI.showAuthError("Please enter both email and password");
        return;
      }

      AuthManager.signIn(email, password);
    });

    document.getElementById("logout-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      AuthManager.logout();
    });

    ["auth-email", "auth-password"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener("input", () => {
          document
            .getElementById("auth-error-message")
            ?.classList.add("hidden");
        });
      }
    });

    document
      .getElementById("close-order-list")
      ?.addEventListener("click", () => {
        document.getElementById("order-list-section")?.classList.add("hidden");
      });

    document
      .getElementById("form-auth-close")
      ?.addEventListener("click", () => {
        document.getElementById("form-auth-msg")?.classList.add("hidden");
      });
  },
};

/**
 * Manages keyboard behavior and viewport adjustments for mobile devices
 */
const KeyboardManager = {
  /**
   * Sets up keyboard and viewport management for mobile devices
   */
  setup() {
    try {
      const visualViewport = window.visualViewport;
      const root = document.documentElement;
      const body = document.body;

      const handleViewportChange = () => {
        if (!visualViewport) return;

        root.style.setProperty("--vvh", visualViewport.height + "px");
        const keyboardOffset = Math.max(
          0,
          window.innerHeight - visualViewport.height,
        );
        root.style.setProperty("--kb-offset", keyboardOffset + "px");

        body.classList.toggle("keyboard-open", keyboardOffset > 60);
      };

      if (visualViewport) {
        ["resize", "scroll"].forEach((event) => {
          visualViewport.addEventListener(event, handleViewportChange);
        });
        window.addEventListener("resize", handleViewportChange);
        handleViewportChange();
      }

      const ensureInputVisible = (event) => {
        const element = event.target;
        if (!(element instanceof HTMLElement)) return;

        setTimeout(() => {
          try {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch (error) {
            console.error("Scroll into view failed:", error);
          }
        }, 100);
      };

      const scrollableFieldIds = [
        "auth-email",
        "auth-password",
        ...Array.from({ length: 6 }, (_, i) => `login-code-${i + 1}`),
      ];

      ["focus", "click"].forEach((type) => {
        scrollableFieldIds.forEach((id) => {
          document
            .getElementById(id)
            ?.addEventListener(type, ensureInputVisible);
        });
      });
    } catch (error) {
      console.error("Keyboard manager setup failed:", error);
    }
  },
};

/**
 * Manages modal creation and initialization
 */
const ModalManager = {
  /**
   * Creates and initializes the order list modal
   */
  initializeOrderListModal() {
    const modal = document.createElement("div");
    modal.id = "order-list-section";
    modal.className =
      "hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "order-list-title");

    modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6">
                <h2 id="order-list-title" class="text-xl font-bold mb-4 text-gray-900">Your Orders</h2>
                <div id="order-list" class="space-y-4"></div>
                <button id="close-order-list" class="mt-6 w-full bg-primary hover:bg-primary-dark text-white font-semibold py-2 px-4 rounded-lg">Close</button>
            </div>
        `;

    document.body.appendChild(modal);
  },
};

/**
 * Main application controller
 */
const App = {
  /**
   * Initializes the entire application
   */
  async initialize() {
    optimizeForAndroidWebView();
    ModalManager.initializeOrderListModal();
    EventManager.setup();
    KeyboardManager.setup();

    try {
      const portalSettings =
        window.__portalSettingsReady instanceof Promise
          ? window.__portalSettingsReady
          : Promise.resolve();

      await portalSettings;

      if (window.__portalBlockAccess) {
        UI.showConfigError(
          "Session invalid: Voucher access is not enabled for this portal.",
        );
        return;
      }

      SectionManager.showAuthSection();
    } catch (error) {
      console.error("Portal settings initialization failed:", error);
      SectionManager.showAuthSection();
    }
  },
};

document.addEventListener("DOMContentLoaded", () => {
  App.initialize().catch((error) => {
    console.error("App initialization failed:", error);
  });
});

window.showCaptiveError = UI.showCaptiveError;
window.useOrderForVoucher = VoucherManager.useOrder;
window.refreshMyVouchers = () => MyVouchersManager.refresh();
window.showConfigError = UI.showConfigError;
window.resolveSiteId = resolveSiteId;
