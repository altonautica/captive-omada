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
    "[firebase.js] Firebase SDK not loaded. Ensure vendor/firebase-app-compat.js " +
      "and vendor/firebase-auth-compat.js are included before this file.",
  );
} else if (Object.values(firebaseConfig).some((v) => v === "REPLACE_ME")) {
  console.error(
    "[firebase.js] Firebase config still contains REPLACE_ME placeholders. " +
      "Sign-in will fail with auth/api-key-not-valid until you paste the real " +
      "Firebase Web config (Console -> Project settings -> Your apps -> Web app).",
  );
} else {
  firebase.initializeApp(firebaseConfig);

  // Captive portal is a one-shot flow; do not persist auth state across visits.
  firebase
    .auth()
    .setPersistence(firebase.auth.Auth.Persistence.NONE)
    .catch((error) => {
      console.warn("[firebase.js] Failed to set auth persistence:", error);
    });

  window.firebaseAuth = firebase.auth();
}
