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
  let typingTimer = null;
  let typingComplete = false;
  let backdrop = null;
  let observer = null;
  let isActive = false;
  let isOptionalReplay = false;
  let activeFeatureTourId = null;
  // Register each new feature here; completed users receive each short tour once per role/device.
  const FEATURE_TOURS = [
    {
      id: 'offline-saves-v1',
      title: 'Save PDFs for offline reading',
      text: 'When viewing the Resource Library, choose “Save for offline” on a PDF resource. You can then open it without internet from the hamburger menu under “Saved Offline Resources”. Offline copies stay on this device and are tied to the account that saved them.',
      info: true
    }
  ];

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
        },
        { title: 'Find saved offline resources', text: 'Open the menu and choose Saved Offline Resources to see PDFs stored on this device.', target: '#clariva-menu-toggle' },
        { title: 'Saved Offline Resources', text: 'This menu item opens your device library, where saved PDFs remain available without an internet connection.', target: '#clariva-saved-offline-link' }
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
        ]),
        { title: 'Find saved offline resources', text: 'Open the menu and choose Saved Offline Resources to view PDFs stored on this device.', target: '#clariva-menu-toggle' },
        { title: 'Saved Offline Resources', text: 'This opens your device library of saved PDFs, available without an internet connection.', target: '#clariva-saved-offline-link' }
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
      ]),
      { title: 'Find saved offline resources', text: 'Open the menu and choose Saved Offline Resources to view PDFs stored on this device.', target: '#clariva-menu-toggle' },
      { title: 'Saved Offline Resources', text: 'This opens your device library of saved PDFs, available without an internet connection.', target: '#clariva-saved-offline-link' }
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

  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'clariva-tour-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function ensureCard() {
    if (card) return card;
    card = document.createElement('section');
    card.className = 'clariva-tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<p class="clariva-tour-eyebrow"></p><h2 class="clariva-tour-title"></h2><p class="clariva-tour-copy"></p><p class="clariva-tour-instruction"></p><div class="clariva-tour-footer"><span class="clariva-tour-progress"></span><div class="clariva-tour-actions"><button type="button" class="clariva-tour-previous">Previous</button><button type="button" class="clariva-tour-skip">Skip</button><button type="button" class="clariva-tour-next">Next</button></div></div>';
    document.body.appendChild(card);
    card.querySelector('.clariva-tour-next').addEventListener('click', () => {
      if (!typingComplete) return;
      advance();
    });
    card.querySelector('.clariva-tour-previous').addEventListener('click', goPrevious);
    card.querySelector('.clariva-tour-skip').addEventListener('click', skipTour);
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
    const expected = step && step.target ? findTarget(step.target) : null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (card && (path.includes(card) || card.contains(event.target))) return;
    if (expected && (expected === event.target || expected.contains(event.target))) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function positionCard() {
    if (!card) return;
    card.style.left = '';
    card.style.top = '';
    const edge = 12;
    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panel = card.getBoundingClientRect();
    if (!targetElement) {
      card.style.left = Math.max(edge, (vw - panel.width) / 2) + 'px';
      card.style.top = Math.max(edge, (vh - panel.height) / 2) + 'px';
      return;
    }
    const target = targetElement.getBoundingClientRect();
    const candidates = [
      { left: target.right + gap, top: target.top + (target.height - panel.height) / 2 },
      { left: target.left - panel.width - gap, top: target.top + (target.height - panel.height) / 2 },
      { left: target.left + (target.width - panel.width) / 2, top: target.bottom + gap },
      { left: target.left + (target.width - panel.width) / 2, top: target.top - panel.height - gap }
    ];
    const fits = p => p.left >= edge && p.top >= edge &&
      p.left + panel.width <= vw - edge && p.top + panel.height <= vh - edge;
    let chosen = candidates.find(fits);
    if (!chosen) {
      const belowSpace = vh - target.bottom - gap;
      const aboveSpace = target.top - gap;
      const placeBelow = belowSpace >= aboveSpace;
      const top = placeBelow
        ? Math.min(vh - panel.height - edge, target.bottom + gap)
        : Math.max(edge, target.top - panel.height - gap);
      const left = Math.max(edge, Math.min(vw - panel.width - edge,
        target.left + target.width / 2 - panel.width / 2));
      chosen = { left, top };
    }
    card.style.left = Math.round(chosen.left) + 'px';
    card.style.top = Math.round(chosen.top) + 'px';
  }

  function typeExplanation(text, ui) {
    if (typingTimer) window.clearTimeout(typingTimer);
    typingComplete = false;
    const copy = ui.querySelector('.clariva-tour-copy');
    const next = ui.querySelector('.clariva-tour-next');
    copy.textContent = text;
    copy.style.visibility = 'hidden';
    ui.style.minHeight = '';
    const reservedHeight = ui.offsetHeight;
    ui.style.minHeight = reservedHeight + 'px';
    copy.textContent = '';
    copy.style.visibility = 'visible';
    next.disabled = true;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      copy.textContent = text;
      typingComplete = true;
      next.disabled = false;
      ui.style.minHeight = '';
      positionCard();
      return;
    }
    let index = 0;
    const typeNext = () => {
      if (!isActive || !card || getCurrentStep()?.text !== text) return;
      index += 1;
      copy.textContent = text.slice(0, index);
      if (index < text.length) {
        typingTimer = window.setTimeout(typeNext, 24);
      } else {
        typingComplete = true;
        next.disabled = false;
        next.textContent = stepIndex === steps.length - 1 ? 'Finish' : 'Next';
        ui.style.minHeight = '';
        positionCard();
      }
    };
    if (!text) {
      typingComplete = true;
      next.disabled = false;
      return;
    }
    typingTimer = window.setTimeout(typeNext, 24);
  }

  function showStep() {
    if (!isActive) return;
    clearTarget();
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = null;
    const step = getCurrentStep();
    if (!step) return finishSegment();

    ensureBackdrop();
    const ui = ensureCard();
    ui.querySelector('.clariva-tour-eyebrow').textContent =
      (pageNames[PAGE] || 'Clariva') + ' · Guided tour';
    ui.querySelector('.clariva-tour-title').textContent = step.title;
    ui.querySelector('.clariva-tour-progress').textContent =
      'Step ' + (stepIndex + 1) + ' of ' + steps.length;
    const instruction = ui.querySelector('.clariva-tour-instruction');
    const previous = ui.querySelector('.clariva-tour-previous');
    const next = ui.querySelector('.clariva-tour-next');
    const skip = ui.querySelector('.clariva-tour-skip');
    previous.disabled = stepIndex === 0;
    skip.hidden = !isOptionalReplay;
    next.disabled = true;
    next.textContent = stepIndex === steps.length - 1 ? 'Finish' : 'Next';
    instruction.textContent = step.target
      ? 'Follow the highlighted area, then select Next.'
      : 'Read this introduction, then select Next.';
    ui.classList.add('is-visible');
    ui.style.visibility = 'hidden';

    if (!step.target || step.info) {
      targetElement = null;
      ui.style.visibility = 'visible';
      positionCard();
      typeExplanation(step.text, ui);
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
          skipUnavailableStep();
          return;
        }
        targetElement = target;
        target.classList.add('clariva-tour-target');
        target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        ui.style.visibility = 'visible';
        positionCard();
        typeExplanation(step.text, ui);
        return;
      }
      if (step.optional && Date.now() - startedAt > 6500) {
        skipUnavailableStep();
        return;
      }
      if (Date.now() - startedAt > 15000) {
        ui.style.visibility = 'visible';
        instruction.textContent = 'This area is not currently available. Select Next after reading.';
        typeExplanation(step.text, ui);
        return;
      }
      window.setTimeout(seek, 250);
    };
    seek();
  }

  function advance() {
    if (!isActive || !typingComplete) return;
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

  function skipUnavailableStep() {
    if (!isActive) return;
    stepIndex += 1;
    if (session) {
      session.stepIndex = stepIndex;
      writeJson(sessionStorageKey(), session);
    }
    if (stepIndex >= steps.length) finishSegment();
    else showStep();
  }

  function goPrevious() {
    if (!isActive || stepIndex <= 0) return;
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = null;
    stepIndex -= 1;
    if (session) {
      session.stepIndex = stepIndex;
      writeJson(sessionStorageKey(), session);
    }
    showStep();
  }

  function skipTour() {
    if (!isActive || !isOptionalReplay) return;
    finishSegment(false);
  }

  function finishSegment(showNotice = true) {
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = null;
    clearTarget();
    if (backdrop) backdrop.remove();
    backdrop = null;
    if (card) card.remove();
    card = null;
    document.removeEventListener('click', blockOutsideClicks, true);
    isActive = false;

    try {
      if (activeFeatureTourId) {
        localStorage.setItem('clariva-feature-tour:' + activeFeatureTourId + ':' + userId + ':' + profileRole, 'complete');
        activeFeatureTourId = null;
      } else {
        localStorage.setItem(completionStorageKey(), 'complete');
      }
      localStorage.removeItem(sessionStorageKey());
    } catch (error) {
      console.warn('Clariva tour completion could not be saved:', error);
    }
    isOptionalReplay = false;
    if (showNotice) showCompletionMessage();
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
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = null;
    if (backdrop) backdrop.remove();
    backdrop = null;
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = null;
    clearTarget();
    if (card) card.remove();
    card = null;
    document.removeEventListener('click', blockOutsideClicks, true);
    isActive = false;
    isOptionalReplay = false;
    activeFeatureTourId = null;
    try { localStorage.removeItem(sessionStorageKey()); }
    catch (error) { console.warn('Clariva tour session could not be cleared:', error); }
  }

  function startTour(optionalReplay, customSteps = null, featureTourId = null) {
    if (isActive) return;
    isOptionalReplay = Boolean(optionalReplay);
    activeFeatureTourId = featureTourId;
    steps = customSteps || getStepSet();
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

    if (localStorage.getItem(completionStorageKey()) === 'complete') {
      const pendingFeature = FEATURE_TOURS.find(feature =>
        localStorage.getItem('clariva-feature-tour:' + feature.id + ':' + userId + ':' + profileRole) !== 'complete'
      );
      if (pendingFeature) {
        startTour(true, [{ title: pendingFeature.title, text: pendingFeature.text, info: pendingFeature.info !== false, ...(pendingFeature.target ? { target: pendingFeature.target } : {}) }], pendingFeature.id);
      }
      return;
    }

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
