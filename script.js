// ── SCRIPT FOR CLARIVA - FROM CONFUSION TO CONFIDENCE ──────────
// ── POWERED BY PRO IDEA ──────────
    const EMAILJS_SERVICE_ID  = 'service_ugbnb2d';
    const EMAILJS_TEMPLATE_ID = 'template_i3betj5';
    const EMAILJS_PUBLIC_KEY  = '3Do3--5-daxIAi1jF';
    const SUPABASE_URL        = 'https://euadmjyyjtbbdyjgnoqg.supabase.co';
    const SUPABASE_KEY        = 'sb_publishable_a3dhZzlwWPmFD9ixA6VuRg_MZC1X2Nj';
    const { createClient }    = supabase
    const supabaseClient      = createClient(SUPABASE_URL, SUPABASE_KEY)
    const WHATSAPP_GROUP_URL  = 'https://chat.whatsapp.com/JhEBwDkfKWgB46dZ3y3ZnK?mode=gi_t';
    const GROUP_CODE          = 'PI2526';

    window.onload = async function () {
      emailjs.init(EMAILJS_PUBLIC_KEY);
      document.querySelector('.whatsapp-link').href = WHATSAPP_GROUP_URL;

      // Force re-verify unverified accounts
      const savedEmail = localStorage.getItem('proidea_email');
      if (savedEmail && localStorage.getItem('proidea_access') === 'granted') {
        try {
          const checkResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/Form%20Submissions?E-mail=eq.${encodeURIComponent(savedEmail)}&select=Verified`, {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`
            }
          });
          const data = await checkResponse.json();
          if (data.length > 0 && data[0].Verified === false) {
            localStorage.removeItem('proidea_access');
          }
        } catch (err) {
          console.error('✗ Verification check failed:', err.message);
        }
      }

      // Access check — show correct step when gate opens
      if (localStorage.getItem('proidea_access') === 'granted') {
        showStep('step-4');
      } else {
        showStep('step-1');
      }

      // Retry pending sync
      const pending = localStorage.getItem('proidea_pending_sync');
      if (pending) {
        const data = JSON.parse(pending);
        fetch(`${SUPABASE_URL}/rest/v1/Form%20Submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            "Name": data.name,
            "E-mail": data.email,
            "Phone No.": data.phone,
            "Verified": false
          })
        }).then(res => {
          if (res.ok) {
            localStorage.removeItem('proidea_pending_sync');
            localStorage.setItem('proidea_db_saved', 'yes');
            console.log('✓ Pending data synced');
          }
        }).catch(err => console.error('✗ Retry failed:', err.message));
      }
    };

    function showGate() {
      document.getElementById('gate-overlay').classList.remove('hidden');
    }

    function hideGate() {
      document.getElementById('gate-overlay').classList.add('hidden');
}

    function showStep(stepId) {
      document.querySelectorAll('.gate-step').forEach(s => s.classList.remove('active'));
      document.getElementById(stepId).classList.add('active');
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

      // Save to Supabase
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
      
     const { error: insertError } = await supabaseClient
       .from('students')
       .insert({
          user_id: data.user.id,
          Name: name,
         "E-mail": email,
         "Phone No.": phone,
          Level: level,
       });

      if (insertError) {
        error.textContent = '✗ ' + insertError.message;
        error.classList.add('visible');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account →';
        return;
       }

      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account →';
      showStep('step-2');
    }

    async function handleCodeSubmit() {
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
