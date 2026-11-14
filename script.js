// ── SCRIPT FOR CLARIVA - FROM CONFUSION TO CONFIDENCE ──────────
// ── POWERED BY PRO IDEA ──────────

// Optional: uncomment these if you load EmailJS in HTML
// const EMAILJS_SERVICE_ID  = 'service_ugbnb2d';
// const EMAILJS_TEMPLATE_ID = 'template_i3betj5';
// const EMAILJS_PUBLIC_KEY  = '3Do3--5-daxIAi1jF';

const SUPABASE_URL = 'https://euadmjyyjtbbdyjgnoqg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_a3dhZzlwWPmFD9ixA6VuRg_MZC1X2Nj';
let supabaseClient = null; // will be initialized when the Supabase library is available
const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/JhEBwDkfKWgB46dZ3y3ZnK?mode=gi_t';
let gateTriggerElement = null; // stores the element that opened the gate for focus restoration

function showGlobalError(msg) {
  const el = document.querySelector('.gate-error');
  if (el) {
    el.textContent = msg;
    el.classList.add('visible');
  } else {
    console.warn(msg);
  }
}

function showNotification(
  title,
  message,
  type = "success",
  buttonText = "Continue",
  callback = null
) {

  const overlay = document.getElementById("notification-overlay");
  const icon = document.getElementById("notification-icon");
  const titleElement = document.getElementById("notification-title");
  const messageElement = document.getElementById("notification-message");
  const button = document.getElementById("notification-button");
  button.textContent = buttonText;

  titleElement.textContent = title;
  messageElement.textContent = message;

    switch (type) {

    case "success":
      icon.className = "notification-icon notification-icon-success";
      icon.innerHTML = `
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="17" fill="none"
            stroke="currentColor" stroke-width="3"/>
          <path d="M15 24L21 30L33 17"
            fill="none" stroke="currentColor" stroke-width="3.5"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      break;

    case "error":
      icon.className = "notification-icon notification-icon-error";
      icon.innerHTML = `
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="17" fill="none"
            stroke="currentColor" stroke-width="3"/>
          <path d="M18 18L30 30M30 18L18 30"
            fill="none" stroke="currentColor" stroke-width="3.5"
            stroke-linecap="round"/>
        </svg>`;
      break;

    case "warning":
      icon.className = "notification-icon notification-icon-warning";
      icon.innerHTML = `
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 7L44 40H4Z"
            fill="none" stroke="currentColor" stroke-width="3"
            stroke-linejoin="round"/>
          <path d="M24 18V28"
            stroke="currentColor" stroke-width="3.5"
            stroke-linecap="round"/>
          <circle cx="24" cy="34" r="1.8" fill="currentColor"/>
        </svg>`;
      break;

        case "email-sent":
      icon.className = "notification-icon notification-icon-email-sent";
      icon.innerHTML = `
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect x="5" y="10" width="38" height="28" rx="4"
            fill="none" stroke="currentColor" stroke-width="2.5"/>
          <path d="M7 13L24 27L41 13"
            fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="36" cy="34" r="10"
            fill="#E8941A" stroke="#111008" stroke-width="1.5"/>
          <path d="M31.5 34L35 37.5L41 30.5"
            fill="none" stroke="#111008" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      break;
      case "info":
      icon.className = "notification-icon notification-icon-info";
      icon.innerHTML = `
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="17" fill="none"
            stroke="currentColor" stroke-width="3"/>
          <circle cx="24" cy="16" r="2" fill="currentColor"/>
          <path d="M24 22V33"
            stroke="currentColor" stroke-width="3.5"
            stroke-linecap="round"/>
        </svg>`;
      break;
  }

  overlay.classList.remove("hidden");

  button.onclick = () => {

    overlay.classList.add("hidden");

    if (callback) {
      callback();
    }

  };
}

async function getCurrentUser() {
  if (!supabaseClient) return null;
  try {
    const resp = await supabaseClient.auth.getUser();
    return resp?.data?.user || null;
  } catch (e) {
    console.warn('getCurrentUser failed', e);
    return null;
  }
}

window.onload = async function () {
  // Initialize Supabase client if the library is available
  if (typeof supabase !== 'undefined' && supabase && typeof supabase.createClient === 'function') {
    const { createClient } = supabase;
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  } else if (typeof createClient === 'function') {
    // In case createClient is exposed globally in a different way
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    console.warn('Supabase library not detected at load time. Some features will be unavailable until it loads.');
  }
  initializeResetPasswordPage();
  const backToLoginBtn = document.getElementById('back-to-login-button');
  if (backToLoginBtn) {
    backToLoginBtn.addEventListener('click', () => {
      showStep('step-3');
    });
  }
  const emailConfirmationLoginBtn = document.getElementById('email-confirmation-login-button');
if (emailConfirmationLoginBtn) {
  emailConfirmationLoginBtn.addEventListener('click', () => {
    showStep('step-3');
  });
}
  const sendResetBtn = document.getElementById('send-reset-link-button');
  if (sendResetBtn) {
    sendResetBtn.addEventListener('click', handlePasswordReset);
  }


  // Shared access guard for protected dashboard pages
  const currentPage = window.location.pathname.split('/').pop();

  const isUndergraduatesPage = currentPage === 'Undergraduates.html';
  const isAdminDashboard = currentPage === 'AdminDashboard.html';

  if (isUndergraduatesPage || isAdminDashboard) {
    const dashboard = isAdminDashboard
      ? document.getElementById('admin-dashboard')
      : null;

    if (!supabaseClient) {
      console.error('Supabase client is unavailable.');
      window.location.replace('index.html#step-1');
      return;
    }

    try {
      const user = await getCurrentUser();

      if (!user) {
        window.location.replace('index.html#step-1');
        return;
      }

      const { data: profile, error: profileError } =
        await supabaseClient
          .from('students')
          .select('Verified, Role')
          .eq('user_id', user.id)
          .single();

      if (profileError || !profile) {
        console.error('Unable to verify account permissions:', profileError);
        window.location.replace('index.html#step-1');
        return;
      }

      if (profile.Verified !== true) {
        window.location.replace('index.html#step-2');
        return;
      }

      const role = String(profile.Role || '').toLowerCase();

      if (isAdminDashboard) {
        if (!['admin', 'owner'].includes(role)) {
          if (role === 'student') {
            window.location.replace('Undergraduates.html');
          } else {
            window.location.replace('index.html#step-1');
          }
          return;
        }

        if (dashboard) {
          dashboard.hidden = false;
        }
      } else {
        // Verified students and privileged administrators may use the Student Resource Library.
        if (role !== 'student' && !['admin', 'owner'].includes(role)) {
          window.location.replace('index.html#step-1');
          return;
        }
      }
    } catch (error) {
      console.error('Dashboard access check failed:', error);
      window.location.replace('index.html#step-1');
      return;
    }
  }

  // Initialize the shared account menu on both protected dashboards.
  if ((isUndergraduatesPage || isAdminDashboard) &&
      typeof window.initializeClarivaProfileMenu === 'function') {
    window.initializeClarivaProfileMenu();
  }

  // Initialize EmailJS only if it's loaded and you left the public key defined
  if (typeof emailjs !== 'undefined' && emailjs && typeof emailjs.init === 'function') {
    try {
      if (typeof EMAILJS_PUBLIC_KEY !== 'undefined') {
        emailjs.init(EMAILJS_PUBLIC_KEY);
      } else {
        // If you commented the EMAILJS_PUBLIC_KEY constant out, skip init.
        console.warn('EMAILJS_PUBLIC_KEY not present; emailjs.init skipped.');
      }
    } catch (e) {
      console.warn('emailjs.init failed', e);
    }
  }

  // Safe DOM operation
  const waLink = document.querySelectorAll('.whatsapp-link');
  waLink.forEach(a => a.setAttribute('href', WHATSAPP_GROUP_URL));

  // Wire UI interactions (avoid inline onclick attributes)
  const accessForm = document.getElementById('access-form');
  if (accessForm) accessForm.addEventListener('submit', handleFormSubmit);

  const gateClose = document.getElementById('gate-close');
  if (gateClose) gateClose.addEventListener('click', hideGate);

  // Store trigger element for focus restoration when gate closes
  document.querySelectorAll('.js-open-gate').forEach(btn => {
    btn.addEventListener('click', (e) => {
      gateTriggerElement = e.target;
      showGate();
    });
  });

  const openLogin = document.querySelector('.js-open-login');
  if (openLogin) {
    openLogin.addEventListener('click', (e) => {
      gateTriggerElement = e.target;
      showGate();
      showStep('step-3');
    });
  }

  const showLoginLink = document.getElementById('show-login-link');
  if (showLoginLink) showLoginLink.addEventListener('click', (e) => { e.preventDefault(); showStep('step-3'); });

  const loginBtn = document.getElementById('login-button');
  if (loginBtn) loginBtn.addEventListener('click', handleLogin);

  const showRegBtn = document.getElementById('show-register-step-button');
  if (showRegBtn) {
    showRegBtn.addEventListener('click', () => {

      copyEmail("login-email", "field-email");

      showStep("step-1");

    });
  }

  const forgotPasswordLink = document.getElementById('forgot-password-link');
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', showForgotPasswordStep);
  }

  const scrollFeatures = document.getElementById('scroll-features-button');
  if (scrollFeatures) scrollFeatures.addEventListener('click', () => document.getElementById('features').scrollIntoView({ behavior: 'smooth' }));

  // Show the default gate step
  showStep('step-1');

// Authentication checks and page initialization are complete.
const pageLoader = document.getElementById('clariva-page-loader');

if (pageLoader) {
  const minimumDisplayTime = 5000;
  const elapsedTime = performance.now();
  const remainingTime = Math.max(0, minimumDisplayTime - elapsedTime);

  window.setTimeout(() => {
    pageLoader.classList.add('is-hidden');

    window.setTimeout(() => {
      pageLoader.remove();
    }, 500);
  }, remainingTime);
}
};

function showGate() {
  const gate = document.getElementById('gate-overlay');
  if (gate) {
    gate.classList.remove('hidden');
    // Move focus to the first field for keyboard accessibility
    const firstField = document.getElementById('field-name');
    if (firstField) firstField.focus();
  }
}

function hideGate() {
  const gate = document.getElementById('gate-overlay');
  if (gate) gate.classList.add('hidden');
  // Optionally return focus to the button that opened the gate
  if (gateTriggerElement) gateTriggerElement.focus();
}

function showStep(stepId) {
  document.querySelectorAll('.gate-step').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(stepId);
  if (el) el.classList.add('active');
}

function copyEmail(fromId, toId) {

  const from = document.getElementById(fromId);
  const to = document.getElementById(toId);

  if (!from || !to) return;

  to.value = from.value.trim();

}

function showForgotPasswordStep(e) {
  e.preventDefault();

  showStep("step-4")

  copyEmail("login-email", "reset-email");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return /^[\d\s\+\-\(\)]{10,}$/.test(phone);
}

function isValidPassword(password) {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password)
  );
}

function startButtonLoading(button, loadingText) {
  if (!button) return null;

  const originalContent = button.innerHTML;
  const wasDisabled = button.disabled;

  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');

  const mark = document.createElement('img');
  mark.src = 'ClarivaTpLetterMark.png';
  mark.alt = '';
  mark.className = 'gate-btn-loader-mark';
  mark.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'gate-btn-loading-text';
  label.textContent = loadingText;

  button.replaceChildren(mark, label);

  return {
    restore() {
      button.innerHTML = originalContent;
      button.disabled = wasDisabled;
      button.classList.remove('is-loading');
      button.removeAttribute('aria-busy');
    }
  };
}

async function handleFormSubmit(e) {
  e.preventDefault();

  if (!supabaseClient) {
    showGlobalError('Service unavailable right now. Please try again later.');
    return;
  }

  const name = document.getElementById('field-name').value.trim();
  const email = document.getElementById('field-email').value.trim();
  const phone = document.getElementById('field-phone').value.trim();
  const password = document.getElementById('field-password').value.trim();
  const level = document.getElementById('field-level').value;
  const errorEl = document.getElementById('form-error');
  const submitBtn = document.querySelector('#step-1 .gate-btn-primary');

  if (!name || !email || !phone || !password || !level) {
    errorEl.textContent = 'Please complete all fields.';
    errorEl.classList.add('visible');
    return;
  }

  if (!isValidEmail(email)) {
    errorEl.textContent = 'Please enter a valid email address.';
    errorEl.classList.add('visible');
    return;
  }

  if (!isValidPhone(phone)) {
    errorEl.textContent = 'Please enter a valid phone number (10+ digits).';
    errorEl.classList.add('visible');
    return;
  }

  if (!isValidPassword(password)) {
    errorEl.textContent = 'Password doesn't meet the requirements.';
    errorEl.classList.add('visible');
    return;
  }

  const buttonLoading = startButtonLoading(submitBtn, 'Creating Account...');
  if (errorEl) errorEl.classList.remove('visible');

  try {
  // 1) Create auth user (or sign up)
  
  const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: {
  emailRedirectTo: 'https://proideacodestudio.github.io/Clariva/',
  data: {
    full_name: name,
    phone: phone,
    level: level
  }
}
  });

  // If signUp returned an error, handle it (existing logic)
  if (signUpError) {

    const msg = signUpError.message.toLowerCase();

    if (
      msg.includes("already registered") ||
      msg.includes("already exists") ||
      msg.includes("already been registered")
    ) {

      showStep("step-3");

      copyEmail("field-email", "login-email");

      const loginError = document.getElementById("login-error");

      if (loginError) {
        loginError.textContent =
          "Welcome back! An account already exists for this email. Please sign in.";
        loginError.classList.add("visible");
      }

      const loginEmail = document.getElementById("login-email");
      if (loginEmail) {
        loginEmail.focus();
      }

    } else {

      errorEl.textContent = "✗ " + signUpError.message;
      errorEl.classList.add("visible");

    }

  if (buttonLoading) buttonLoading.restore();

    return;
  }


  // The database trigger creates the student profile automatically.
  // Supabase handles email confirmation.

  if (!signUpData?.user) {
    errorEl.textContent = '✗ Account creation could not be completed. Please try again.';
    errorEl.classList.add('visible');
    if (buttonLoading) buttonLoading.restore();
    return;
  }

  if (buttonLoading) buttonLoading.restore();

  showNotification(
    "Confirm Your Email",
    `We've sent a confirmation link to ${email}. Open the link to verify your email address. Once confirmed, return here and sign in.`,
    "email-sent",
    "Go to Login",
    () => {
      copyEmail("field-email", "login-email");
      showStep("step-3");
    }
  );

  return;
  } catch (error) {
  console.error('Registration process failed:', error);

  if (buttonLoading) buttonLoading.restore();

  if (errorEl) {
    errorEl.textContent =
      '✗ An unexpected error occurred. Please try again.';
    errorEl.classList.add('visible');
  }
}
}
async function handleLogin() {
  if (!supabaseClient) {
    alert('Service unavailable right now. Please try again later.');
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const error = document.getElementById('login-error');
  const btn = document.querySelector('#step-3 .gate-btn-primary');

  if (!email) {
    if (error) {
      error.textContent = 'Please enter your email.';
      error.classList.add('visible');
    }
    return;
  }

  if (!isValidEmail(email)) {
    if (error) {
      error.textContent = 'Please enter a valid email address.';
      error.classList.add('visible');
    }
    return;
  }

  if (!password) {
    if (error) {
      error.textContent = 'Please enter your password.';
      error.classList.add('visible');
    }
    return;
  }

  const buttonLoading = startButtonLoading(btn, 'Signing In...');
if (error) error.classList.remove('visible');

  try {

  // Sign in with Supabase Auth
  const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (signInError) {

    let message = "Unable to sign in. Please check your email and password.";

    if (signInError.message.toLowerCase().includes("email not confirmed")) {
      message = "Please verify your email before signing in.";
    }

    if (error) {
      error.textContent = message;
      error.classList.add("visible");
    }

    if (buttonLoading) buttonLoading.restore();

    return;
  }

  // Sign-in succeeded — now check verification status
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: studentData, error: queryError } = await supabaseClient
    .from('students')
    .select('Verified')
    .eq('user_id', user.id)
    .single();

  if (queryError || !studentData) {
    if (error) {
      error.textContent = '✗ Profile not found. Please create an account.';
      error.classList.add('visible');
    }
    if (buttonLoading) buttonLoading.restore();
    return;
  }

  if (studentData.Verified === true) {
    if (buttonLoading) buttonLoading.restore();
window.location.href = 'Undergraduates.html';
  } else {
    if (buttonLoading) buttonLoading.restore();
    showStep('step-2');
  }
  } catch (exception) {
  console.error('Login process failed:', exception);

  if (buttonLoading) buttonLoading.restore();

  if (error) {
    error.textContent =
      'An unexpected error occurred. Please try again.';
    error.classList.add('visible');
  }
}
}

async function handlePasswordReset() {

  const emailInput = document.getElementById("reset-email");
  const errorElement = document.getElementById("reset-error");
  const sendButton = document.getElementById("send-reset-link-button");

  const email = emailInput.value.trim();

  if (!email) {
    errorElement.textContent = "Please enter your email.";
    errorElement.classList.add("visible");
    return;
  }

  if (!isValidEmail(email)) {
    errorElement.textContent = "Please enter a valid email address.";
    errorElement.classList.add("visible");
    return;
  }

  errorElement.classList.remove("visible");
  const buttonLoading = startButtonLoading(sendButton, "Sending Reset Link...");

  try {
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: "https://proideacodestudio.github.io/Clariva/reset-password.html"
  });

  if (error) {
    if (buttonLoading) buttonLoading.restore();
    errorElement.textContent = error.message;
    errorElement.classList.add("visible");
    return;
  }

  if (buttonLoading) buttonLoading.restore();
  
  showNotification(
    "Check Your Email",
    "We've sent a password reset link to your email address. Please check your inbox (and your Spam folder if you don't see it).",
        "email-sent",
    "OK"
  );
  sendButton.disabled = true;

  let seconds = 60;

  sendButton.textContent = `You can request another email in ${seconds}s`;
  const countdown = setInterval(() => {

    seconds--;

    sendButton.textContent = `You can request another email in ${seconds}s`;

    if (seconds <= 0) {

      clearInterval(countdown);

      sendButton.disabled = false;

      sendButton.textContent = "Send Reset Link";

    }

  }, 1000);
} catch (error) {
  if (buttonLoading) buttonLoading.restore();
  errorElement.textContent = error.message || "Unable to send reset email. Please try again.";
  errorElement.classList.add("visible");
  return;
  }
}

async function initializeResetPasswordPage() {

  if (!window.location.pathname.endsWith("reset-password.html")) {
    return;
  }

  console.log("Reset password page loaded.");

  const passwordInput = document.getElementById("new-password");
  const confirmInput = document.getElementById("confirm-password");
  const resetButton = document.getElementById("reset-password-button");
  const errorElement = document.getElementById("reset-error");
  if (!resetButton) return;
    const recoveryMarkerKey = "clariva-password-recovery";

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session?.user?.id) {
      sessionStorage.setItem(
        recoveryMarkerKey,
        JSON.stringify({
          userId: session.user.id,
          createdAt: Date.now()
        })
      );
    } else if (event === "SIGNED_OUT") {
      sessionStorage.removeItem(recoveryMarkerKey);
    }
  });

  resetButton.addEventListener("click", async (e) => {
    e.preventDefault();

    const newPassword = passwordInput.value.trim();
    const confirmPassword = confirmInput.value.trim();

    // Check empty fields
    if (!newPassword || !confirmPassword) {
      errorElement.textContent = "Please fill in all fields.";
      errorElement.classList.add("visible");
      return;
    }

    // Check password strength
    if (!isValidPassword(newPassword)) {
      errorElement.textContent = "Password must be at least 8 characters and include uppercase and lowercase letters, a number, and a special character.";
      errorElement.classList.add("visible");
      return;
    }

    // Check passwords match
    if (newPassword !== confirmPassword) {
      errorElement.textContent = "Passwords do not match.";
      errorElement.classList.add("visible");
      return;
    }

    // Clear previous error
    errorElement.classList.remove("visible");
    const buttonLoading = startButtonLoading(resetButton, "Updating Password...");
    try {
    const {
    data: { session }
  } = await supabaseClient.auth.getSession();

  const recoveryMarker = JSON.parse(
    sessionStorage.getItem(recoveryMarkerKey) || "null"
  );

  const validRecoverySession =
    session &&
    recoveryMarker &&
    recoveryMarker.userId === session.user.id &&
    Date.now() - recoveryMarker.createdAt < 30 * 60 * 1000;

  if (!validRecoverySession) {
    sessionStorage.removeItem(recoveryMarkerKey);

    if (buttonLoading) buttonLoading.restore();

    errorElement.textContent =
      "Your password reset session is missing or has expired. Please request a new reset link.";

    errorElement.classList.add("visible");
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({
    password: newPassword
  });

  if (error) {
    if (buttonLoading) buttonLoading.restore();
    errorElement.textContent = error.message;
    errorElement.classList.add("visible");
    return;
  }

    sessionStorage.removeItem(recoveryMarkerKey);
      
 if (buttonLoading) buttonLoading.restore();
    showNotification(
      "Password Updated",
      "Your password has been updated successfully. You can now sign in with your new password.",
      "success",
      "Go to Login",
      () => {
        window.location.href = "index.html";
      }
    );
      } catch (error) {
  if (buttonLoading) buttonLoading.restore();
  errorElement.textContent =
    error.message || "Unable to update your password. Please try again.";
  errorElement.classList.add("visible");
  return;
}

  });
}
