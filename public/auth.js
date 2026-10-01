const AUTH_SDK_VERSION = "12.19.0";
const authShell = document.getElementById("auth-shell");
const analyzer = document.getElementById("analyzer-app");
const footer = document.getElementById("site-footer");
const accountTools = document.getElementById("account-tools");
const accountEmail = document.getElementById("account-email");
const accountMessage = document.getElementById("account-message");
const form = document.getElementById("auth-form");
const nameField = document.getElementById("auth-name-field");
const nameInput = document.getElementById("auth-name");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const submitButton = document.getElementById("auth-submit");
const submitLabel = document.getElementById("auth-submit-label");
const spinner = submitButton.querySelector(".spinner");
const message = document.getElementById("auth-message");
const loginTab = document.getElementById("auth-login-tab");
const registerTab = document.getElementById("auth-register-tab");
const signOutButton = document.getElementById("sign-out-btn");
const googleButton = document.getElementById("auth-google");
const googleLabel = document.getElementById("auth-google-label");

let mode = "login";
let auth = null;
let authActions = null;
let busy = false;
let previousUser = null;

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";
  nameField.hidden = !registering;
  nameInput.required = registering;
  passwordInput.autocomplete = registering
    ? "new-password"
    : "current-password";
  loginTab.classList.toggle("is-active", !registering);
  registerTab.classList.toggle("is-active", registering);
  loginTab.setAttribute("aria-selected", String(!registering));
  registerTab.setAttribute("aria-selected", String(registering));
  document.getElementById("auth-form-title").textContent = registering
    ? "Create your account"
    : "Welcome back";
  document.getElementById("auth-form-description").textContent = registering
    ? "Set up your account to open your resume workspace."
    : "Use your email and password to log in.";
  submitLabel.textContent = registering ? "Create Account" : "Login";
  showMessage("");
}

function setBusy(nextBusy, label) {
  busy = nextBusy;
  submitButton.disabled = busy || !auth;
  loginTab.disabled = busy;
  registerTab.disabled = busy;
  googleButton.disabled = busy || !authActions;
  spinner.hidden = !busy;
  if (label) submitLabel.textContent = label;
  else
    submitLabel.textContent = mode === "register" ? "Create Account" : "Login";
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use":
      "An account already exists for this email. Log in instead.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
    "auth/network-request-failed":
      "Could not reach Firebase. Check your connection and try again.",
    "auth/operation-not-allowed":
      "This sign-in method is not enabled for this Firebase project.",
    "auth/popup-closed-by-user":
      "Google sign-in was cancelled. Try again when ready.",
    "auth/popup-blocked":
      "Your browser blocked the Google sign-in popup. Allow popups and try again.",
    "auth/unauthorized-domain":
      "This domain is not authorized for Firebase sign-in. Add it in Firebase Authentication settings.",
    "auth/account-exists-with-different-credential":
      "An account already exists with this email. Log in using its original sign-in method.",
  };
  return (
    messages[error.code] ||
    error.message ||
    "Authentication failed. Please try again."
  );
}

async function submitAuth(event) {
  event.preventDefault();
  if (busy || !authActions) return;
  showMessage("");
  setBusy(true, mode === "register" ? "Creating account..." : "Logging in...");

  try {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (mode === "register") {
      const credential = await authActions.createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const displayName = nameInput.value.trim();
      if (displayName)
        await authActions.updateProfile(credential.user, { displayName });
    } else {
      await authActions.signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    showMessage(authErrorMessage(error));
  } finally {
    setBusy(false);
  }
}

async function initializeAuth() {
  const response = await fetch("/api/firebase-config");
  if (!response.ok)
    throw new Error("Firebase configuration could not be loaded.");
  const config = await response.json();
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  if (required.some((key) => !config[key])) {
    throw new Error(
      "Firebase web configuration is incomplete. Check the FIREBASE_* values in .env.",
    );
  }

  const sdk = "https://www.gstatic.com/firebasejs/" + AUTH_SDK_VERSION;
  const [{ initializeApp }, authSdk] = await Promise.all([
    import(sdk + "/firebase-app.js"),
    import(sdk + "/firebase-auth.js"),
  ]);
  authActions = authSdk;
  auth = authSdk.getAuth(initializeApp(config));

  authSdk.onAuthStateChanged(
    auth,
    function (user) {
      const signedIn = Boolean(user);
      authShell.hidden = signedIn;
      analyzer.hidden = !signedIn;
      footer.hidden = !signedIn;
      accountTools.hidden = !signedIn;
      if (user) {
        accountEmail.textContent =
          user.email || user.displayName || "Signed in";
        passwordInput.value = "";
      }
      if (!user && previousUser)
        window.dispatchEvent(new Event("resume-analyzer:signout"));
      previousUser = user;
    },
    function (error) {
      authShell.hidden = false;
      analyzer.hidden = true;
      footer.hidden = true;
      accountTools.hidden = true;
      showMessage(authErrorMessage(error));
    },
  );

  setBusy(false);
}

async function signInWithGoogle() {
  if (busy || !authActions) return;
  showMessage("");
  setBusy(true);
  googleLabel.textContent = "Connecting to Google...";
  try {
    const provider = new authActions.GoogleAuthProvider();
    await authActions.signInWithPopup(auth, provider);
  } catch (error) {
    showMessage(authErrorMessage(error));
  } finally {
    googleLabel.textContent = "Sign in with Google";
    setBusy(false);
  }
}

loginTab.addEventListener("click", function () {
  if (!busy) setMode("login");
});
registerTab.addEventListener("click", function () {
  if (!busy) setMode("register");
});
form.addEventListener("submit", submitAuth);
googleButton.addEventListener("click", signInWithGoogle);
signOutButton.addEventListener("click", async function () {
  if (!authActions || busy) return;
  signOutButton.disabled = true;
  accountMessage.hidden = true;
  try {
    await authActions.signOut(auth);
  } catch (error) {
    accountMessage.textContent = authErrorMessage(error);
    accountMessage.hidden = false;
  } finally {
    signOutButton.disabled = false;
  }
});

setMode("login");
setBusy(false);
initializeAuth().catch(function (error) {
  showMessage(error.message || "Firebase could not be initialized.");
});
