/**
 * Application configuration constants
 */
const APP_CONFIG = {
  MAX_WAIT_MS: 15000,
  HIDE_ERROR_DELAY: 5000,
};

let isSignUpMode = false;

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
    PackageManager.renderEmbedded();
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
   * Creates a timeout handler for authentication requests
   * @returns {Function} Cleanup function to clear the timeout
   */
  createTimeoutHandler: () => {
    const timeoutId = setTimeout(() => {
      UI.hideLoading();
      UI.showAuthError(
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
   */
  async handleAuthResponse(authPromise, email, clearTimeout) {
    try {
      const result = await authPromise;
      clearTimeout();

      if (result.success) {
        // Auth lives in the session cookie set by the backend; the login
        // response already carries the user profile, so no getUser round-trip
        // is needed. Persist the user as the client-side "logged in" marker.
        const user = result.user || { email };
        sessionStorage.setItem("authUser", JSON.stringify(user));
        UI.hideLoading();
        SectionManager.showCaptiveSection(user);
      } else {
        UI.hideLoading();
        const errorMessage =
          result.error || "Authentication failed. Please try again.";
        UI.showAuthError(errorMessage);
      }
    } catch (error) {
      clearTimeout();
      UI.hideLoading();
      UI.showAuthError("Authentication failed. Please try again.");
      console.error("Authentication error:", error);
    }
  },

  /**
   * Handles user sign up process
   * @param {string} name - User's full name
   * @param {string} email - User's email address
   * @param {string} password - User's password
   */
  async signUp(name, email, password) {
    UI.showLoading();
    const clearTimeout = AuthManager.createTimeoutHandler();
    const authPromise = window.altonautApi.signUp(name, email, password);
    await AuthManager.handleAuthResponse(authPromise, email, clearTimeout);
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
    document.getElementById("auth-form")?.reset();
    document.getElementById("auth-error-message")?.classList.add("hidden");
    SectionManager.showAuthSection();
  },

  /**
   * Toggles between sign in and sign up modes
   */
  toggleMode() {
    isSignUpMode = !isSignUpMode;

    const elements = {
      nameContainer: document.getElementById("auth-name-container"),
      title: document.getElementById("auth-title"),
      subtitle: document.getElementById("auth-subtitle"),
      button: document.getElementById("auth-button"),
      toggleLink: document.getElementById("toggle-auth-mode"),
      toggleText: document.getElementById("auth-toggle-text"),
      errorMessage: document.getElementById("auth-error-message"),
    };

    const config = isSignUpMode
      ? {
          nameVisible: true,
          title: "Create Account",
          subtitle: "Sign up to access the network",
          button: "Sign Up",
          toggleText: "Already have an account?",
          toggleLink: "Sign in instead",
        }
      : {
          nameVisible: false,
          title: "Welcome Back",
          subtitle: "Please sign in with your account to continue",
          button: "Sign In",
          toggleText: "Don't have an account?",
          toggleLink: "Sign up here",
        };

    if (elements.nameContainer) {
      elements.nameContainer.classList.toggle("hidden", !config.nameVisible);
    }
    if (elements.title) elements.title.textContent = config.title;
    if (elements.subtitle) elements.subtitle.textContent = config.subtitle;
    if (elements.button) elements.button.textContent = config.button;
    if (elements.toggleText)
      elements.toggleText.textContent = config.toggleText;
    if (elements.toggleLink)
      elements.toggleLink.textContent = config.toggleLink;

    elements.errorMessage?.classList.add("hidden");
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
 * Manages the site package catalog display (GET /site/{siteId}/vouchers).
 *
 * Packages are the purchasable catalog for a site (name, quota, validity,
 * price) — distinct from orders (what a user already bought). Rendered as
 * display cards; there is no purchase/voucher flow wired to them yet.
 */
const PackageManager = {
  // Formats a number, dropping a trailing ".0" (1 -> "1", 1.5 -> "1.5").
  trimNumber(n) {
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
  },

  // quota/limits arrive in MB; show MB under 1 GB, else GB.
  formatQuota(mb) {
    const n = Number(mb);
    if (!Number.isFinite(n)) return "—";
    if (n < 1024) return `${PackageManager.trimNumber(n)} MB`;
    return `${PackageManager.trimNumber(n / 1024)} GB`;
  },

  // duration arrives in minutes; show minutes/hours under a day, else days.
  formatDuration(minutes) {
    const n = Number(minutes);
    if (!Number.isFinite(n)) return "—";
    if (n < 60) return `${PackageManager.trimNumber(n)} ${n === 1 ? "minute" : "minutes"}`;
    if (n < 1440) {
      const hours = PackageManager.trimNumber(n / 60);
      return `${hours} ${hours === "1" ? "hour" : "hours"}`;
    }
    const days = PackageManager.trimNumber(n / 1440);
    return `${days} ${days === "1" ? "day" : "days"}`;
  },

  // down/up limits arrive in MB (Kbps-equivalent); divide by 1024 for Mbps.
  formatSpeed(mb) {
    const n = Number(mb);
    return Number.isFinite(n) ? PackageManager.trimNumber(n / 1024) : "—";
  },

  /**
   * Fetches packages from the API and renders them into a container.
   * @param {HTMLElement} containerElement - Container to render packages in
   */
  async fetchAndRender(containerElement) {
    if (!containerElement) return;

    containerElement.innerHTML =
      "<div class='text-gray-500 text-center'>Loading packages...</div>";

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
      const result = await window.altonautApi.getPackages(siteId);

      if (result.success && Array.isArray(result.packages)) {
        if (result.packages.length === 0) {
          containerElement.innerHTML =
            "<div class='text-gray-500 text-center'>No packages available at this location yet.</div>";
        } else {
          containerElement.innerHTML = "";
          result.packages.forEach((pkg) => {
            containerElement.appendChild(PackageManager.createPackageCard(pkg));
          });
        }
      } else {
        // Surface the backend's readable message (404/401) when present.
        containerElement.innerHTML = `<div class='text-red-500 text-center'>${result?.error || "Error loading packages. Please try again later."}</div>`;
      }
    } catch (error) {
      containerElement.innerHTML =
        "<div class='text-red-500 text-center'>Error loading packages. Please try again later.</div>";
      console.error("Error fetching packages:", error);
    }
  },

  /**
   * Creates a DOM element for displaying a package.
   * @param {Object} pkg - Package data object
   * @returns {HTMLElement} The created package card element
   */
  createPackageCard(pkg) {
    const card = document.createElement("div");
    card.className = "border rounded-lg p-4 shadow transition";

    const quota = PackageManager.formatQuota(pkg.quota);
    const duration = PackageManager.formatDuration(pkg.duration);
    const down = PackageManager.formatSpeed(pkg.downLimit);
    const up = PackageManager.formatSpeed(pkg.upLimit);

    card.innerHTML = `
            <div class="font-bold text-lg text-primary mb-2">${pkg.packageName || "Unnamed Package"}</div>
            <div class="flex flex-wrap gap-2">
                <span class="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1">${quota}</span>
                <span class="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1">${duration}</span>
                <span class="text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1">↓ ${down} / ↑ ${up} Mbps</span>
            </div>
        `;

    return card;
  },

  /**
   * Renders the embedded package list in the captive portal section.
   */
  renderEmbedded() {
    const container = document.getElementById("order-list-embedded");
    PackageManager.fetchAndRender(container);
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
    document
      .getElementById("toggle-auth-mode")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        AuthManager.toggleMode();
      });

    document.getElementById("auth-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email")?.value;
      const password = document.getElementById("auth-password")?.value;

      if (!email || !password) {
        UI.showAuthError("Please enter both email and password");
        return;
      }

      if (isSignUpMode) {
        const name = document.getElementById("auth-name")?.value;
        if (!name) {
          UI.showAuthError("Please enter your name");
          return;
        }
        AuthManager.signUp(name, email, password);
      } else {
        AuthManager.signIn(email, password);
      }
    });

    document.getElementById("logout-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      AuthManager.logout();
    });

    ["auth-name", "auth-email", "auth-password"].forEach((id) => {
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

      ["focus", "click"].forEach((type) => {
        ["auth-email", "auth-password", "auth-name"].forEach((id) => {
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
window.showConfigError = UI.showConfigError;
window.resolveSiteId = resolveSiteId;
