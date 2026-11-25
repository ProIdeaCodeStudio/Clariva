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
  let testButton = null;
  let initialized = false;
  let inboxChannel = null;

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
      #clariva-push-panel{position:fixed;z-index:9998;right:18px;bottom:18px;width:min(340px,calc(100vw - 36px));padding:16px;border:1px solid #d8c9a8;border-radius:14px;background:#fffaf0;color:#211b12;box-shadow:0 8px 30px rgba(17,16,8,.18);font:14px/1.45 system-ui,sans-serif}
      #clariva-push-panel[hidden]{display:none}
      #clariva-push-panel h2{font:600 16px/1.3 Georgia,serif;margin:0 0 6px}
      #clariva-push-panel p{margin:0 0 12px}
      #clariva-push-status{font-size:12px;color:#625744;min-height:18px;margin:8px 0}
      #clariva-push-status[data-state="error"]{color:#a12b20}
      #clariva-push-status[data-state="success"]{color:#28623c}
      #clariva-inbox{margin-top:14px;padding-top:12px;border-top:1px solid #e5dac5}
      #clariva-inbox h3{font:600 14px Georgia,serif;margin:0 0 8px}
      #clariva-inbox-list{display:grid;gap:8px;max-height:230px;overflow:auto}
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
      #clariva-push-enable,#clariva-push-test{background:#211b12;color:#fffaf0}
      #clariva-push-disable{background:#e9dfca;color:#211b12}
      #clariva-push-close{position:absolute;right:10px;top:8px;background:transparent;color:#625744;padding:4px 7px}
      @media(max-width:480px){#clariva-push-panel{right:12px;bottom:12px;width:calc(100vw - 24px)}}
    `;
    document.head.appendChild(style);

    panel = document.createElement('section');
    panel.id = 'clariva-push-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Clariva device notifications');
    panel.innerHTML = `
      <button id="clariva-push-close" type="button" aria-label="Close notification settings">×</button>
      <h2>Stay updated with Clariva</h2>
      <p>Receive important Clariva updates on this device, even when the website is closed.</p>
      <div id="clariva-push-status" role="status" aria-live="polite">Notifications are not enabled on this device.</div>
      <div class="clariva-push-actions">
        <button id="clariva-push-enable" type="button">Enable notifications</button>
        <button id="clariva-push-test" type="button" hidden>Send test</button>
        <button id="clariva-push-disable" type="button" hidden>Turn off</button>
      </div>
      <section id="clariva-inbox" aria-label="Recent Clariva updates">
        <h3>Recent updates</h3>
        <div id="clariva-inbox-list" aria-live="polite"><p class="clariva-inbox-empty">Loading updates…</p></div>
        <button id="clariva-inbox-refresh" type="button">Refresh updates</button>
      </section>`;
    document.body.appendChild(panel);
    statusNode = panel.querySelector('#clariva-push-status');
    enableButton = panel.querySelector('#clariva-push-enable');
    disableButton = panel.querySelector('#clariva-push-disable');
    testButton = panel.querySelector('#clariva-push-test');

    panel.querySelector('#clariva-push-close').addEventListener('click', () => { panel.hidden = true; });
    enableButton.addEventListener('click', enableNotifications);
    disableButton.addEventListener('click', disableNotifications);
    testButton.addEventListener('click', sendTest);
    panel.querySelector('#clariva-inbox-refresh').addEventListener('click', loadInbox);
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

  async function refreshState() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('This browser does not support device notifications.', 'error');
      enableButton.disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('Notifications are blocked in browser settings. Change the site permission to enable them.', 'error');
      enableButton.hidden = false;
      enableButton.disabled = true;
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const enabled = Boolean(subscription);
      setStatus(enabled ? 'Notifications are enabled on this device.' : 'Notifications are not enabled on this device.', enabled ? 'success' : 'info');
      enableButton.hidden = enabled;
      enableButton.disabled = false;
      testButton.hidden = !enabled;
      disableButton.hidden = !enabled;
    } catch (error) {
      setStatus('Unable to check this device notification status.', 'error');
    }
  }

  async function enableNotifications() {
    if (!PUBLIC_KEY) {
      setStatus('Device notifications are not fully configured yet. Please try again later.', 'error');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('Notifications require a secure HTTPS connection.', 'error');
      return;
    }
    enableButton.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('Permission was not granted. You can enable it later in browser settings.', 'error');
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
      await refreshState();
    } catch (error) {
      console.error('Clariva push subscription failed:', error);
      setStatus(error.message || 'Unable to enable notifications. Please try again.', 'error');
    } finally {
      enableButton.disabled = false;
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

  async function sendTest() {
    testButton.disabled = true;
    try {
      await invoke('test');
      setStatus('A test notification request was sent to your connected devices. Check this device.', 'success');
    } catch (error) {
      setStatus(error.message || 'The test notification could not be sent.', 'error');
    } finally {
      testButton.disabled = false;
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
      const { data, error } = await supabaseClient.from('notifications')
        .select('id,event_type,title,message,destination,created_at,read_at,push_sent_at')
        .eq('user_id', activeUserId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
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
    activeUserId = userId;
    createPanel();
    panel.hidden = false;
    watchInbox(userId);
    await Promise.all([refreshState(), loadInbox()]);
  }

  async function hideForSignedOutUser() {
    activeUserId = null;
    if (inboxChannel && supabaseClient) {
      try { await supabaseClient.removeChannel(inboxChannel); } catch (_) {}
      inboxChannel = null;
    }
    if (panel) panel.hidden = true;
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
