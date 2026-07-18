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
      icon.textContent = "✓";
      icon.style.background = "var(--amber)";
      break;

    case "error":
      icon.textContent = "✕";
      icon.style.background = "#c0392b";
      break;

    case "warning":
      icon.textContent = "!";
      icon.style.background = "#f39c12";
      break;

    case "info":
      icon.textContent = "i";
      icon.style.background = "#2980b9";
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
      showStep('step-4');
    });
  }
  const sendResetBtn = document.getElementById('send-reset-link-button');
  if (sendResetBtn) {
    sendResetBtn.addEventListener('click', handlePasswordReset);
  }

  // Access guard for Undergraduates.html
  if (window.location.href.includes('Undergraduates.html')) {
    if (!supabaseClient) {
      console.error('Supabase client not available; redirecting to entry step.');
      window.location.href = 'index.html#step-1';
      return;
    }

    const user = await getCurrentUser();

    if (!user) {
      window.location.href = 'index.html#step-1';
      return;
    }

    const { data: studentData, error: queryError } = await supabaseClient
      .from('students')
      .select('Verified')
      .eq('user_id', user.id)
      .single();

    if (queryError || !studentData) {
      console.warn('There was an error checking access:', queryError);
      window.location.href = 'index.html#step-1';
      return;
    }

    if (!studentData.Verified) {
      window.location.href = 'index.html#step-2';
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
      showStep('step-4');
    });
  }

  const showLoginLink = document.getElementById('show-login-link');
  if (showLoginLink) showLoginLink.addEventListener('click', (e) => { e.preventDefault(); showStep('step-4'); });

  const verifyBtn = document.getElementById('verify-code-button');
  if (verifyBtn) verifyBtn.addEventListener('click', handleCodeSubmit);

  const unlockBtn = document.getElementById('unlock-content-button');
  if (unlockBtn) unlockBtn.addEventListener('click', unlockContent);

  const loginBtn = document.getElementById('login-button');
  if (loginBtn) loginBtn.addEventListener('click', handleLogin);

  const showRegBtn = document.getElementById('show-register-step-button');
  if (showRegBtn) {
    showRegBtn.addEventListener('click', () => {

      copyEmail("login-email", "field-email");

      showStep("step-1");

    });
  }

  function copyEmail(fromId, toId) {

    const from = document.getElementById(fromId);
    const to = document.getElementById(toId);

    if (!from || !to) return;

    to.value = from.value.trim();

  }
  const forgotPasswordLink = document.getElementById('forgot-password-link');
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', showForgotPasswordStep);
  }

  const scrollFeatures = document.getElementById('scroll-features-button');
  if (scrollFeatures) scrollFeatures.addEventListener('click', () => document.getElementById('features').scrollIntoView({ behavior: 'smooth' }));

  // Show the default gate step
  showStep('step-1');
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

function showForgotPasswordStep(e) {
  e.preventDefault();

  showStep("step-5");

  copyEmail("login-email", "reset-email");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return /^[\d\s\+\-\(\)]{10,}$/.test(phone);
}

function isValidPassword(password) {
  return password.length >= 6;
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
    errorEl.textContent = 'Password must be at least 6 characters.';
    errorEl.classList.add('visible');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking...';
  }
  if (errorEl) errorEl.classList.remove('visible');

  // 1) Create auth user (or sign up)
  const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
    email: email,
    password: password
  });

  // If signUp returned an error, handle it (existing logic)
  if (signUpError) {

    const msg = signUpError.message.toLowerCase();

    if (
      msg.includes("already registered") ||
      msg.includes("already exists") ||
      msg.includes("already been registered")
    ) {

      showStep("step-4");

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

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account →";
    }

    return;
  }

  // Determine userId and session: signUpData may not include a session
  let userId = signUpData?.user?.id;
  let sessionPresent = !!signUpData?.session;

  if (!sessionPresent) {
    // Try signing in so the client has an authenticated session (so RLS auth.uid() will be set)
    const { data: signInData, error: signInErr } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (signInErr) {
      // If sign-in fails (e.g., email requires confirmation), you can:
      // - Tell the user to confirm their email first, or
      // - Use a server-side service to create the students row (preferred for confirmation flows).
      // For now, show a friendly message:
      errorEl.textContent = '✗ Please confirm your email (check your inbox) before continuing.';
      errorEl.classList.add('visible');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Account →'; }
      return;
    }

    userId = signInData?.user?.id;
  }

  // 2) Check whether a students row already exists for this user_id
  const { data: existing, error: checkError } = await supabaseClient
    .from('students')
    .select('id, user_id, Verified')
    .eq('user_id', userId)
    .maybeSingle();

  if (checkError) {
    errorEl.textContent = '✗ ' + checkError.message;
    errorEl.classList.add('visible');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account →';
    }
    return;
  }

  if (existing && (existing.id || existing.user_id)) {
    if (existing.Verified === true) {
      showStep('step-4');
    }
    else {
      showStep('step-2');
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account →';
    }
    return;
  }

  // 3) No existing row: upsert the profile using user_id as conflict key to avoid duplicates
  const profile = {
    user_id: userId,
    Name: name,
    "E-mail": email,
    "Phone No.": phone,
    Level: level
  };

  const { data: inserted, error: insertError } = await supabaseClient
    .from('students')
    .upsert(profile, { onConflict: 'user_id' })
    .select('id, user_id')
    .maybeSingle();

  if (insertError) {
    errorEl.textContent = '✗ ' + insertError.message;
    errorEl.classList.add('visible');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account →';
    }
    return;
  }

  if (inserted && (inserted.id || inserted.user_id)) {
    // success — send confirmation (non-blocking) and advance
    (async function sendConfirmation() {
      try {
        if (typeof emailjs !== 'undefined' && emailjs && typeof emailjs.send === 'function'
          && typeof EMAILJS_SERVICE_ID !== 'undefined' && typeof EMAILJS_TEMPLATE_ID !== 'undefined') {
          await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            from_name: 'Clariva',
            from_email: 'clariva@proideacodestudio.com',
            to_email: email,
            to_name: name,
            phone: phone
          });
        }
      } catch (emailError) {
        console.warn('Confirmation email failed (non-blocking):', emailError && emailError.text ? emailError.text : emailError);
      }
    })();

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account →';
    }
    showStep('step-2');
    return;
  }

  // Fallback error
  errorEl.textContent = '✗ Unexpected error: could not create or find profile.';
  errorEl.classList.add('visible');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account →';
  }
}

async function handleCodeSubmit() {
  if (!supabaseClient) {
    showGlobalError('Service unavailable right now. Please try again later.');
    return;
  }

  const code = document.getElementById('field-code').value.trim().toUpperCase();
  const errorEl = document.getElementById('code-error');
  const btn = document.querySelector('#step-2 .gate-btn-primary');

  if (!code) {
    if (errorEl) {
      errorEl.textContent = 'Please enter the group code.';
      errorEl.classList.add('visible');
    }
    return;
  }

  if (errorEl) errorEl.classList.remove('visible');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying...';
  }

  // Call the Edge Function to verify the code on the server, with diagnostics and a fallback
  try {
    let verified = false;
    let serverError = null;

    // Try supabase client invoke first (preferred)
    try {
      const resp = await supabaseClient.functions.invoke('verify-group-code', {
        body: JSON.stringify({ code: code }),
        headers: { 'Content-Type': 'application/json' }
      });
      // supabase-js returns { data, error }
      if (resp?.data?.verified) verified = true;
      else if (resp?.data?.error) serverError = resp.data.error;
      else if (resp?.error) serverError = resp.error.message || String(resp.error);
    } catch (invokeErr) {
      console.warn('functions.invoke failed:', invokeErr);
      serverError = invokeErr?.message || String(invokeErr);
    }

    // Final check
    if (!verified) {
      const errorMsg = serverError || 'Verification failed. Please try again.';
      if (errorEl) {
        errorEl.textContent = '✗ ' + errorMsg;
        errorEl.classList.add('visible');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Verify & Continue →';
      }
      return;
    }
  } catch (outerErr) {
    console.error('Verification flow error:', outerErr);
    if (errorEl) {
      errorEl.textContent = '✗ ' + (outerErr?.message || 'Unexpected error during verification');
      errorEl.classList.add('visible');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify & Continue →';
    }
    return;
  }

  // Success — the Edge Function already updated Verified = true in the database
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Verify & Continue →';
  }
  showStep('step-3');
}

async function handleLogin() {
  if (!supabaseClient) {
    alert('Service unavailable right now. Please try again later.');
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const error = document.getElementById('login-error');
  const btn = document.querySelector('#step-4 .gate-btn-primary');

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

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking...';
  }
  if (error) error.classList.remove('visible');

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

    if (btn) {
      btn.disabled = false;
      btn.textContent = "Login →";
    }

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
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Login →';
    }
    return;
  }

  if (studentData.Verified === true) {
    window.location.href = 'Undergraduates.html';
  } else {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Login →';
    }
    showStep('step-2');
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

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: "https://proideacodestudio.github.io/Clariva/reset-password.html"
  });

  if (error) {
    errorElement.textContent = error.message;
    errorElement.classList.add("visible");
    return;
  }

  showNotification(
    "Check Your Email",
    "We've sent a password reset link to your email address. Please check your inbox (and your Spam folder if you don't see it).",
    "info",
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

    // Check password length
    if (newPassword.length < 6) {
      errorElement.textContent = "Password must be at least 6 characters.";
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
    const {
      data: { session }
    } = await supabaseClient.auth.getSession();

    if (!session) {
      errorElement.textContent =
        "This password reset link has expired. Please request a new one.";
      errorElement.classList.add("visible");
      return;
    }
    const { error } = await supabaseClient.auth.updateUser({
      password: newPassword
    });

    if (error) {
      errorElement.textContent = error.message;
      errorElement.classList.add("visible");
      return;
    }

    showNotification(
      "Password Updated",
      "Your password has been updated successfully. You can now sign in with your new password.",
      "success",
      "Go to Login",
      () => {
        window.location.href = "index.html";
      }
    );
  });
}
function unlockContent() {
  window.location.href = "Undergraduates.html";
}