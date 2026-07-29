// firebase.js
// Initializes the Firebase Web SDK (compat build) for client-side authentication.
// Loaded after vendor/firebase-app-compat.js and vendor/firebase-auth-compat.js,
// and before altonaut.js (which reads window.firebaseAuth in login/signUp).
//
// NOTE (walled garden): the Omada portal runs before internet access is granted,
// so identitytoolkit.googleapis.com and securetoken.googleapis.com must be in the
// controller's walled-garden allowlist for sign-in to succeed at runtime.

// TODO: Replace with the real Firebase Web config for this project.
const firebaseConfig = {
  apiKey: "AIzaSyB8aGKprFUfm8e5KnXeMj_ttpMTDfJ0UEE",
  authDomain: "quota-management-3be9d.firebaseapp.com",
  projectId: "quota-management-3be9d",
  storageBucket: "quota-management-3be9d.firebasestorage.app",
  messagingSenderId: "147199440852",
  appId: "1:147199440852:web:685fb17da0a34e6c8b8841",
};

// Records why init failed so login/signUp can show the actual cause instead of a
// bare "Firebase is not initialized." The portal runs in a phone's captive-network
// mini browser, where nobody can read console output — the message on screen is
// the only diagnostic we get back from a user in the field, so it has to name the
// failing step.
const failInit = (reason) => {
  window.firebaseInitError = reason;
  console.error(`[firebase.js] ${reason}`);
};

if (typeof firebase === "undefined") {
  failInit(
    "Firebase SDK not loaded (window.firebase is undefined). The " +
      "firebase-app-compat script did not load or execute — check that " +
      "www.gstatic.com is reachable from the walled garden on this device " +
      "(a VPN, iCloud Private Relay or encrypted DNS can defeat a " +
      "domain-based allowlist entry).",
  );
} else if (typeof firebase.auth !== "function") {
  // firebase-app-compat loaded but firebase-auth-compat did not attach .auth.
  // In Omada local portals this happens when the (large) auth SDK file is
  // truncated/dropped by the controller. Surface it clearly instead of letting
  // firebase.auth() throw a cryptic "firebase.auth is not a function".
  failInit(
    "Firebase Auth SDK failed to load (firebase.auth is missing) while " +
      "firebase-app-compat loaded fine. The firebase-auth-compat script did " +
      "not load or execute — verify it returns HTTP 200 with its full body " +
      "and is not truncated.",
  );
} else if (Object.values(firebaseConfig).some((v) => v === "REPLACE_ME")) {
  failInit(
    "Firebase config still contains REPLACE_ME placeholders. Sign-in will " +
      "fail with auth/api-key-not-valid until the real Firebase Web config " +
      "is pasted in (Console -> Project settings -> Your apps -> Web app).",
  );
} else {
  try {
    firebase.initializeApp(firebaseConfig);

    // Captive portal is a one-shot flow, so auth must not outlive the tab — but it
    // does have to survive a reload *within* it: on iOS the API is authenticated
    // with a Firebase ID token (the cross-site session cookie is blocked there),
    // and Persistence.NONE would drop the refresh token on reload, leaving only a
    // cached ID token that expires after an hour. SESSION keeps it in
    // sessionStorage, so it still dies with the tab.
    firebase
      .auth()
      .setPersistence(firebase.auth.Auth.Persistence.SESSION)
      .catch((error) => {
        console.warn("[firebase.js] Failed to set auth persistence:", error);
      });

    window.firebaseAuth = firebase.auth();
  } catch (error) {
    // initializeApp/auth() can still throw — e.g. a malformed config, or the
    // portal page getting injected twice (app/duplicate-app).
    failInit(
      "Firebase initialization threw: " +
        `${error?.code || error?.name || "Error"} — ` +
        `${error?.message || String(error)}`,
    );
  }
}
