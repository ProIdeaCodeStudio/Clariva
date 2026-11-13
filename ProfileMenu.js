// Shared Clariva account menu: profile details, saved avatar, and dashboard switching.
(() => {
  'use strict';

  const avatars = {
    'avatar-1': '🎓',
    'avatar-2': '📚',
    'avatar-3': '💡',
    'avatar-4': '⚛️',
    'avatar-5': '🌿'
  };

  const byId = id => document.getElementById(id);
  const page = window.location.pathname.split('/').pop();
  const isAdminPage = page === 'AdminDashboard.html';

  function setStatus(message, state = 'info') {
    const status = byId('clariva-profile-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function setAvatar(choice) {
    const safeChoice = Object.prototype.hasOwnProperty.call(avatars, choice) ? choice : 'avatar-1';
    const avatar = byId('clariva-current-avatar');
    if (avatar) {
      avatar.textContent = avatars[safeChoice];
      avatar.dataset.avatar = safeChoice;
    }
    document.querySelectorAll('[data-avatar-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.avatarChoice === safeChoice));
    });
  }

  function closeMenus() {
    const nav = byId('clariva-nav-menu');
    const profile = byId('clariva-profile-menu');
    const navToggle = byId('clariva-menu-toggle');
    const profileToggle = byId('clariva-profile-toggle');
    if (nav) nav.hidden = true;
    if (profile) profile.hidden = true;
    navToggle?.setAttribute('aria-expanded', 'false');
    profileToggle?.setAttribute('aria-expanded', 'false');
  }

  async function initialize() {
    if (!byId('clariva-profile-toggle') || typeof supabaseClient === 'undefined' || !supabaseClient) return;

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return;

    const { data: profile, error } = await supabaseClient
      .from('students')
      .select('Name, Role, Level, avatar_choice')
      .eq('user_id', user.id)
      .single();

    if (error || !profile) {
      setStatus('Unable to load account details. Refresh to try again.', 'error');
      return;
    }

    const role = String(profile.Role || '').toLowerCase();
    const isPrivileged = ['admin', 'owner'].includes(role);
    const name = profile.Name || 'Clariva member';

    const nameNode = byId('clariva-profile-name');
    const emailNode = byId('clariva-profile-email');
    const roleNode = byId('clariva-profile-role');
    const levelNode = byId('clariva-profile-level');
    if (nameNode) nameNode.textContent = name;
    if (emailNode) emailNode.textContent = user.email || 'Email unavailable';
    if (roleNode) roleNode.textContent = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Member';
    if (levelNode) levelNode.textContent = profile.Level ? 'Level ' + profile.Level : '—';

    const studentLink = byId('clariva-student-dashboard-link');
    const adminLink = byId('clariva-admin-dashboard-link');
    if (studentLink) studentLink.hidden = !isAdminPage || !isPrivileged;
    if (adminLink) adminLink.hidden = isAdminPage || !isPrivileged;

    setAvatar(profile.avatar_choice);

    byId('clariva-menu-toggle')?.addEventListener('click', () => {
      const nav = byId('clariva-nav-menu');
      const open = nav.hidden;
      closeMenus();
      nav.hidden = !open;
      byId('clariva-menu-toggle').setAttribute('aria-expanded', String(open));
    });

    byId('clariva-profile-toggle')?.addEventListener('click', () => {
      const menu = byId('clariva-profile-menu');
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      byId('clariva-profile-toggle').setAttribute('aria-expanded', String(open));
    });

    document.querySelectorAll('[data-avatar-choice]').forEach(button => {
      button.addEventListener('click', async () => {
        const choice = button.dataset.avatarChoice;
        if (!avatars[choice] || button.disabled) return;
        button.disabled = true;
        setStatus('Saving your avatar…');
        const { error: updateError } = await supabaseClient
          .from('students')
          .update({ avatar_choice: choice })
          .eq('user_id', user.id);
        button.disabled = false;
        if (updateError) {
          console.error('Avatar preference update failed:', updateError);
          setStatus('Could not save this avatar. Please try again.', 'error');
          return;
        }
        setAvatar(choice);
        setStatus('Avatar saved to your account.', 'success');
      });
    });

    byId('clariva-sign-out')?.addEventListener('click', async () => {
      const button = byId('clariva-sign-out');
      button.disabled = true;
      button.textContent = 'Signing out…';
      const { error: signOutError } = await supabaseClient.auth.signOut();
      if (signOutError) {
        button.disabled = false;
        button.textContent = 'Sign out';
        setStatus('Sign-out failed. Please try again.', 'error');
        return;
      }
      window.location.replace('index.html#step-1');
    });

    document.querySelectorAll('#clariva-nav-menu a, #clariva-profile-menu a').forEach(link => {
      link.addEventListener('click', closeMenus);
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('.clariva-header-actions')) closeMenus();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenus();
    });
  }

  window.initializeClarivaProfileMenu = initialize;
})();
