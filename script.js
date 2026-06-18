// ── SCRIPT FOR CLARIVA - FROM CONFUSION TO CONFIDENCE ──────────
// ── POWERED BY PRO IDEA ──────────

//const EMAILJS_SERVICE_ID  = 'service_ugbnb2d';
//const EMAILJS_TEMPLATE_ID = 'template_i3betj5';
//const EMAILJS_PUBLIC_KEY  = '3Do3--5-daxIAi1jF';
const SUPABASE_URL        = 'https://euadmjyyjtbbdyjgnoqg.supabase.co';
const SUPABASE_KEY        = 'sb_publishable_a3dhZzlwWPmFD9ixA6VuRg_MZC1X2Nj';
let supabaseClient        = null; // will be initialized when the Supabase library is available
const WHATSAPP_GROUP_URL  = 'https://chat.whatsapp.com/JhEBwDkfKWgB46dZ3y3ZnK?mode=gi_t';
const GROUP_CODE          = 'PI2526';

window.onload = async function () {
  // Initialize Supabase client if the library is available
  if (typeof supabase !== 'undefined' && supabase && typeof supabase.createClient === 'function') {
    const { createClient } = supabase;
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  } else if (typeof createClient === 'function') {
    // In case the createClient function was exposed differently
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    // If Supabase isn't available yet, we'll guard operations that need it later.
    console.warn('Supabase library not detected on window at load time. Some features will be unavailable until it loads.');
  }

  // Access guard for Undergraduates.html
  if (window.location.href.includes('Undergraduates.html')) {
    if (!supabaseClient) {
      console.error('Supabase client not available; redirecting to entry step.');
      window.location.href = 'index.html#step-1';
      return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    
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
      alert('There was an error checking your access. Please try again.');
      window.location.href = 'index.html#step-1';
      return;
    }

    if (!studentData.Verified) {
      window.location.href = 'index.html#step-2';
      return;
    }
  }
  
  // Initialize for all pages
  // if (typeof emailjs !== 'undefined' && emailjs && typeof emailjs.init === 'function') {
  //  emailjs.init(EMAILJS_PUBLIC_KEY);
  // } else {
    //console.warn('EmailJS not detected on window at load time. Email features may not work.');
  // }

  const waLink = document.querySelector('.whatsapp-link');
  if (waLink) waLink.href = WHATSAPP_GROUP_URL;
  showStep('step-1');
};

function showGate() {
  const gate = document.getElementById('gate-overlay');
  if (gate) gate.classList.remove('hidden');
}

function hideGate() {
  const gate = document.getElementById('gate-overlay');
  if (gate) gate.classList.add('hidden');
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
    alert('Service unavailable right now. Please try again later.');
    return;
  }

  const name  = document.getElementById('field-name').value.trim();
  const email = document.getElementById('field-email').value.trim();
  const phone = document.getElementById('field-phone').value.trim();
  const password = document.getElementById('field-password').value.trim();
  const level = document.getElementById('field-level').value;
  const error = document.getElementById('form-error');
  const submitBtn = document.querySelector('#step-1 .gate-btn-primary');

  if (!name || !email || !phone || !password || !level) {
    error.textContent = 'Please complete all fields.';
    error.classList.add('visible');
    return;
  }
  
  if (!isValidEmail(email)) {
    error.textContent = 'Please enter a valid email address.';
    error.classList.add('visible');
    return;
  }

  if (!isValidPhone(phone)) {
    error.textContent = 'Please enter a valid phone number (10+ digits).';
    error.classList.add('visible');
    return;
  }

  if (!isValidPassword(password)) {
    error.textContent = 'Password must be at least 6 characters.';
    error.classList.add('visible');
    return;
  }
  
  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking...';
  error.classList.remove('visible');

  // Sign up with Supabase Auth
  const { data, error: signUpError } = await supabaseClient.auth.signUp({
    email: email,
    password: password
  });

  if (signUpError) {
    error.textContent = '✗ ' + signUpError.message;
    error.classList.add('visible');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account →';
    return;
  }
  
  // Insert profile into students table
  const { error: insertError } = await supabaseClient
    .from('students')
    .insert({
      user_id: data.user.id,
      Name: name,
      "E-mail": email,
      "Phone No.": phone,
      Level: level
    });

  if (insertError) {
    error.textContent = '✗ ' + insertError.message;
    error.classList.add('visible');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account →';
    return;
  }

  // Send confirmation email via EmailJS
  // try {
    // if (typeof emailjs !== 'undefined' && emailjs && typeof emailjs.send === 'function') {
     //  await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
       //  from_name: 'Clariva',
       //  from_email: 'clariva@proideacodestudio.com',
       //  to_email: email,
       // to_name: name,
     //   phone: phone
      // });
   // } else {
    //  console.warn('EmailJS not available, skipping confirmation email.');
   // }
//  } catch (emailError) {
  //  console.error('✗ Email sending failed:', emailError.message);
    // Don't block signup if email fails, just log it
 // }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Create Account →';
  showStep('step-2');
}

async function handleCodeSubmit() {
  if (!supabaseClient) {
    alert('Service unavailable right now. Please try again later.');
    return;
  }

  const code  = document.getElementById('field-code').value.trim().toUpperCase();
  const error = document.getElementById('code-error');
  const btn   = document.querySelector('#step-2 .gate-btn-primary');
  
  if (!code) {
    error.textContent = 'Please enter the group code.';
    error.classList.add('visible');
    return;
  }

  if (code !== GROUP_CODE) {
    error.textContent = '✗ Incorrect code. Check the pinned message in the WhatsApp group.';
    error.classList.add('visible');
    return;
  }
  
  error.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error: updateError } = await supabaseClient
    .from('students')
    .update({ Verified: true })
    .eq('user_id', user.id);

  if (updateError) {
    error.textContent = '✗ ' + updateError.message;
    error.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Verify & Continue →';
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Verify & Continue →';
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
  const btn   = document.querySelector('#step-4 .gate-btn-primary');

  if (!email) {
    error.textContent = 'Please enter your email.';
    error.classList.add('visible');
    return;
  }
    
  if (!isValidEmail(email)) {
    error.textContent = 'Please enter a valid email address.';
    error.classList.add('visible');
    return;
  }

  if (!password) {
    error.textContent = 'Please enter your password.';
    error.classList.add('visible');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Checking...';
  error.classList.remove('visible');

  // Sign in with Supabase Auth
  const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (signInError) {
    error.textContent = '✗ ' + signInError.message;
    error.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Login →';
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
    error.textContent = '✗ Profile not found. Please create an account.';
    error.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Login →';
    return;
  }

  // Check verification status
  if (studentData.Verified === true) {
    window.location.href = 'Undergraduates.html';
  } else {
    btn.disabled = false;
    btn.textContent = 'Login →';
    showStep('step-2');
  }
}

function unlockContent() {
  window.location.href = 'Undergraduates.html';
                 }
