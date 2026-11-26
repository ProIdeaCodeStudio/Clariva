/* Clariva device push-notification controls. Requires an explicit user action. */
(() => {
  'use strict';

  const FUNCTION_NAME = 'clariva-push';
  const PUBLIC_KEY = 'BA1_1_CmYEy0HWPi4IZK02cDwtt9B2I720N3hITbJJrQuhcoUct2Idqbx8hW_5Dalzp_2hQRK1DeVXp8Z7TF8lQ';
  let activeUserId = null;
  let panel = null;
  let statusNode = null;
  let enableButton = null;
  let disableButton = null;
  let initialized = false;
  let inboxChannel = null;
  let bellButton = null;
  let optInPrompt = null;
  let optInPromptStatus = null;
  let promptEnableButton = null;
  let promptDismissedForPage = false;

  const encodeKey = value => {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  };

  function setStatus(message, state = 'info') {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.state = state;
  }

  function createPanel() {
    if (panel || !document.body) return;
    const style = document.createElement('style');
    style.textContent = `
      #clariva-push-panel{position:fixed;z-index:10030;inset:0;width:100%;height:100dvh;overflow:auto;box-sizing:border-box;padding:clamp(20px,5vw,42px);border:0;border-radius:0;background:#fffaf0;color:#211b12;font:14px/1.5 system-ui,sans-serif}
      #clariva-push-panel[hidden]{display:none}
      #clariva-push-panel h2{font:600 16px/1.3 Georgia,serif;margin:0 0 6px}
      #clariva-push-panel p{margin:0 0 12px}
      #clariva-push-status{font-size:12px;color:#625744;min-height:18px;margin:8px 0}
      #clariva-push-status[data-state="error"]{color:#a12b20}
      #clariva-push-status[data-state="success"]{color:#28623c}
      #clariva-inbox{margin-top:14px;padding-top:12px;border-top:1px solid #e5dac5}
      #clariva-inbox h3{font:600 14px Georgia,serif;margin:0 0 8px}
      #clariva-inbox-list{display:grid;gap:10px;max-width:900px;margin:0 auto;overflow:visible}
      .clariva-inbox-item{padding:9px;border-radius:9px;background:#f3ecdf}
      .clariva-inbox-item[data-unread="true"]{border-left:3px solid #e8941a}
      .clariva-inbox-item strong{display:block;font-size:13px}
      .clariva-inbox-item p{margin:4px 0;font-size:12px}
      .clariva-inbox-item small{font-size:10px;color:#625744}
      .clariva-inbox-item a{display:inline-block;margin-top:5px;color:#6d4814;font-weight:600;font-size:12px}
      .clariva-inbox-empty{font-size:12px;color:#625744}
      #clariva-inbox-refresh{margin-top:8px;border:0;border-radius:7px;padding:7px 10px;background:#e9dfca;color:#211b12;font:600 12px system-ui,sans-serif}
      .clariva-push-actions{display:flex;gap:8px;flex-wrap:wrap}
      .clariva-push-actions button{border:0;border-radius:8px;padding:9px 12px;font:600 13px system-ui,sans-serif;cursor:pointer}
      #clariva-push-enable{background:#211b12;color:#fffaf0}
      #clariva-push-disable{background:#e9dfca;color:#211b12}
      #clariva-push-close{position:absolute;right:10px;top:8px;background:transparent;color:#625744;padding:4px 7px}
      #clariva-notification-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:42px;min-height:42px;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:10px}
      #clariva-notification-bell svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      #clariva-notification-count{position:absolute;top:1px;right:0;min-width:17px;height:17px;padding:0 4px;border-radius:10px;background:#e8941a;color:#211b12;font:700 10px/17px system-ui,sans-serif;text-align:center}
      #clariva-push-panel .clariva-notification-page-head{max-width:900px;margin:0 auto 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}
      #clariva-push-panel .clariva-notification-page-head h2{font:700 28px Georgia,serif;margin:0}
      #clariva-push-panel #clariva-push-close{position:static;background:#211b12;color:#fffaf0;border:0;border-radius:8px;padding:9px 14px;cursor:pointer}
      #clariva-inbox{max-width:900px;margin:20px auto 0;padding-top:18px;border-top:1px solid #e5dac5}
      #clariva-push-panel .clariva-push-settings{max-width:900px;margin:0 auto 22px;padding:16px;border:1px solid #e5dac5;border-radius:12px}
      #clariva-push-panel .clariva-push-settings[hidden]{display:none}
      #clariva-push-panel .clariva-push-actions button{margin-right:8px}
      #clariva-push-panel{font-size:16px;line-height:1.6}
      #clariva-push-panel .clariva-notification-page-head h2{font-size:32px}
      #clariva-push-panel #clariva-inbox h3{font-size:20px}
      #clariva-push-panel .clariva-inbox-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      #clariva-push-panel .clariva-inbox-heading h3{margin:0}
      #clariva-push-panel .clariva-inbox-item{padding:15px 16px;border:1px solid #e5dac5;border-radius:11px}
      #clariva-push-panel .clariva-inbox-item strong{font-size:17px;line-height:1.4}
      #clariva-push-panel .clariva-inbox-item p{font-size:15px;line-height:1.6;margin:7px 0}
      #clariva-push-panel .clariva-inbox-item small{font-size:13px;line-height:1.5}
      #clariva-push-panel .clariva-inbox-item a{font-size:14px}
      #clariva-push-panel .clariva-inbox-empty{font-size:15px}
      #clariva-push-panel #clariva-inbox-refresh,
      #clariva-push-panel #clariva-inbox-mark-all-read{min-height:42px;padding:9px 14px;border:1px solid #cbbd9f;border-radius:8px;background:#211b12;color:#fffaf0;font:600 14px/1.3 system-ui,sans-serif;cursor:pointer}
      #clariva-push-panel #clariva-inbox-mark-all-read:disabled{opacity:.5;cursor:not-allowed}
      #clariva-push-panel #clariva-inbox-refresh{background:#e9dfca;color:#211b12}
      #clariva-notification-bell.clariva-header-control{width:44px;min-width:44px;height:44px;min-height:44px;padding:0;border:1px solid #E8941A !important;border-radius:10px;background:#111008 !important;color:#F5EDD8 !important;opacity:1}
      #clariva-notification-bell.clariva-header-control svg{width:23px;height:23px;stroke:#F5EDD8 !important;stroke-width:2.1}
      #clariva-notification-bell.clariva-header-control:focus-visible{outline:3px solid #E8941A;outline-offset:3px}
      #clariva-push-optin{position:fixed;inset:0;z-index:10040;display:grid;place-items:center;padding:20px;box-sizing:border-box;background:rgba(17,16,8,.66)}
      #clariva-push-optin[hidden]{display:none}
      #clariva-push-optin .clariva-push-optin-card{position:relative;width:min(440px,100%);padding:28px 24px 22px;border:1px solid #d9c9a8;border-radius:18px;background:#fffaf0;color:#211b12;box-shadow:0 18px 60px rgba(0,0,0,.24)}
      #clariva-push-optin h2{margin:0 30px 10px 0;font:700 25px/1.2 Georgia,serif;color:#211b12}
      #clariva-push-optin p{margin:0 0 14px;font:15px/1.6 system-ui,sans-serif;color:#514735}
      #clariva-push-optin .clariva-push-optin-status{min-height:18px;margin:0 0 16px;font:13px/1.5 system-ui,sans-serif;color:#8a5a14}
      #clariva-push-optin .clariva-push-optin-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      #clariva-push-optin button{min-height:44px;padding:10px 15px;border:0;border-radius:9px;font:600 14px system-ui,sans-serif;cursor:pointer}
      #clariva-push-optin-enable{background:#211b12;color:#fffaf0}
      #clariva-push-optin-close{background:#e9dfca;color:#211b12}
      #clariva-push-optin-dismiss{position:absolute;top:10px;right:12px;min-width:36px;min-height:36px;padding:4px;background:transparent;color:#625744;font-size:22px}
      #clariva-push-optin button:focus-visible{outline:3px solid #e8941a;outline-offset:3px}
    `;
    document.head.appendChild(style);

    panel = document.createElement('section');
    panel.id = 'clariva-push-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Clariva device notifications');
    panel.innerHTML = `
      <div class="clariva-notification-page-head">
        <h2>Notifications</h2>
        <button id="clariva-push-close" type="button" aria-label="Close notifications">Back</button>
      </div>
      <section class="clariva-push-settings" id="clariva-push-settings">
        <h3>Device notification settings</h3>
        <p>In-app notifications are always available here. Device notifications are optional.</p>
        <div id="clariva-push-status" role="status" aria-live="polite">Checking this device…</div>
        <div class="clariva-push-actions">
          <button id="clariva-push-enable" type="button">Enable notifications</button>
          <button id="clariva-push-disable" type="button" hidden>Turn off device notifications</button>
        </div>
      </section>
      <section id="clariva-inbox" aria-label="All Clariva notifications">
        <div class="clariva-inbox-heading">
          <h3>All notifications</h3>
          <button id="clariva-inbox-mark-all-read" type="button" disabled>Mark all as read</button>
        </div>
        <div id="clariva-inbox-list" aria-live="polite"><p class="clariva-inbox-empty">Loading notifications…</p></div>
        <button id="clariva-inbox-refresh" type="button">Refresh notifications</button>
      </section>`;
    document.body.appendChild(panel);

    optInPrompt = document.createElement('section');
    optInPrompt.id = 'clariva-push-optin';
    optInPrompt.hidden = true;
    optInPrompt.setAttribute('role', 'dialog');
    optInPrompt.setAttribute('aria-modal', 'true');
    optInPrompt.setAttribute('aria-labelledby', 'clariva-push-optin-title');
    optInPrompt.innerHTML = `
      <div class="clariva-push-optin-card">
        <button id="clariva-push-optin-dismiss" type="button" aria-label="Close reminder">×</button>
        <h2 id="clariva-push-optin-title">Stay updated with Clariva</h2>
        <p>Enable device notifications to receive important updates relevant to your account, even when Clariva is not open. You can continue without enabling them.</p>
        <p class="clariva-push-optin-status" id="clariva-push-optin-status" role="status" aria-live="polite"></p>
        <div class="clariva-push-optin-actions">
          <button id="clariva-push-optin-enable" type="button">Enable notifications</button>
          <button id="clariva-push-optin-close" type="button">Not now</button>
        </div>
      </div>`;
    document.body.appendChild(optInPrompt);
    optInPromptStatus = optInPrompt.querySelector('#clariva-push-optin-status');
    promptEnableButton = optInPrompt.querySelector('#clariva-push-optin-enable');

    const dismissOptInPrompt = () => {
      promptDismissedForPage = true;
      optInPrompt.hidden = true;
    };
    optInPrompt.querySelector('#clariva-push-optin-dismiss').addEventListener('click', dismissOptInPrompt);
    optInPrompt.querySelector('#clariva-push-optin-close').addEventListener('click', dismissOptInPrompt);
    promptEnableButton.addEventListener('click', () => enableNotifications(promptEnableButton));

    statusNode = panel.querySelector('#clariva-push-status');
    enableButton = panel.querySelector('#clariva-push-enable');
    disableButton = panel.querySelector('#clariva-push-disable');

    panel.querySelector('#clariva-push-close').addEventListener('click', () => { panel.hidden = true; });
    enableButton.addEventListener('click', enableNotifications);
    disableButton.addEventListener('click', disableNotifications);
    panel.querySelector('#clariva-inbox-refresh').addEventListener('click', loadInbox);
    panel.querySelector('#clariva-inbox-mark-all-read').addEventListener('click', markAllAsRead);
  }

  async function invoke(action, extra = {}) {
    if (!supabaseClient) throw new Error('Clariva account services are unavailable. Refresh and try again.');
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
      body: { action, ...extra }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function showOptInPrompt() {
    if (optInPrompt && !promptDismissedForPage) optInPrompt.hidden = false;
  }

  function hideOptInPrompt() {
    if (optInPrompt) optInPrompt.hidden = true;
  }

  async function refreshState() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) {
      setStatus('Device notifications are not supported in this browser or connection.', 'error');
      enableButton.disabled = true;
      hideOptInPrompt();
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const enabled = Notification.permission === 'granted' && Boolean(subscription);
      if (enabled) {
        await invoke('subscribe', {
          subscription: subscription.toJSON(),
          userAgent: navigator.userAgent.slice(0, 500)
        });
        setStatus('Notifications are enabled and connected for this account on this device.', 'success');
        enableButton.hidden = true;
        enableButton.disabled = false;
        disableButton.hidden = false;
        hideOptInPrompt();
        return;
      }

      enableButton.hidden = false;
      enableButton.disabled = false;
      disableButton.hidden = true;
      if (Notification.permission === 'denied') {
        const message = 'Notifications are blocked. Allow them for Clariva in your browser or device site settings, then return and try again.';
        setStatus(message, 'error');
        if (optInPromptStatus) optInPromptStatus.textContent = message;
      } else {
        setStatus('Notifications are not enabled on this device.', 'info');
        if (optInPromptStatus) optInPromptStatus.textContent = '';
      }
      showOptInPrompt();
    } catch (error) {
      console.error('Clariva device notification status could not be refreshed:', error);
      setStatus('This device could not be connected to Clariva notifications. Please try again.', 'error');
      if (optInPromptStatus) optInPromptStatus.textContent = 'Clariva could not finish connecting this device. Please try again.';
      enableButton.hidden = false;
      enableButton.disabled = false;
      disableButton.hidden = true;
      showOptInPrompt();
    }
  }

  async function enableNotifications(triggerButton = enableButton) {
    if (!PUBLIC_KEY) {
      setStatus('Device notifications are not fully configured yet. Please try again later.', 'error');
      if (optInPromptStatus) optInPromptStatus.textContent = 'Device notifications are not fully configured yet. Please try again later.';
      return;
    }
    if (!window.isSecureContext) {
      setStatus('Notifications require a secure HTTPS connection.', 'error');
      if (optInPromptStatus) optInPromptStatus.textContent = 'Notifications require a secure HTTPS connection.';
      return;
    }
    if (triggerButton) triggerButton.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        const message = permission === 'denied'
          ? 'Notifications are blocked. Allow them for Clariva in your browser or device site settings, then return and try again.'
          : 'Permission was not granted. You can enable notifications whenever you are ready.';
        setStatus(message, 'error');
        if (optInPromptStatus) optInPromptStatus.textContent = message;
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: encodeKey(PUBLIC_KEY)
        });
      }
      await invoke('subscribe', {
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent.slice(0, 500)
      });
      setStatus('Notifications are enabled for this device.', 'success');
      hideOptInPrompt();
      await refreshState();
    } catch (error) {
      console.error('Clariva push subscription failed:', error);
      const message = error.message || 'Unable to enable notifications. Please try again.';
      setStatus(message, 'error');
      if (optInPromptStatus) optInPromptStatus.textContent = message;
      showOptInPrompt();
    } finally {
      if (triggerButton) triggerButton.disabled = false;
    }
  }

  async function disableNotifications() {
    disableButton.disabled = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        try {
          await invoke('unsubscribe', { endpoint: subscription.endpoint });
        } finally {
          await subscription.unsubscribe();
        }
      }
      setStatus('Notifications have been turned off on this device.', 'success');
      await refreshState();
    } catch (error) {
      setStatus(error.message || 'Unable to turn off notifications.', 'error');
    } finally {
      disableButton.disabled = false;
    }
  }

  function createBell() {
    if (bellButton || !document.querySelector('.clariva-header-actions')) return;
    const actions = document.querySelector('.clariva-header-actions');
    const menuButton = document.getElementById('clariva-menu-toggle');
    bellButton = document.createElement('button');
    bellButton.type = 'button';
    bellButton.id = 'clariva-notification-bell';
    bellButton.className = 'clariva-header-control';
    bellButton.setAttribute('aria-label', 'Open notifications');
    bellButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span id="clariva-notification-count" hidden>0</span>';
    bellButton.addEventListener('click', () => {
      if (panel) {
        panel.hidden = false;
        void loadInbox();
        void refreshState();
      }
    });
    if (menuButton?.nextSibling) actions.insertBefore(bellButton, menuButton.nextSibling);
    else actions.prepend(bellButton);
  }

  function updateUnreadCount(items) {
    const badge = document.getElementById('clariva-notification-count');
    if (!badge) return;
    const count = (items || []).filter(item => !item.read_at).length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    if (bellButton) bellButton.setAttribute('aria-label', count ? 'Open notifications, ' + count + ' unread' : 'Open notifications');
  }

  async function markAllAsRead() {
    const button = panel?.querySelector('#clariva-inbox-mark-all-read');
    if (!button || !activeUserId || !supabaseClient || button.disabled) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Marking…';
    try {
      const { error } = await supabaseClient.from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', activeUserId)
        .is('read_at', null);
      if (error) throw error;
      updateUnreadCount([]);
      await loadInbox();
    } catch (error) {
      console.error('Clariva notifications could not all be marked as read:', error);
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function loadInbox() {
    const list = panel?.querySelector('#clariva-inbox-list');
    if (!list || !supabaseClient || !activeUserId) return;
    list.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'clariva-inbox-empty';
    loading.textContent = 'Loading updates…';
    list.appendChild(loading);
    try {
      const data = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error } = await supabaseClient.from('notifications')
          .select('id,event_type,title,message,destination,created_at,read_at,push_sent_at')
          .eq('user_id', activeUserId)
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        data.push(...(page || []));
        if (!page || page.length < pageSize) break;
      }
      updateUnreadCount(data);
      const markAllButton = panel.querySelector('#clariva-inbox-mark-all-read');
      if (markAllButton) {
        markAllButton.disabled = !data.some(item => !item.read_at);
        markAllButton.textContent = 'Mark all as read';
      }
      list.replaceChildren();
      if (!data?.length) {
        const empty = document.createElement('p');
        empty.className = 'clariva-inbox-empty';
        empty.textContent = 'You are all caught up. No recent updates.';
        list.appendChild(empty);
        return;
      }
      data.forEach(item => {
        const card = document.createElement('article');
        card.className = 'clariva-inbox-item';
        card.dataset.unread = String(!item.read_at);
        const title = document.createElement('strong');
        title.textContent = item.title || 'Clariva update';
        const message = document.createElement('p');
        message.textContent = item.message || '';
        const date = document.createElement('small');
        date.textContent = new Date(item.created_at).toLocaleString();
        card.append(title, message, date);
        if (item.destination) {
          const link = document.createElement('a');
          link.href = item.destination;
          link.textContent = 'Open update';
          card.appendChild(link);
        }
        if (!item.read_at) {
          const markRead = document.createElement('button');
          markRead.type = 'button';
          markRead.textContent = 'Mark as read';
          markRead.style.cssText = 'display:block;margin-top:6px;border:0;background:transparent;color:#6d4814;font:600 11px system-ui,sans-serif;padding:2px 0;cursor:pointer';
          markRead.addEventListener('click', async () => {
            markRead.disabled = true;
            try {
              const { error: updateError } = await supabaseClient.from('notifications')
                .update({ read_at: new Date().toISOString() })
                .eq('id', item.id)
                .eq('user_id', activeUserId);
              if (updateError) throw updateError;
              await loadInbox();
            } catch (error) {
              console.error('Clariva notification read state could not be updated:', error);
              markRead.disabled = false;
            }
          });
          card.appendChild(markRead);
        }
        list.appendChild(card);
      });
      // Automatic event push delivery is handled server-side by the database dispatch queue.
    } catch (error) {
      console.error('Clariva inbox could not be loaded:', error);
      list.replaceChildren();
      const message = document.createElement('p');
      message.className = 'clariva-inbox-empty';
      message.textContent = 'Updates could not be loaded. Check your connection and refresh.';
      list.appendChild(message);
    }
  }

  function watchInbox(userId) {
    if (!supabaseClient || typeof supabaseClient.channel !== 'function') return;
    if (inboxChannel) {
      try { void supabaseClient.removeChannel(inboxChannel); } catch (_) {}
      inboxChannel = null;
    }
    inboxChannel = supabaseClient
      .channel('clariva-notifications-' + userId)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: 'user_id=eq.' + userId
      }, () => { void loadInbox(); })
      .subscribe();
  }

  async function showForUser(userId) {
    if (!userId || window.clarivaOfflineMode === true) return;
    if (activeUserId === userId && panel) return;
    if (window.clarivaPageReady && typeof window.clarivaPageReady.then === 'function') {
      try { await window.clarivaPageReady; } catch (_) { return; }
    }
    activeUserId = userId;
    createPanel();
    panel.hidden = true;
    createBell();
    watchInbox(userId);
    await Promise.all([refreshState(), loadInbox()]);

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get('openNotifications') === '1') {
      panel.hidden = false;
      currentUrl.searchParams.delete('openNotifications');
      window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);
      await loadInbox();
    }
  }

  async function hideForSignedOutUser() {
    activeUserId = null;
    if (inboxChannel && supabaseClient) {
      try { await supabaseClient.removeChannel(inboxChannel); } catch (_) {}
      inboxChannel = null;
    }
    if (panel) panel.hidden = true;
    if (bellButton) { bellButton.remove(); bellButton = null; }
  }

  window.clarivaPrepareForSignOut = async function () {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        try { await invoke('unsubscribe', { endpoint: subscription.endpoint }); }
        finally { await subscription.unsubscribe(); }
      }
    } catch (error) {
      console.warn('Clariva could not remove the device subscription before sign-out:', error);
    }
  };

  async function initialize() {
    if (initialized || !supabaseClient || window.clarivaOfflineMode === true) return;
    initialized = true;
    if (window.clarivaPageReady && typeof window.clarivaPageReady.then === 'function') {
      try { await window.clarivaPageReady; } catch (_) { return; }
    }
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user?.id) await showForUser(session.user.id);
    supabaseClient.auth.onAuthStateChange((event, sessionNow) => {
      if (sessionNow?.user?.id) {
        window.setTimeout(() => showForUser(sessionNow.user.id), 0);
      } else if (event === 'SIGNED_OUT') {
        hideForSignedOutUser();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
