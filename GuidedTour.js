/* Clariva guided tour. First-run onboarding is required; replay is optional. */
(() => {
  'use strict';

  const PAGE = window.location.pathname.split('/').pop();
  const ROLE_DASHBOARD = {
    student: 'Undergraduates.html',
    admin: 'AdminDashboard.html',
    owner: 'OwnerDashboard.html'
  };
  const STORAGE_PREFIX = 'clariva-guided-tour-v2:';
  const SESSION_PREFIX = 'clariva-guided-tour-session-v2:';
  const pageNames = {
    'Undergraduates.html': 'Student Resource Library',
    'AdminDashboard.html': 'Admin Dashboard',
    'OwnerDashboard.html': 'Owner Dashboard'
  };

  const byId = id => document.getElementById(id);
  let userId = null;
  let profileRole = 'student';
  let steps = [];
  let stepIndex = 0;
  let session = null;
  let card = null;
  let targetElement = null;
  let advanceTimer = null;
  let observer = null;
  let isActive = false;
  let isOptionalReplay = false;

  function sessionStorageKey() {
    return `${SESSION_PREFIX}${userId}:${profileRole}`;
  }

  function completionStorageKey() {
    return `${STORAGE_PREFIX}${userId}:${profileRole}`;
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (error) { console.warn('Clariva tour progress could not be saved:', error); }
  }

  function getStepSet() {
    const welcome = {
      title: 'Welcome to Clariva',
      text: 'This short tour points out the main sections and shows you where to find them.',
      info: true
    };

    const menuSteps = sections => sections.flatMap(section => [
      {
        title: 'Open dashboard navigation',
        text: 'Open the menu to move to the next section.',
        target: '#clariva-menu-toggle'
      },
      {
        title: section.title,
        text: section.text,
        target: '#clariva-nav-menu a[href="#' + section.id + '"]'
      }
    ]);

    if (PAGE === 'Undergraduates.html') {
      return [
        welcome,
        {
          title: 'Choose an academic level',
          text: 'Start here to browse the resources available for an academic level.',
          target: '#student-level-grid [data-level-choice]',
          optional: true
        },
        {
          title: 'Choose a semester',
          text: 'Select a semester to open its learning materials.',
          target: '#semester-picker-panel [data-semester-choice]',
          optional: true
        },
        {
          title: 'Browse learning resources',
          text: 'Your selected semester’s resources appear in this area.',
          target: '#all-resources',
          optional: true
        }
      ];
    }

    if (PAGE === 'AdminDashboard.html') {
      return [
        welcome,
        ...menuSteps([
          { id: 'resource-management', title: 'Resource overview', text: 'View the main summary of resources in the library.' },
          { id: 'upload-resource', title: 'Upload resources', text: 'Go here to add learning materials to the library.' },
          { id: 'manage-resources', title: 'Manage resources', text: 'Find and manage resources that have already been added.' },
          { id: 'user-overview', title: 'User overview', text: 'View the account summary and user breakdowns.' },
          { id: 'platform-overview', title: 'Platform overview', text: 'View the wider platform and library activity summary.' }
        ])
      ];
    }

    return [
      welcome,
      ...menuSteps([
        { id: 'owner-overview', title: 'Owner overview', text: 'Return here for the main overview of Clariva.' },
        { id: 'owner-activity', title: 'Owner activity', text: 'View the platform activity summaries and trends.' },
        { id: 'owner-controls', title: 'User management', text: 'Find accounts and review account information and access.' },
        { id: 'upload-resource', title: 'Upload resources', text: 'Go here to add learning materials to the library.' },
        { id: 'manage-resources', title: 'Manage resources', text: 'Find and manage resources already in the library.' },
        { id: 'user-overview', title: 'User overview', text: 'View the account summary and user breakdowns.' },
        { id: 'platform-overview', title: 'Platform overview', text: 'View the wider platform and library activity summary.' }
      ])
    ];
  }

  function getCurrentStep() {
    return steps[stepIndex] || null;
  }

  function findTarget(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); }
    catch (_) { return null; }
  }

  function ensureCard() {
    if (card) return card;
    card = document.createElement('section');
    card.className = 'clariva-tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<p class="clariva-tour-eyebrow"></p><h2 class="clariva-tour-title"></h2><p class="clariva-tour-copy"></p><p class="clariva-tour-instruction"></p><div class="clariva-tour-footer"><span class="clariva-tour-progress"></span><div class="clariva-tour-actions"><button type="button" class="clariva-tour-skip">Skip step</button><button type="button" class="clariva-tour-cancel">End tour</button><button type="button" class="clariva-tour-continue">Continue</button></div></div>';
    document.body.appendChild(card);
    card.querySelector('.clariva-tour-continue').addEventListener('click', () => {
      const step = getCurrentStep();
      if (step?.target && !step.info) return;
      advance();
    });
    card.querySelector('.clariva-tour-skip').addEventListener('click', advance);
    card.querySelector('.clariva-tour-cancel').addEventListener('click', cancelTour);
    return card;
  }

  function clearTarget() {
    if (targetElement) targetElement.classList.remove('clariva-tour-target');
    targetElement = null;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function blockOutsideClicks(event) {
    if (!isActive) return;
    const step = getCurrentStep();
    const expected = step?.target ? findTarget(step.target) : null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (card && (path.includes(card) || card.contains(event.target))) return;
    if (expected && (expected === event.target || expected.contains(event.target))) {
      if (!step.info && !step._clicked) {
        step._clicked = true;
        const button = card?.querySelector('.clariva-tour-continue');
        if (button) button.disabled = false;
        if (advanceTimer) clearTimeout(advanceTimer);
        advanceTimer = window.setTimeout(() => advance(), 280);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function positionCard() {
    if (!card) return;
    card.style.left = '';
    card.style.top = '';
    if (!targetElement) {
      card.classList.remove('clariva-tour-card-above');
      return;
    }

    targetElement.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    window.requestAnimationFrame(() => {
      if (!card || !targetElement || !isActive) return;
      const target = targetElement.getBoundingClientRect();
      const panel = card.getBoundingClientRect();
      const gap = 16;
      const edge = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const candidates = [
        { left: target.right + gap, top: target.top + (target.height - panel.height) / 2 },
        { left: target.left - panel.width - gap, top: target.top + (target.height - panel.height) / 2 },
        { left: target.left + (target.width - panel.width) / 2, top: target.bottom + gap },
        { left: target.left + (target.width - panel.width) / 2, top: target.top - panel.height - gap }
      ];
      const fits = p => p.left >= edge && p.top >= edge &&
        p.left + panel.width <= vw - edge && p.top + panel.height <= vh - edge;
      const chosen = candidates.find(fits);
      if (chosen) {
        card.style.left = Math.round(chosen.left) + 'px';
        card.style.top = Math.round(chosen.top) + 'px';
      } else {
        // On narrow screens or near viewport edges, keep the panel in view
        // and place it at the side of the highlighted target where possible.
        const left = Math.max(edge, Math.min(vw - panel.width - edge,
          target.left + target.width / 2 - panel.width / 2));
        const below = target.bottom + gap + panel.height <= vh - edge;
        const top = below ? target.bottom + gap : Math.max(edge, target.top - panel.height - gap);
        card.style.left = Math.round(left) + 'px';
        card.style.top = Math.round(top) + 'px';
      }
    });
  }

  function showStep() {
    if (!isActive) return;
    clearTarget();
    const step = getCurrentStep();
    if (!step) return finishSegment();

    const ui = ensureCard();
    ui.querySelector('.clariva-tour-eyebrow').textContent =
      (pageNames[PAGE] || 'Clariva') + ' · Guided tour';
    ui.querySelector('.clariva-tour-title').textContent = step.title;
    ui.querySelector('.clariva-tour-copy').textContent = step.text;
    ui.querySelector('.clariva-tour-progress').textContent =
      'Step ' + (stepIndex + 1) + ' of ' + steps.length;
    const instruction = ui.querySelector('.clariva-tour-instruction');
    const button = ui.querySelector('.clariva-tour-continue');
    const skipButton = ui.querySelector('.clariva-tour-skip');
    const cancelButton = ui.querySelector('.clariva-tour-cancel');
    button.disabled = Boolean(step.target && !step.info);
    button.textContent = stepIndex === steps.length - 1 ? 'Finish tour' : 'Continue';
    skipButton.hidden = !isOptionalReplay;
    cancelButton.hidden = !isOptionalReplay;
    instruction.textContent = step.target && !step.info
      ? (isOptionalReplay ? 'Select the highlighted item, or skip this step.' : 'Select the highlighted item to continue.')
      : 'Read this while looking at the highlighted area, then continue.';
    ui.classList.add('is-visible');

    if (!step.target || step.info) {
      positionCard();
      return;
    }

    const startedAt = Date.now();
    const seek = () => {
      if (!isActive || getCurrentStep() !== step) return;
      const target = findTarget(step.target);
      const containingDialog = target?.closest('dialog');
      const targetIsVisible = target &&
        !target.closest('[hidden]') &&
        (!containingDialog || containingDialog.open) &&
        target.getClientRects().length > 0;
      if (targetIsVisible) {
        if (step.optional && target.disabled) {
          advance();
          return;
        }
        targetElement = target;
        target.classList.add('clariva-tour-target');
        positionCard();
        return;
      }
      if (step.optional && Date.now() - startedAt > 6500) {
        advance();
        return;
      }
      if (Date.now() - startedAt > 15000) {
        instruction.textContent = 'This control is not currently available. Continue to the next explanation.';
        button.disabled = false;
        button.textContent = 'Continue';
        return;
      }
      window.setTimeout(seek, 250);
    };
    seek();
  }

  function advance() {
    if (!isActive) return;
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = null;
    stepIndex += 1;
    if (session) {
      session.stepIndex = stepIndex;
      writeJson(sessionStorageKey(), session);
    }
    if (stepIndex >= steps.length) {
      finishSegment();
      return;
    }
    showStep();
  }

  function finishSegment() {
    clearTarget();
    if (card) card.remove();
    card = null;
    document.removeEventListener('click', blockOutsideClicks, true);
    isActive = false;

    try {
      localStorage.setItem(completionStorageKey(), 'complete');
      localStorage.removeItem(sessionStorageKey());
    } catch (error) {
      console.warn('Clariva tour completion could not be saved:', error);
    }
    isOptionalReplay = false;
    showCompletionMessage();
  }

  function showCompletionMessage() {
    const completion = document.createElement('section');
    completion.className = 'clariva-tour-complete';
    completion.setAttribute('role', 'status');
    completion.innerHTML = '<h2>Tour completed</h2><p>You can revisit this guide any time from the Website Tour option in the menu.</p><button type="button">Got it</button>';
    document.body.appendChild(completion);
    completion.querySelector('button').addEventListener('click', () => completion.remove());
  }

  function cancelTour() {
    if (!isActive || !isOptionalReplay) return;
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = null;
    clearTarget();
    if (card) card.remove();
    card = null;
    document.removeEventListener('click', blockOutsideClicks, true);
    isActive = false;
    isOptionalReplay = false;
    try { localStorage.removeItem(sessionStorageKey()); }
    catch (error) { console.warn('Clariva tour session could not be cleared:', error); }
  }

  function startTour(optionalReplay) {
    if (isActive) return;
    isOptionalReplay = Boolean(optionalReplay);
    steps = getStepSet();
    stepIndex = 0;
    session = { userId, role: profileRole, page: PAGE, stepIndex: 0 };
    writeJson(sessionStorageKey(), session);
    isActive = true;
    document.addEventListener('click', blockOutsideClicks, true);
    showStep();
  }

  async function initialize() {
    if (!['Undergraduates.html', 'AdminDashboard.html', 'OwnerDashboard.html'].includes(PAGE)) return;
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
    const { data: authData, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !authData?.user) return;
    userId = authData.user.id;

    const { data: profile, error } = await supabaseClient
      .from('students')
      .select('Role, Verified')
      .eq('user_id', userId)
      .single();
    if (error || !profile || profile.Verified !== true) return;
    profileRole = String(profile.Role || 'student').toLowerCase();
    const roleDashboard = ROLE_DASHBOARD[profileRole] || ROLE_DASHBOARD.student;

    // Each role receives its tour only on its own dashboard. Other accessible
    // pages do not start or extend a tour for a different dashboard.
    if (PAGE !== roleDashboard) return;

    const replayButton = byId('clariva-start-tour');
    if (replayButton) {
      replayButton.addEventListener('click', event => {
        event.preventDefault();
        const menu = byId('clariva-nav-menu');
        const menuToggle = byId('clariva-menu-toggle');
        if (menu) menu.hidden = true;
        if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
        startTour(true);
      });
    }

    if (localStorage.getItem(completionStorageKey()) === 'complete') return;

    session = readJson(sessionStorageKey());
    if (!session || session.userId !== userId || session.role !== profileRole ||
        session.page !== PAGE || !Number.isInteger(session.stepIndex)) {
      session = {
        userId,
        role: profileRole,
        page: PAGE,
        stepIndex: 0
      };
      writeJson(sessionStorageKey(), session);
    }

    steps = getStepSet();
    stepIndex = Math.max(0, Math.min(Number(session.stepIndex || 0), steps.length - 1));
    isOptionalReplay = false;
    isActive = true;
    document.addEventListener('click', blockOutsideClicks, true);
    showStep();
  }

  const ready = window.clarivaPageReady;
  if (ready && typeof ready.then === 'function') {
    ready.then(initialize).catch(error => console.error('Clariva guided tour could not start:', error));
  } else {
    void initialize();
  }
})();
