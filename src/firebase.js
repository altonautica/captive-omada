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

if (typeof firebase === "undefined") {
  console.error(
    "[firebase.js] Firebase SDK not loaded. Ensure the firebase-app-compat and " +
      "firebase-auth-compat scripts are included before this file (and that " +
      "www.gstatic.com is in the Omada walled garden if loading from the CDN).",
  );
} else if (typeof firebase.auth !== "function") {
  // firebase-app-compat loaded but firebase-auth-compat did not attach .auth.
  // In Omada local portals this happens when the (large) auth SDK file is
  // truncated/dropped by the controller. Surface it clearly instead of letting
  // firebase.auth() throw a cryptic "firebase.auth is not a function".
  console.error(
    "[firebase.js] Firebase Auth SDK failed to load (firebase.auth is missing). " +
      "The firebase-auth-compat script did not load or execute — verify it returns " +
      "HTTP 200 with its full body and that www.gstatic.com is in the walled garden.",
  );
} else if (Object.values(firebaseConfig).some((v) => v === "REPLACE_ME")) {
  console.error(
    "[firebase.js] Firebase config still contains REPLACE_ME placeholders. " +
      "Sign-in will fail with auth/api-key-not-valid until you paste the real " +
      "Firebase Web config (Console -> Project settings -> Your apps -> Web app).",
  );
} else {
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
}
