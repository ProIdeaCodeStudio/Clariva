// ── SCRIPT FOR CLARIVA - FROM CONFUSION TO CONFIDENCE ──────────
// ── POWERED BY PRO IDEA ──────────

// Optional: uncomment these if you load EmailJS in HTML
// const EMAILJS_SERVICE_ID  = 'service_ugbnb2d';
// const EMAILJS_TEMPLATE_ID = 'template_i3betj5';
// const EMAILJS_PUBLIC_KEY  = '3Do3--5-daxIAi1jF';

const SUPABASE_URL = 'https://euadmjyyjtbbdyjgnoqg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_a3dhZzlwWPmFD9ixA6VuRg_MZC1X2Nj';
let supabaseClient = null; // initialized before recovery-link handling begins

function initializeSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  if (typeof supabase !== 'undefined' && supabase && typeof supabase.createClient === 'function') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } else if (typeof createClient === 'function') {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    console.warn('Supabase library not detected at script initialization. Some features will be unavailable.');
  }

  return supabaseClient;
}
function clarivaFriendlyError(error, fallback = 'This action could not be completed. Try again.') {
  const message = String(error?.message || error || '');
  const networkFailure = navigator.onLine === false ||
    error?.name === 'TypeError' ||
    /failed to fetch|network request failed|network error|connection (was )?lost|timed? ?out|load failed/i.test(message);
  if (networkFailure) return 'Check your network connection and try again.';
  if (Number(error?.status || error?.statusCode) === 429) return 'Service is busy. Try again shortly.';
  return fallback;
}
window.clarivaFriendlyError = clarivaFriendlyError;

function isMissingAccountAuthError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return ['user_not_found', 'user-not-found', 'email_not_found'].includes(code) ||
    /user not found|no user found|email address not found/.test(message);
}

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

function isClarivaConnectivityError(error) {
  const message = String(error?.message || error || '');
  const rawStatus = error?.status ?? error?.statusCode;
  const hasStatus = rawStatus !== undefined && rawStatus !== null;
  const status = hasStatus ? Number(rawStatus) : NaN;
  return navigator.onLine === false ||
    error?.name === 'TypeError' ||
    error?.name === 'AbortError' ||
    (hasStatus && status === 0) ||
    (hasStatus && status >= 500) ||
    /failed to fetch|fetch failed|network|timed? ?out|connection (was )?lost|load failed|request aborted/i.test(message);
}
window.clarivaIsConnectivityError = isClarivaConnectivityError;

async function getCurrentUser() {
  if (!supabaseClient) {
    throw new Error('Authentication service is not available yet.');
  }

  const resp = await supabaseClient.auth.getUser();
  if (resp?.error) {
    const code = String(resp.error.code || '').toLowerCase();
    const name = String(resp.error.name || '').toLowerCase();
    if (code === 'auth_session_missing' || name === 'authsessionmissingerror') {
      return null;
    }
    if (isClarivaConnectivityError(resp.error)) {
      const sessionResponse = await supabaseClient.auth.getSession();
      const session = sessionResponse?.data?.session;
      if (!session?.user) return null;
      if (session.expires_at && Number(session.expires_at) <= Math.floor(Date.now() / 1000) && navigator.onLine !== false) return null;
      return session.user;
    }
    throw resp.error;
  }

  return resp?.data?.user || null;
}

function getClarivaStoredAuthUser() {
  try {
    const stored = JSON.parse(localStorage.getItem('sb-euadmjyyjtbbdyjgnoqg-auth-token') || 'null');
    return stored?.user?.id ? stored.user : null;
  } catch (_) { return null; }
}

async function initializeClarivaPage() {
  // Retry safely if the CDN was unavailable during initial script execution.
  initializeSupabaseClient();
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
  const isOwnerDashboard = currentPage === 'OwnerDashboard.html';

  if (isUndergraduatesPage || isAdminDashboard || isOwnerDashboard) {
    window.clarivaOfflineMode = false;
    window.clarivaCachedProfile = null;
    window.clarivaOfflineUser = null;
    let offlineStoredUser = null;
    if (navigator.onLine === false) {
      offlineStoredUser = getClarivaStoredAuthUser();
      if (offlineStoredUser?.id) {
        try {
          const cached = JSON.parse(localStorage.getItem('clariva-offline-profile-v1:' + offlineStoredUser.id) || 'null');
          if (cached && cached.Verified === true && ['student', 'admin', 'owner'].includes(String(cached.Role || '').toLowerCase()) && cached.password_reset_required !== true) {
            if (!cached.cachedAt) { cached.cachedAt = Date.now(); localStorage.setItem('clariva-offline-profile-v1:' + offlineStoredUser.id, JSON.stringify(cached)); }
            if (Number(cached.cachedAt) > Date.now() - 7 * 24 * 60 * 60 * 1000) {
              window.clarivaOfflineMode = true;
              window.clarivaCachedProfile = cached;
              window.clarivaOfflineUser = offlineStoredUser;
            }
          }
        } catch (offlineError) { console.warn('Clariva could not restore the saved offline profile:', offlineError); }
      }
    }
    const dashboard = isAdminDashboard
      ? document.getElementById('admin-dashboard')
      : isOwnerDashboard ? document.getElementById('owner-dashboard') : null;

    if (!supabaseClient && !offlineStoredUser) {
      console.error('Supabase client is unavailable; protected access cannot be verified.');
      window.ClarivaConnectivity?.notify(
        'Clariva cannot verify your account right now. Check your connection and refresh when the service is available.',
        'error',
        'Retry',
        () => window.location.reload(),
        0
      );
      return;
    }

    try {
      const user = offlineStoredUser || await getCurrentUser();

      if (!user) {
        window.location.replace('index.html#step-1');
        return;
      }

      let fetchedProfile = null;
      let profileError = null;
      if (!window.clarivaOfflineMode) {
        const profileResult = await supabaseClient
          .from('students')
          .select('Verified, Role, Level, password_reset_required')
          .eq('user_id', user.id)
          .single();
        fetchedProfile = profileResult.data;
        profileError = profileResult.error;
      }
      let profile = window.clarivaOfflineMode ? window.clarivaCachedProfile : fetchedProfile;
      if (profileError) {
        if (isClarivaConnectivityError(profileError)) {
          try {
            const cached = JSON.parse(localStorage.getItem('clariva-offline-profile-v1:' + user.id) || 'null');
            if (cached && cached.Verified === true &&
                ['student', 'admin', 'owner'].includes(String(cached.Role || '').toLowerCase()) &&
                cached.password_reset_required !== true &&
                (!cached.cachedAt || Number(cached.cachedAt) > Date.now() - 7 * 24 * 60 * 60 * 1000)) {
              profile = cached;
              window.clarivaOfflineMode = true;
            }
          } catch (cacheError) {
            console.warn('Clariva could not read the saved offline profile:', cacheError);
          }
        }
        if (!profile) {
          if (isClarivaConnectivityError(profileError)) throw profileError;
          console.error('Unable to verify account permissions:', profileError);
          window.location.replace('index.html#step-1');
          return;
        }
      }

      if (!profile) {
        window.location.replace('index.html#step-1');
        return;
      }

      window.clarivaCachedProfile = profile;
      if (window.clarivaOfflineMode) window.clarivaOfflineUser = user;
      if (window.clarivaOfflineMode && !isUndergraduatesPage) {
        window.location.replace('Undergraduates.html?saved=1');
        return;
      }
      if (!window.clarivaOfflineMode && profile.Verified === true) {
        try {
          localStorage.setItem('clariva-offline-profile-v1:' + user.id, JSON.stringify({ ...profile, cachedAt: Date.now() }));
        } catch (cacheError) {
          console.warn('Clariva could not cache the account profile for offline reading:', cacheError);
        }
      }

      if (profile.password_reset_required === true) {
        window.location.replace('reset-password.html');
        return;
      }

      if (profile.Verified !== true) {
        window.location.replace('index.html#step-2');
        return;
      }

      const role = String(profile.Role || '').toLowerCase();

      if (isOwnerDashboard) {
        if (role !== 'owner') {
          window.location.replace(role === 'admin' ? 'AdminDashboard.html' : role === 'student' ? 'Undergraduates.html' : 'index.html#step-1');
          return;
        }
        if (dashboard) dashboard.hidden = false;
      } else if (isAdminDashboard) {
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
      if (isClarivaConnectivityError(error)) {
        window.ClarivaConnectivity?.notify(
          'Your sign-in could not be verified because Clariva cannot reach its services. You have not been signed out. Reconnect to continue; protected actions remain unavailable until verification succeeds.',
          'offline',
          'Retry',
          () => window.location.reload(),
          0
        );
        return;
      }
      window.location.replace('index.html#step-1');
      return;
    }
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
}

// Run the shared guard as soon as this deferred script executes. It is
// deliberately not tied to DOMContentLoaded: unrelated third-party deferred
// scripts must not be able to hold the entire site behind the page loader.
function hideClarivaPageLoader() {
  const loader = document.getElementById('clariva-page-loader');
  if (!loader) return;
  loader.classList.add('is-hidden');
  window.setTimeout(() => loader.remove(), 500);
}

const protectedClarivaPage = ['Undergraduates.html', 'AdminDashboard.html', 'OwnerDashboard.html']
  .includes(window.location.pathname.split('/').pop());

window.clarivaPageReady = initializeClarivaPage();

let clarivaInitializationSettled = false;
const clarivaInitializationTimeout = window.setTimeout(() => {
  if (clarivaInitializationSettled) return;
  console.warn('Clariva initialization is taking longer than expected.');
  window.ClarivaConnectivity?.notify(
    'Clariva is taking longer than expected to connect. A slow connection or delayed service response may be responsible. Please wait or retry.',
    'warning',
    'Retry',
    () => window.location.reload(),
    0
  );
  hideClarivaPageLoader();
}, 15000);

window.clarivaPageReady
  .then(() => {
    clarivaInitializationSettled = true;
    window.clearTimeout(clarivaInitializationTimeout);
    hideClarivaPageLoader();
  })
  .catch(error => {
    clarivaInitializationSettled = true;
    window.clearTimeout(clarivaInitializationTimeout);
    console.error('Clariva page initialization failed:', error);
    if (isClarivaConnectivityError(error)) {
      window.ClarivaConnectivity?.notify(
        'Clariva could not finish connecting. Check your internet connection and retry. You have not been signed out.',
        'offline',
        'Retry',
        () => window.location.reload(),
        0
      );
      hideClarivaPageLoader();
      return;
    }
    if (protectedClarivaPage) {
      window.location.replace('index.html#step-1');
    } else {
      hideClarivaPageLoader();
    }
  });

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
    errorEl.textContent = "Password doesn't meet the requirements.";
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

      errorEl.textContent = clarivaFriendlyError(signUpError, 'Account creation failed. Check your details and try again.');
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
      clarivaFriendlyError(error, 'Account creation failed. Please try again.');
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
    if (isMissingAccountAuthError(signInError)) {
      if (buttonLoading) buttonLoading.restore();
      showStep('step-1');
      const registrationMessage = document.getElementById('form-error');
      if (registrationMessage) {
        registrationMessage.textContent = 'No account found. Create an account to continue.';
        registrationMessage.classList.add('visible');
      }
      return;
    }

    const message = /email not confirmed/i.test(signInError.message || '')
      ? 'Verify your email before signing in.'
      : clarivaFriendlyError(signInError, 'Email or password is incorrect. If you do not have an account, create one.');

    if (error) {
      error.textContent = message;
      error.classList.add('visible');
    }
    if (buttonLoading) buttonLoading.restore();
    return;
  }

  // Sign-in succeeded — now check verification status
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: studentData, error: queryError } = await supabaseClient
    .from('students')
    .select('Verified, Role, password_reset_required')
    .eq('user_id', user.id)
    .single();

  if (queryError && queryError.code !== 'PGRST116') {
    if (error) {
      error.textContent = clarivaFriendlyError(queryError, 'We could not verify your account. Try again.');
      error.classList.add('visible');
    }
    if (buttonLoading) buttonLoading.restore();
    return;
  }

  if (!studentData) {
    await supabaseClient.auth.signOut();
    if (buttonLoading) buttonLoading.restore();
    showStep('step-1');
    const registrationMessage = document.getElementById('form-error');
    if (registrationMessage) {
      registrationMessage.textContent = 'No active account was found. Create an account to continue.';
      registrationMessage.classList.add('visible');
    }
    return;
  }

  if (studentData.password_reset_required === true) {
    if (buttonLoading) buttonLoading.restore();
    window.location.href = 'reset-password.html';
    return;
  }

  if (studentData.Verified === true) {
    if (buttonLoading) buttonLoading.restore();
    const role = String(studentData.Role || '').toLowerCase();
    if (role === 'owner') {
      window.location.replace('OwnerDashboard.html');
    } else if (role === 'admin') {
      window.location.replace('AdminDashboard.html');
    } else {
      window.location.replace('Undergraduates.html');
    }
  } else {
    if (buttonLoading) buttonLoading.restore();
    showStep('step-2');
  }
  } catch (exception) {
  console.error('Login process failed:', exception);

  if (buttonLoading) buttonLoading.restore();

  if (error) {
    error.textContent =
      clarivaFriendlyError(exception, 'Unable to sign in. Please try again.');
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
  errorElement.textContent = clarivaFriendlyError(error, "Unable to send the reset link. Try again.");
  errorElement.classList.add("visible");
  return;
  }
}

async function initializeResetPasswordPage() {
  if (!window.location.pathname.endsWith("reset-password.html")) return;

  const passwordInput = document.getElementById("new-password");
  const confirmInput = document.getElementById("confirm-password");
  const resetButton = document.getElementById("reset-password-button");
  const errorElement = document.getElementById("reset-error");
  const resetForm = document.getElementById("reset-password-form");
  const mandatoryPanel = document.getElementById("mandatory-reset-link-panel");
  const sendMandatoryLinkButton = document.getElementById("mandatory-reset-link-button");
  const mandatoryStatus = document.getElementById("mandatory-reset-link-status");
  if (!resetButton || !resetForm || !mandatoryPanel || !sendMandatoryLinkButton) return;

  if (!supabaseClient) {
    showMandatoryResetPanel("The account service is unavailable. Please refresh this page and try again.");
    sendMandatoryLinkButton.hidden = true;
    return;
  }

  const recoveryMarkerKey = "clariva-password-recovery";
  const pendingCompletionKey = "clariva-forced-reset-password-updated";
  const redirectTo = "https://proideacodestudio.github.io/Clariva/reset-password.html";
  let activeRecoveryUserId = null;
  let passwordUpdatedInThisTab = false;
  let recoveryEventReceived = false;

  function readRecoveryMarker() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(recoveryMarkerKey) || "null");
      if (stored) return stored;
    } catch (_) {
      // Some mobile/private browsing contexts restrict sessionStorage.
    }
    return activeRecoveryUserId
      ? { userId: activeRecoveryUserId, createdAt: Date.now() }
      : null;
  }

  function saveRecoveryMarker(userId) {
    activeRecoveryUserId = userId;
    passwordUpdatedInThisTab = false;
    try {
      sessionStorage.setItem(
        recoveryMarkerKey,
        JSON.stringify({ userId, createdAt: Date.now() })
      );
      sessionStorage.removeItem(pendingCompletionKey);
    } catch (storageError) {
      console.warn("Clariva could not persist recovery state; keeping it in memory for this page.", storageError);
    }
  }

  function clearRecoveryState() {
    activeRecoveryUserId = null;
    passwordUpdatedInThisTab = false;
    try {
      sessionStorage.removeItem(recoveryMarkerKey);
      sessionStorage.removeItem(pendingCompletionKey);
    } catch (_) {
      // In-memory state is still cleared when browser storage is unavailable.
    }
  }

  function hasPendingPasswordUpdate(userId) {
    if (passwordUpdatedInThisTab) return true;
    try {
      return sessionStorage.getItem(pendingCompletionKey) === userId;
    } catch (_) {
      return false;
    }
  }

  function markPasswordUpdated(userId) {
    passwordUpdatedInThisTab = true;
    try {
      sessionStorage.setItem(pendingCompletionKey, userId);
    } catch (_) {
      // The current page can still retry the completion RPC using in-memory state.
    }
  }

  function showRecoveryForm() {
    mandatoryPanel.hidden = true;
    resetForm.hidden = false;
    if (errorElement) errorElement.classList.remove("visible");
  }

  function showMandatoryResetPanel(message = "") {
    resetForm.hidden = true;
    mandatoryPanel.hidden = false;
    if (mandatoryStatus) mandatoryStatus.textContent = message;
  }

  async function hasVerifiedRecoveryClaim(expectedUserId) {
    const { data: claimsData, error: claimsError } =
      await supabaseClient.auth.getClaims();

    if (claimsError) throw claimsError;

    const claims = claimsData?.claims;
    if (!claims || claims.sub !== expectedUserId) {
      return false;
    }

    const hasOtpMethod = Array.isArray(claims.amr) && claims.amr.some(
      (method) => method && method.method === "otp"
    );

    if (hasOtpMethod) {
      // Validate the recovery link before the password has been changed.
      const { data: isValidRecovery, error: validationError } =
        await supabaseClient.rpc("is_valid_required_password_recovery_session");

      if (validationError) throw validationError;
      if (isValidRecovery === true) return true;
    }

    // Auth clears recovery_sent_at after a successful password update. A
    // server-stored attempt tied to this exact session keeps safe retries valid.
    const { data: resetInProgress, error: inProgressError } =
      await supabaseClient.rpc("is_required_password_reset_in_progress");

    if (inProgressError) throw inProgressError;
    return resetInProgress === true;
  }

  sendMandatoryLinkButton.addEventListener("click", async () => {
    if (!supabaseClient) return;

    const buttonLoading = startButtonLoading(
      sendMandatoryLinkButton,
      "Sending Reset Link..."
    );
    if (mandatoryStatus) mandatoryStatus.textContent = "";

    try {
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      if (userError || !user?.email) {
        throw userError || new Error("We couldn't verify the email address for this account.");
      }

      const { data: profile, error: profileError } = await supabaseClient
        .from("students")
        .select("password_reset_required")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (profile?.password_reset_required !== true) {
        throw new Error("This account does not have a pending mandatory password reset.");
      }

      const { error: sendError } = await supabaseClient.auth.resetPasswordForEmail(
        user.email,
        { redirectTo }
      );

      if (sendError) throw sendError;

      if (buttonLoading) buttonLoading.restore();
      sendMandatoryLinkButton.disabled = true;
      sendMandatoryLinkButton.textContent = "Reset Link Sent";
      if (mandatoryStatus) {
        mandatoryStatus.textContent =
          "A password reset link has been sent to " + user.email +
          ". Open that email and follow the link to continue. Check Spam if it doesn't arrive.";
      }

      let seconds = 60;
      const countdown = setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(countdown);
          sendMandatoryLinkButton.disabled = false;
          sendMandatoryLinkButton.textContent = "Resend Password Reset Link";
        } else {
          sendMandatoryLinkButton.textContent = "Resend link in " + seconds + "s";
        }
      }, 1000);
    } catch (sendError) {
      if (buttonLoading) buttonLoading.restore();
      if (mandatoryStatus) {
        mandatoryStatus.textContent =
          clarivaFriendlyError(sendError, "Unable to send the reset link. Try again.");
      }
    }
  });

  resetButton.addEventListener("click", async (e) => {
    e.preventDefault();

    const newPassword = passwordInput.value.trim();
    const confirmPassword = confirmInput.value.trim();

    if (!newPassword || !confirmPassword) {
      errorElement.textContent = "Please fill in all fields.";
      errorElement.classList.add("visible");
      return;
    }

    if (!isValidPassword(newPassword)) {
      errorElement.textContent = "Password must be at least 8 characters and include uppercase and lowercase letters, a number, and a special character.";
      errorElement.classList.add("visible");
      return;
    }

    if (newPassword !== confirmPassword) {
      errorElement.textContent = "Passwords do not match.";
      errorElement.classList.add("visible");
      return;
    }

    errorElement.classList.remove("visible");
    const buttonLoading = startButtonLoading(resetButton, "Updating Password...");

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const recoveryMarker = readRecoveryMarker();

      const validRecoverySession =
        session &&
        recoveryMarker &&
        recoveryMarker.userId === session.user.id &&
        await hasVerifiedRecoveryClaim(session.user.id);

      if (!validRecoverySession) {
        clearRecoveryState();
        if (buttonLoading) buttonLoading.restore();
        errorElement.textContent =
          "We couldn't verify this recovery session. Please request a fresh password reset link before continuing.";
        errorElement.classList.add("visible");
        mandatoryPanel.hidden = false;
        if (mandatoryStatus) {
          mandatoryStatus.textContent = "Use the button below to request a new secure reset link.";
        }
        return;
      }

      const { data: resetProfile, error: resetProfileError } = await supabaseClient
        .from("students")
        .select("password_reset_required")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (resetProfileError) throw resetProfileError;
      const mandatoryPasswordReset =
        resetProfile?.password_reset_required === true;

      const passwordAlreadyUpdated =
        mandatoryPasswordReset &&
        hasPendingPasswordUpdate(session.user.id);

      if (!passwordAlreadyUpdated) {
        if (mandatoryPasswordReset) {
          const { error: beginError } = await supabaseClient.rpc(
            "begin_required_password_reset"
          );
          if (beginError) throw beginError;
        }

        const { error: updateError } = await supabaseClient.auth.updateUser({
          password: newPassword
        });
        if (updateError) throw updateError;

        if (mandatoryPasswordReset) {
          markPasswordUpdated(session.user.id);
        }
      }

      if (mandatoryPasswordReset) {
        const { error: completionError } = await supabaseClient.rpc(
          "complete_required_password_reset"
        );
        if (completionError) {
          if (buttonLoading) buttonLoading.restore();
          errorElement.textContent =
            "Your password has been updated, but Clariva couldn't complete the account update yet. Submit again to retry the final step. " +
            completionError.message;
          errorElement.classList.add("visible");
          return;
        }
      }

      clearRecoveryState();

      if (buttonLoading) buttonLoading.restore();
      showNotification(
        "Password Updated",
        mandatoryPasswordReset
          ? "Your password has been updated. Please sign in again using your new password."
          : "Your password has been updated successfully. You can now sign in with your new password.",
        "success",
        "Go to Login",
        () => {
          window.location.href = "index.html";
        }
      );
    } catch (resetError) {
      if (buttonLoading) buttonLoading.restore();
      errorElement.textContent =
        clarivaFriendlyError(resetError, "Unable to update your password. Try again.");
      errorElement.classList.add("visible");
    }
  });

  // Supabase emits this event only after it accepts a password-recovery link.
  // Reveal the form immediately; the server-side validator still gates completion.
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session?.user?.id) {
      recoveryEventReceived = true;
      saveRecoveryMarker(session.user.id);
      showRecoveryForm();
    } else if (event === "SIGNED_OUT") {
      clearRecoveryState();
    }
  });

  // The auth event is the normal signal. Also verify the signed JWT's amr
  // claim after initialization, covering cases where the event fired before
  // the page listener was attached or the page was refreshed.
  try {
    const { data: { session }, error: sessionError } =
      await supabaseClient.auth.getSession();

    if (sessionError) throw sessionError;

    if (session?.user?.id) {
      // Do not let the initial-session fallback hide a form already revealed
      // by the PASSWORD_RECOVERY event while getSession() was resolving.
      if (recoveryEventReceived) {
        showRecoveryForm();
        return;
      }

      // Recovery validation controls access to the password form, not access
      // to the mandatory email-link action. A transient claim/RPC validation
      // failure must not hide the only way for a signed-in user to request
      // the required recovery link.
      let recoveryClaimValid = false;
      try {
        recoveryClaimValid =
          await hasVerifiedRecoveryClaim(session.user.id);
      } catch (recoveryValidationError) {
        console.warn(
          "Recovery session is not yet validated; keeping the mandatory reset-link option available.",
          recoveryValidationError
        );
      }

      if (recoveryClaimValid) {
        saveRecoveryMarker(session.user.id);
        showRecoveryForm();
        return;
      }

      const { data: profile, error: profileError } = await supabaseClient
        .from("students")
        .select("password_reset_required")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      if (profile?.password_reset_required === true) {
        showMandatoryResetPanel(
          "Send a secure reset link to your registered email address to continue."
        );
      } else {
        showMandatoryResetPanel(
          "To change your password, request a reset link from the Login page."
        );
        sendMandatoryLinkButton.hidden = true;
      }
    } else {
      showMandatoryResetPanel(
        "Open the password reset link sent to your email. If you need a new link, return to Login and choose Forgot Password."
      );
      sendMandatoryLinkButton.hidden = true;
    }
  } catch (initializationError) {
    console.error("Unable to initialize password reset:", initializationError);
    showMandatoryResetPanel(
      clarivaFriendlyError(initializationError, "We could not verify this account. Refresh or request a new reset link.")
    );
    sendMandatoryLinkButton.hidden = true;
  }




}


/* ============================================================
   PASSWORD VISIBILITY CONTROLS
   Apply consistently to every password input on every page.
   ============================================================ */
function initializePasswordVisibilityToggles() {
  const eyeIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
        fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="3"
        fill="none" stroke="currentColor" stroke-width="1.8"/>
    </svg>`;
  const eyeOffIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 3l18 18M10.6 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.5 10.5 0 0 0 4-.8"
        fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round"/>
    </svg>`;

  document.querySelectorAll('input[type="password"]').forEach((input, index) => {
    if (input.closest(".password-input-wrapper")) return;

    if (!input.id) input.id = `clariva-password-field-${index + 1}`;

    const wrapper = document.createElement("div");
    wrapper.className = "password-input-wrapper";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "password-visibility-toggle";
    toggle.setAttribute("aria-controls", input.id);
    toggle.setAttribute("aria-label", "Show password");
    toggle.setAttribute("title", "Show password");
    toggle.setAttribute("aria-pressed", "false");
    toggle.innerHTML = eyeIcon;

    toggle.addEventListener("click", () => {
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
      toggle.setAttribute("title", reveal ? "Hide password" : "Show password");
      toggle.setAttribute("aria-pressed", String(reveal));
      toggle.innerHTML = reveal ? eyeOffIcon : eyeIcon;
      input.focus({ preventScroll: true });
    });

    wrapper.appendChild(toggle);
  });
}

// Initialize Supabase while the deferred script is executing, before the page's
// load event. This gives recovery-link detection time to establish the session.
initializePasswordVisibilityToggles();
initializeSupabaseClient();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeResetPasswordPage, { once: true });
} else {
  initializeResetPasswordPage();
}

// Register the app shell cache used by the student Offline Saves feature.
if ('serviceWorker' in navigator) {
  const registerClarivaServiceWorker = () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' })
      .catch(error => console.warn('Clariva offline app-shell caching is unavailable:', error));
  };
  if (document.readyState === 'complete') {
    registerClarivaServiceWorker();
  } else {
    window.addEventListener('load', registerClarivaServiceWorker, { once: true });
  }
}
