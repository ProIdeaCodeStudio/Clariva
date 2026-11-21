/* Clariva site-wide connectivity monitoring and recovery. */
(() => {
  'use strict';

  if (window.ClarivaConnectivity) return;

  const SUPABASE_HEALTH_URL = 'https://euadmjyyjtbbdyjgnoqg.supabase.co/auth/v1/health';
  const SUPABASE_PUBLIC_KEY = 'sb_publishable_a3dhZzlwWPmFD9ixA6VuRg_MZC1X2Nj';
  const SLOW_AFTER_MS = 1800;
  const VERY_SLOW_AFTER_MS = 4000;
  const PROBE_TIMEOUT_MS = 8000;
  const CHECK_INTERVAL_MS = 60000;
  const RECOVERY_MARKER = 'clariva-connectivity-recovery-reload';
  let offlineTransitionSeen = false;
  let probeInProgress = false;
  let intervalId = null;
  let noticeElement = null;
  let noticeText = null;
  let noticeButton = null;
  let noticeDismiss = null;
  let noticeTimer = null;
  let reloadScheduled = false;
  let lastState = 'checking';

  function addStyles() {
    if (document.getElementById('clariva-connectivity-styles')) return;
    const style = document.createElement('style');
    style.id = 'clariva-connectivity-styles';
    style.textContent = [
      '#clariva-connectivity-notice{position:fixed;z-index:2147483000;top:10px;left:12px;right:12px;max-width:720px;margin:0 auto;display:none;align-items:center;gap:12px;padding:13px 15px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#17150f;color:#f5edd8;box-shadow:0 8px 28px rgba(0,0,0,.28);font:500 14px/1.45 Arial,sans-serif}',
      '#clariva-connectivity-notice[data-state="offline"],#clariva-connectivity-notice[data-state="error"]{border-color:#a84a3d}',
      '#clariva-connectivity-notice[data-state="slow"]{border-color:#e8941a}',
      '#clariva-connectivity-notice[data-state="online"]{border-color:#6e9a70}',
      '#clariva-connectivity-notice .clariva-connectivity-copy{flex:1;min-width:0}',
      '#clariva-connectivity-notice .clariva-connectivity-action{border:1px solid #e8941a;border-radius:7px;background:#e8941a;color:#111008;padding:7px 10px;font:700 12px Arial,sans-serif;white-space:nowrap;cursor:pointer}',
      '#clariva-connectivity-notice .clariva-connectivity-dismiss{border:0;background:transparent;color:#f5edd8;font-size:20px;line-height:1;padding:2px 4px;cursor:pointer}',
      '@media(max-width:480px){#clariva-connectivity-notice{left:8px;right:8px;top:8px;padding:11px 10px;font-size:13px;gap:8px}#clariva-connectivity-notice .clariva-connectivity-action{padding:7px 8px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function buildNotice() {
    if (noticeElement || !document.body) return;
    addStyles();
    noticeElement = document.createElement('div');
    noticeElement.id = 'clariva-connectivity-notice';
    noticeElement.setAttribute('role', 'status');
    noticeElement.setAttribute('aria-live', 'polite');
    noticeText = document.createElement('div');
    noticeText.className = 'clariva-connectivity-copy';
    noticeButton = document.createElement('button');
    noticeButton.type = 'button';
    noticeButton.className = 'clariva-connectivity-action';
    noticeButton.hidden = true;
    noticeDismiss = document.createElement('button');
    noticeDismiss.type = 'button';
    noticeDismiss.className = 'clariva-connectivity-dismiss';
    noticeDismiss.setAttribute('aria-label', 'Dismiss notification');
    noticeDismiss.textContent = '×';
    noticeDismiss.addEventListener('click', hideNotice);
    noticeElement.append(noticeText, noticeButton, noticeDismiss);
    document.body.appendChild(noticeElement);
  }

  function hideNotice() {
    if (noticeTimer) window.clearTimeout(noticeTimer);
    if (noticeElement) noticeElement.style.display = 'none';
  }

  function notify(message, state = 'info', actionLabel = '', action = null, duration = 7000) {
    buildNotice();
    if (!noticeElement) return;
    if (noticeTimer) window.clearTimeout(noticeTimer);
    noticeElement.dataset.state = state;
    noticeText.textContent = message;
    noticeButton.hidden = typeof action !== 'function';
    noticeButton.textContent = actionLabel || 'Refresh';
    noticeButton.onclick = typeof action === 'function' ? action : null;
    noticeElement.style.display = 'flex';
    if (duration > 0) noticeTimer = window.setTimeout(hideNotice, duration);
  }

  function hasUnsavedWork() {
    const editable = document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable="true"]');
    for (const field of editable) {
      if (field.disabled || field.readOnly) continue;
      if (field.type === 'file' && field.files && field.files.length) return true;
      if (field.isContentEditable && field.dataset.clarivaDirty === 'true') return true;
      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.checked !== field.defaultChecked) return true;
      } else if (field.value !== field.defaultValue) {
        return true;
      }
    }
    return !!document.querySelector('[aria-busy="true"], [data-uploading="true"], .is-uploading');
  }

  function canReloadSafely() {
    return !hasUnsavedWork();
  }

  function reloadAfterRecovery() {
    if (reloadScheduled) return;
    if (!canReloadSafely()) {
      notify(
        'Your connection is back. Clariva has not refreshed because this page may contain unsaved information. Save your work, then refresh when ready.',
        'online',
        'Refresh now',
        () => window.location.reload(),
        0
      );
      return;
    }

    reloadScheduled = true;
    try {
      sessionStorage.setItem(RECOVERY_MARKER, String(Date.now()));
    } catch (_) {
      // The in-memory guard still prevents repeated reloads in this document.
    }
    notify('Connection restored. Clariva is refreshing to reconnect its services…', 'online', '', null, 0);
    window.setTimeout(() => window.location.reload(), 1400);
  }

  async function probeBackend() {
    if (probeInProgress) return null;
    probeInProgress = true;
    const controller = new AbortController();
    const startedAt = performance.now();
    const timeoutId = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(SUPABASE_HEALTH_URL, {
        method: 'GET',
        headers: { apikey: SUPABASE_PUBLIC_KEY },
        cache: 'no-store',
        signal: controller.signal
      });
      const elapsed = Math.round(performance.now() - startedAt);
      return {
        reachable: true,
        healthy: response.status < 500,
        status: response.status,
        elapsed
      };
    } catch (error) {
      return {
        reachable: false,
        healthy: false,
        elapsed: Math.round(performance.now() - startedAt),
        error
      };
    } finally {
      window.clearTimeout(timeoutId);
      probeInProgress = false;
    }
  }

  function publishState(state, details = {}) {
    lastState = state;
    window.dispatchEvent(new CustomEvent('clariva:connectivity-change', {
      detail: { state, ...details }
    }));
  }

  async function checkConnection(options = {}) {
    if (navigator.onLine === false) {
      publishState('offline');
      notify('You are offline. Check your internet connection. Some Clariva features may be unavailable.', 'offline', '', null, 0);
      return { state: 'offline' };
    }

    const result = await probeBackend();
    if (!result) return { state: lastState };

    if (!result.reachable) {
      publishState('unavailable', result);
      notify('Your device reports a connection, but Clariva’s service cannot be reached yet. We’ll check again automatically.', 'error', '', null, 9000);
      return { state: 'unavailable', ...result };
    }

    if (!result.healthy) {
      publishState('service-degraded', result);
      notify('Clariva’s service is responding slowly or temporarily unavailable. Please try again shortly.', 'error', '', null, 9000);
      return { state: 'service-degraded', ...result };
    }

    const slow = result.elapsed >= SLOW_AFTER_MS;
    const verySlow = result.elapsed >= VERY_SLOW_AFTER_MS;
    const state = verySlow ? 'very-slow' : slow ? 'slow' : 'online';
    publishState(state, result);

    if (options.recovered) {
      const message = slow
        ? 'Network connection restored, but the connection is slow. Some features may take longer.'
        : 'Network connection restored.';
      notify(message, slow ? 'slow' : 'online', '', null, 0);
      reloadAfterRecovery();
    } else if (slow) {
      notify(
        verySlow
          ? 'Your connection to Clariva is very slow. Pages and resources may take longer to load.'
          : 'Your connection to Clariva is slow. Some features may take longer to load.',
        'slow',
        '',
        null,
        9000
      );
    } else if (lastState === 'checking' || lastState === 'unavailable' || lastState === 'service-degraded') {
      publishState('online', result);
    }

    return { state, ...result };
  }

  function handleOffline() {
    offlineTransitionSeen = true;
    publishState('offline');
    notify('You are offline. Check your internet connection. Some Clariva features may be unavailable.', 'offline', '', null, 0);
  }

  async function handleOnline() {
    const wasOffline = offlineTransitionSeen;
    const result = await checkConnection({ recovered: wasOffline });
    if (wasOffline && result.state !== 'offline' && result.state !== 'unavailable' && result.state !== 'service-degraded') {
      offlineTransitionSeen = false;
    } else if (wasOffline && result.state === 'unavailable') {
      window.setTimeout(handleOnline, 10000);
    }
  }

  function startPeriodicChecks() {
    if (intervalId) window.clearInterval(intervalId);
    intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        checkConnection();
      }
    }, CHECK_INTERVAL_MS);
  }

  function clearRecoveryMarker() {
    try {
      const marker = Number(sessionStorage.getItem(RECOVERY_MARKER) || 0);
      if (marker && Date.now() - marker < 30000) {
        sessionStorage.removeItem(RECOVERY_MARKER);
        return true;
      }
      if (marker) sessionStorage.removeItem(RECOVERY_MARKER);
    } catch (_) {}
    return false;
  }

  function initialize() {
    buildNotice();
    const wasReloadedForRecovery = clearRecoveryMarker();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) checkConnection();
    });
    if (navigator.onLine === false) {
      handleOffline();
    } else {
      checkConnection();
    }
    startPeriodicChecks();
    if (wasReloadedForRecovery) {
      notify('Clariva has reconnected. Your page is up to date.', 'online', '', null, 5000);
    }
  }

  window.ClarivaConnectivity = {
    check: checkConnection,
    notify,
    hide: hideNotice,
    getState: () => lastState
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
