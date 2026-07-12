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
  if (showRegBtn) showRegBtn.addEventListener('click', () => showStep('step-1'));

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
    errorEl.textContent = '✗ ' + signUpError.message;
    errorEl.classList.add('visible');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account →';
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

    // If not verified yet, attempt a direct fetch to the function URL as a fallback.
    if (!verified) {
      try {
        // Try to obtain a session access token if available
        let token = null;
        try {
          const sess = await supabaseClient.auth.getSession();
          token = sess?.data?.session?.access_token || sess?.data?.session?.accessToken || null;
        } catch (tErr) {
          console.warn('Could not read session token:', tErr);
        }

        const fnUrl = SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/verify-group-code';
        const fetchOpts = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code })
        };
        if (token) fetchOpts.headers.Authorization = 'Bearer ' + token;

        const fResp = await fetch(fnUrl, fetchOpts);
        const j = await fResp.json().catch(() => null);
        if (fResp.ok && j?.verified) {
          verified = true;
        } else {
          serverError = j?.error || j?.message || `Function returned ${fResp.status}`;
        }
      } catch (fetchErr) {
        console.warn('Fallback fetch to function failed:', fetchErr);
        serverError = fetchErr?.message || String(fetchErr);
      }
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
    if (error) {
      error.textContent = '✗ ' + signInError.message;
      error.classList.add('visible');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Login →';
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

function unlockContent() {
  window.location.href = 'Undergraduates.html';
}