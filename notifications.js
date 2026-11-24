/* Clariva device push-notification controls. Requires an explicit user action. */
(() => {
  'use strict';

  const FUNCTION_NAME = 'clariva-push';
  const PUBLIC_KEY = window.CLARIVA_VAPID_PUBLIC_KEY || '';
  let activeUserId = null;
  let panel = null;
  let statusNode = null;
  let enableButton = null;
  let disableButton = null;
  let testButton = null;
  let initialized = false;

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
      </div>`;
    document.body.appendChild(panel);
    statusNode = panel.querySelector('#clariva-push-status');
    enableButton = panel.querySelector('#clariva-push-enable');
    disableButton = panel.querySelector('#clariva-push-disable');
    testButton = panel.querySelector('#clariva-push-test');

    panel.querySelector('#clariva-push-close').addEventListener('click', () => { panel.hidden = true; });
    enableButton.addEventListener('click', enableNotifications);
    disableButton.addEventListener('click', disableNotifications);
    testButton.addEventListener('click', sendTest);
  }

  async function invoke(action, extra = {}) {
    if (!window.supabaseClient) throw new Error('Clariva account services are unavailable. Refresh and try again.');
    const { data, error } = await window.supabaseClient.functions.invoke(FUNCTION_NAME, {
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
        await invoke('unsubscribe', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
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
      setStatus('A test notification has been sent to this device.', 'success');
    } catch (error) {
      setStatus(error.message || 'The test notification could not be sent.', 'error');
    } finally {
      testButton.disabled = false;
    }
  }

  async function showForUser(userId) {
    if (!userId || window.clarivaOfflineMode === true) return;
    if (activeUserId === userId && panel) return;
    activeUserId = userId;
    createPanel();
    panel.hidden = false;
    await refreshState();
  }

  async function hideForSignedOutUser() {
    activeUserId = null;
    if (panel) panel.hidden = true;
  }

  async function initialize() {
    if (initialized || !window.supabaseClient || window.clarivaOfflineMode === true) return;
    initialized = true;
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (session?.user?.id) await showForUser(session.user.id);
    window.supabaseClient.auth.onAuthStateChange((event, sessionNow) => {
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
