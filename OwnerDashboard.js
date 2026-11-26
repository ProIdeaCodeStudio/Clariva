/* ============================================================
   CLARIVA — OWNER DASHBOARD
   Owner-only account directory and role management.
   The server-side RPCs enforce owner privileges independently
   of this interface. Never use direct client-side Role updates.
   ============================================================ */
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  let accounts = [];
  let currentUserId = null;
  let busy = false;

  function setStatus(message, state = 'info') {
    const node = byId('owner-account-status');
    if (!node) return;
    node.textContent = message;
    node.dataset.state = state;
  }

  function setRoleStatus(message, state = 'info') {
    const node = byId('owner-role-status');
    if (!node) return;
    node.textContent = message;
    node.dataset.state = state;
  }

  function setMetric(id, value) {
    const node = byId(id);
    if (node) node.textContent = Number(value || 0).toLocaleString();
  }

  function updateMetrics() {
    setMetric('owner-total-accounts', accounts.length);
    setMetric('owner-student-accounts', accounts.filter(a => String(a.role || '').toLowerCase() === 'student').length);
    setMetric('owner-admin-accounts', accounts.filter(a => String(a.role || '').toLowerCase() === 'admin').length);
    setMetric('owner-owner-accounts', accounts.filter(a => String(a.role || '').toLowerCase() === 'owner').length);
    setMetric('owner-verified-accounts', accounts.filter(a => a.verified === true).length);
  }

  function makeCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text == null || text === '' ? '—' : String(text);
    return cell;
  }

  function renderAccounts() {
    const body = byId('owner-account-list');
    if (!body) return;
    const query = (byId('owner-account-search')?.value || '').trim().toLowerCase();
    const filtered = accounts.filter(account =>
      [account.full_name, account.email, account.role, account.level]
        .some(value => String(value || '').toLowerCase().includes(query))
    );
    body.replaceChildren();

    if (!filtered.length) {
      const row = document.createElement('tr');
      const cell = makeCell(query ? 'No matching accounts.' : 'No accounts were returned.');
      cell.colSpan = 8;
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }

    filtered.forEach(account => {
      const row = document.createElement('tr');
      row.appendChild(makeCell(account.full_name));
      row.appendChild(makeCell(account.email));
      row.appendChild(makeCell(String(account.role || 'student').toUpperCase()));
      row.appendChild(makeCell(account.level));
      row.appendChild(makeCell(account.verified ? 'Verified' : 'Pending'));
      const created = account.created_at ? new Date(account.created_at) : null;
      row.appendChild(makeCell(created && !Number.isNaN(created.getTime())
        ? created.toLocaleDateString() : '—'));
      const lastLogin = account.last_login_at ? new Date(account.last_login_at) : null;
      row.appendChild(makeCell(lastLogin && !Number.isNaN(lastLogin.getTime())
        ? lastLogin.toLocaleString() : 'Never'));

      const actionCell = document.createElement('td');
      const isOwner = String(account.role || '').toLowerCase() === 'owner';
      const isSelf = account.user_id === currentUserId;
      if (isOwner || isSelf) {
        actionCell.textContent = isSelf ? 'Your account — protected' : 'Owner account — protected';
      } else {
        const roleSelect = document.createElement('select');
        roleSelect.className = 'owner-role-select';
        roleSelect.setAttribute('aria-label', 'Role for ' + (account.full_name || account.email || 'account'));
        [['student', 'Student'], ['admin', 'Administrator']].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = String(account.role || 'student').toLowerCase() === value;
          roleSelect.appendChild(option);
        });
        const saveRole = document.createElement('button');
        saveRole.type = 'button';
        saveRole.className = 'admin-button admin-button-secondary owner-role-save';
        saveRole.textContent = 'Save role';
        saveRole.addEventListener('click', () => changeRole(account, roleSelect.value, saveRole));

        const statusButton = document.createElement('button');
        statusButton.type = 'button';
        statusButton.className = 'admin-button admin-button-secondary owner-role-save';
        statusButton.textContent = account.verified ? 'Revoke verification' : 'Verify account';
        statusButton.addEventListener('click', () => changeAccountStatus(account, !account.verified, statusButton));

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'admin-button admin-button-danger owner-role-save';
        removeButton.textContent = 'Remove user';
        removeButton.addEventListener('click', () => removeAccount(account, removeButton));
        actionCell.append(roleSelect, saveRole, statusButton, removeButton);
      }
      row.appendChild(actionCell);
      body.appendChild(row);
    });
    setStatus(filtered.length + ' of ' + accounts.length + ' account(s) shown.');
  }

  async function loadAccounts() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
      setStatus('Account service is unavailable. Refresh and try again.', 'error');
      return;
    }
    const refresh = byId('owner-refresh-accounts');
    if (refresh) refresh.disabled = true;
    setStatus('Loading account directory…');
    try {
      const { data: authData, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !authData?.user) throw authError || new Error('Your session has expired.');
      currentUserId = authData.user.id;

      const { data, error } = await supabaseClient.rpc('owner_list_accounts_with_last_login');
      if (error) throw error;
      accounts = Array.isArray(data) ? data : [];
      updateMetrics();
      renderAccounts();
      setRoleStatus('Account directory is up to date.');
    } catch (error) {
      console.error('Clariva owner account directory error:', error);
      accounts = [];
      updateMetrics();
      renderAccounts();
      setStatus(window.clarivaFriendlyError?.(error, 'Unable to load accounts. Refresh and try again.') || 'Unable to load accounts. Refresh and try again.', 'error');
      setRoleStatus('Owner permissions could not be confirmed.', 'error');
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function changeRole(account, requestedRole, button) {
    if (busy) return;
    const oldRole = String(account.role || 'student').toLowerCase();
    const nextRole = String(requestedRole || '').toLowerCase();
    if (!['student', 'admin'].includes(nextRole) || nextRole === oldRole) return;
    const label = account.full_name || account.email || 'this account';
    const action = nextRole === 'admin' ? 'promote to Administrator' : 'change to Student';
    if (!window.confirm('Are you sure you want to ' + action + ' for ' + label + '?')) return;

    busy = true;
    if (button) button.disabled = true;
    setRoleStatus('Saving account role…');
    try {
      const { error } = await supabaseClient.rpc('owner_set_account_role', {
        target_user_id: account.user_id,
        requested_role: nextRole
      });
      if (error) throw error;
      setRoleStatus('Role updated successfully.', 'success');
      await loadAccounts();
    } catch (error) {
      console.error('Clariva owner role update error:', error);
      setRoleStatus(window.clarivaFriendlyError?.(error, 'The role could not be updated. Try again.') || 'The role could not be updated. Try again.', 'error');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }


  async function changeAccountStatus(account, verified, button) {
    if (busy) return;
    const label = account.full_name || account.email || 'this account';
    const action = verified ? 'verify' : 'revoke verification for';
    if (!window.confirm('Are you sure you want to ' + action + ' ' + label + '?')) return;
    busy = true;
    if (button) button.disabled = true;
    setRoleStatus('Updating account status…');
    try {
      const { error } = await supabaseClient.rpc('owner_set_account_status', {
        target_user_id: account.user_id,
        requested_verified: verified
      });
      if (error) throw error;
      setRoleStatus('Account verification status updated.', 'success');
      await loadAccounts();
    } catch (error) {
      console.error('Clariva owner account status error:', error);
      setRoleStatus(window.clarivaFriendlyError?.(error, 'The account status could not be updated. Try again.') || 'The account status could not be updated. Try again.', 'error');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function removeAccount(account, button) {
    if (busy) return;
    const label = account.full_name || account.email || 'this account';
    const email = String(account.email || '').trim();
    if (!email) {
      setRoleStatus('This account has no email address available for removal confirmation.', 'error');
      return;
    }
    if (!window.confirm('Permanently remove ' + label + ' (' + email + ')? This deletes the account and cannot be undone.')) return;
    const confirmation = window.prompt('To confirm, enter the account email address exactly:');
    if (confirmation === null || confirmation.trim().toLowerCase() !== email.toLowerCase()) {
      setRoleStatus('Removal cancelled: the email confirmation did not match.', 'error');
      return;
    }
    busy = true;
    if (button) button.disabled = true;
    setRoleStatus('Removing account…');
    try {
      const { error } = await supabaseClient.rpc('owner_remove_account', {
        target_user_id: account.user_id
      });
      if (error) throw error;
      accounts = accounts.filter(item => item.user_id !== account.user_id);
      updateMetrics();
      renderAccounts();
      setRoleStatus('Account permanently removed.', 'success');
    } catch (error) {
      console.error('Clariva owner account removal error:', error);
      setRoleStatus(window.clarivaFriendlyError?.(error, 'The account could not be removed. Try again.') || 'The account could not be removed. Try again.', 'error');
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }


  async function loadActivity() {
    const refresh = byId('owner-refresh-activity');
    const status = byId('owner-activity-status');
    const chart = byId('owner-daily-views-chart');
    if (refresh) refresh.disabled = true;
    if (status) status.textContent = 'Loading aggregate activity…';
    try {
      const { data, error } = await supabaseClient.rpc('owner_activity_overview');
      if (error) throw error;
      const summary = Array.isArray(data) ? data[0] : data;
      if (!summary) throw new Error('No activity summary was returned.');
      setMetric('owner-views-7d', summary.views_last_7_days);
      setMetric('owner-views-30d', summary.views_last_30_days);
      setMetric('owner-unique-viewers-7d', summary.unique_viewers_last_7_days);
      setMetric('owner-offline-saves', summary.total_offline_saves);
      const days = Array.isArray(summary.daily_views) ? summary.daily_views : [];
      if (chart) {
        chart.replaceChildren();
        if (!days.length) {
          const empty = document.createElement('p');
          empty.className = 'admin-muted';
          empty.textContent = 'No activity data is available yet.';
          chart.appendChild(empty);
        } else {
          const maximum = Math.max(1, ...days.map(day => Number(day.views || 0)));
          days.forEach(day => {
            const row = document.createElement('div');
            row.className = 'owner-daily-view-row';
            const label = document.createElement('span');
            label.className = 'owner-daily-view-label';
            label.textContent = String(day.label || day.date || '—');
            const track = document.createElement('div');
            track.className = 'owner-daily-view-track';
            const bar = document.createElement('div');
            bar.className = 'owner-daily-view-bar';
            bar.style.width = (Math.max(0, Number(day.views || 0)) / maximum * 100) + '%';
            track.appendChild(bar);
            const value = document.createElement('span');
            value.className = 'owner-daily-view-value';
            value.textContent = Number(day.views || 0).toLocaleString();
            row.append(label, track, value);
            chart.appendChild(row);
          });
        }
      }
      if (status) status.textContent = 'Activity summary refreshed successfully.';
    } catch (error) {
      console.error('Clariva owner activity overview error:', error);
      if (status) {
        status.textContent = window.clarivaFriendlyError?.(error, 'Unable to load platform activity. Try again.') || 'Unable to load platform activity. Try again.';
        status.dataset.state = 'error';
      }
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  function initializeOwnerSectionNavigation() {
    const main = byId('owner-dashboard');
    const nav = byId('clariva-nav-menu');
    if (!main || !nav) return;

    const sections = Array.from(main.querySelectorAll(':scope > .admin-panel[id]'));
    const showSection = (id, updateHistory = false, scroll = true) => {
      const target = sections.find(section => section.id === id) || byId('owner-overview');
      if (!target) return;
      sections.forEach(section => { section.hidden = section !== target; });
      if (updateHistory && window.location.hash !== '#' + target.id) {
        history.pushState({ ...(history.state || {}), clarivaOwnerSection: target.id }, '', window.location.pathname + window.location.search + '#' + target.id);
      }
      if (scroll) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    nav.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        const id = link.getAttribute('href').slice(1);
        showSection(id, true);
        nav.hidden = true;
        byId('clariva-menu-toggle')?.setAttribute('aria-expanded', 'false');
      });
    });

    const initialSection = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    const validInitialSection = sections.some(section => section.id === initialSection)
      ? initialSection
      : 'owner-overview';
    showSection(validInitialSection, false, Boolean(window.location.hash));
    window.addEventListener('popstate', () => {
      const sectionId = decodeURIComponent(window.location.hash.replace(/^#/, ''));
      showSection(sectionId || 'owner-overview', false, true);
    });
  }

  function initialize() {
    if (!byId('owner-dashboard')) return;
    initializeOwnerSectionNavigation();
    byId('owner-refresh-accounts')?.addEventListener('click', loadAccounts);
    byId('owner-refresh-activity')?.addEventListener('click', loadActivity);
    byId('owner-account-search')?.addEventListener('input', renderAccounts);
    // Load owner-only data only after the shared route guard confirms access.
    const loadOwnerDashboardData = () => { void loadAccounts(); void loadActivity(); };
    const ready = window.clarivaPageReady;
    if (ready && typeof ready.then === 'function') {
      ready.then(loadOwnerDashboardData).catch(error => {
        console.error('Owner dashboard initialization was blocked:', error);
      });
    } else {
      loadOwnerDashboardData();
    }
  }

  initialize();
})();
