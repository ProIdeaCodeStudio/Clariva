/* Clariva required, resumable product tour.
   Progress is account-scoped in this browser. No skip or dismiss action is provided. */
(() => {
  'use strict';

  const PAGE = window.location.pathname.split('/').pop();
  const PAGE_SEQUENCE = {
    student: ['Undergraduates.html'],
    admin: ['AdminDashboard.html', 'Undergraduates.html'],
    owner: ['OwnerDashboard.html', 'AdminDashboard.html', 'Undergraduates.html']
  };
  const STORAGE_PREFIX = 'clariva-guided-tour-v1:';
  const SESSION_PREFIX = 'clariva-guided-tour-session-v1:';
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

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (error) { console.warn('Clariva tour progress could not be saved:', error); }
  }

  function getStepSet() {
    if (PAGE === 'Undergraduates.html') {
      return [
        { title: 'Welcome to Clariva', text: 'This short guided tour explains the controls on this page. You will move through the available dashboards linked to your account. There is no skip option; your progress is saved so you can continue if you leave.', info: true },
        { title: 'Dashboard navigation', text: 'Open this menu to move between the dashboards your account is permitted to use. The sign-out control is intentionally not part of the tour.', target: '#clariva-menu-toggle' },
        { title: 'Your account menu', text: 'Open your account menu to see your account details and profile settings.', target: '#clariva-profile-toggle' },
        { title: 'Choose an avatar', text: 'Select an avatar to personalise your Clariva account. The selection is saved to your profile.', target: '[data-avatar-choice]' },
        { title: 'Choose an academic level', text: 'The library lists your current academic level and earlier levels that have published resources. Select a level to continue.', target: '#student-level-grid [data-level-choice]', optional: true },
        { title: 'Choose a semester', text: 'Each level is organised into First Semester and Second Semester. Choose the semester whose materials you want to browse.', target: '#semester-picker-panel [data-semester-choice]', optional: true },
        { title: 'Search the collection', text: 'Search by resource title, course code, or course title to narrow the displayed materials.', target: '#resource-search', optional: true },
        { title: 'Filter by resource type', text: 'Use this filter to show only a particular type of material, such as lecture notes, handouts, or past questions.', target: '#resource-type-filter', optional: true },
        { title: 'Offline Saves', text: 'Use “Save for offline” on a resource card to store an app-managed copy on this device for later reading without an internet connection. This is separate from Downloads. Saved copies use this device’s storage and remain associated with your account. Clearing browser storage removes them.', info: true },
        { title: 'Open a resource', text: 'Open a learning resource to read it in Clariva’s in-page PDF viewer. The viewer includes page navigation and zoom controls.', target: '#all-resources .student-resource-open', optional: true },
        { title: 'Close the viewer', text: 'Close the viewer to return to the resource list. You can then go back to the semester chooser and select another semester or level.', target: '#pdf-reader-close', optional: true }
      ];
    }

    if (PAGE === 'AdminDashboard.html') {
      return [
        { title: 'Welcome to the Admin Dashboard', text: 'This tour explains the administrator tools. You will see how to navigate resource management, uploads, user overview, and platform statistics. It will not submit uploads or execute account-changing actions.', info: true },
        { title: 'Dashboard navigation', text: 'Open the navigation menu to move between the administrator sections and any other dashboard available to your account.', target: '#clariva-menu-toggle' },
        { title: 'Resource overview', text: 'This section summarises the resource library, including total resources, featured resources, and the existing Downloads metric. Offline Saves is tracked separately in Platform Overview.', target: '#clariva-nav-menu a[href="#resource-management"]' },
        { title: 'Open the upload workspace', text: 'The upload workspace is where verified administrators add learning materials and assign their academic metadata.', target: '#clariva-menu-toggle' },
        { title: 'Upload resource', text: 'Open the upload section to see the complete upload form.', target: '#clariva-nav-menu a[href="#upload-resource"]' },
        { title: 'Resource description', text: 'Describe the learning material. A clear description helps students understand what the document contains.', target: '#resource-description' },
        { title: 'Department', text: 'Enter the department associated with the resource.', target: '#resource-department' },
        { title: 'Academic level', text: 'Choose the level for which the resource is intended. Students at that level and higher can access it, subject to verification and publication rules.', target: '#resource-level' },
        { title: 'Semester', text: 'Choose First or Second Semester. This determines where the resource appears in the student library.', target: '#resource-semester' },
        { title: 'Course details', text: 'Enter the course code and course title so students can identify the material.', target: '#resource-course-code' },
        { title: 'Resource type', text: 'Choose the correct resource type to keep the library organised and make filtering useful.', target: '#resource-type' },
        { title: 'Choose document files', text: 'Select one or more supported documents from device storage or Google Drive. The batch confirmation step checks that shared metadata is appropriate for all selected files.', target: '#resource-source-open' },
        { title: 'File source options', text: 'The source dialog lets you choose files from your device or Google Drive. The tour will close the dialog without selecting or uploading anything.', target: '#resource-source-close' },
        { title: 'Upload safely', text: 'Review the selected files, metadata, and upload queue before submitting. The upload button starts the resumable upload process, so this tour will not press it.', target: '#resource-upload-button', info: true },
        { title: 'Manage resources', text: 'Open this section to search, filter, preview, edit, publish or hide, feature, and remove resources. Destructive actions are explained but never executed during onboarding.', target: '#clariva-menu-toggle' },
        { title: 'Resource management tools', text: 'Open the resource list. Use its search and filters to find materials; each resource card contains its own management actions.', target: '#clariva-nav-menu a[href="#manage-resources"]' },
        { title: 'Search resources', text: 'Search by title or course to locate a particular item in the library.', target: '#resource-search' },
        { title: 'Filter by level', text: 'Limit the resource list to a selected academic level.', target: '#filter-level' },
        { title: 'User overview', text: 'This section presents account totals and role and academic-level distributions. It does not expose individual student contact details.', target: '#clariva-menu-toggle' },
        { title: 'Open user overview', text: 'View the account summary and the breakdowns by role and academic level.', target: '#clariva-nav-menu a[href="#user-overview"]' },
        { title: 'Platform overview', text: 'This section presents library-wide totals, recent additions, resource-type distribution, views, Downloads, and the distinct Offline Saves metric.', target: '#clariva-menu-toggle' },
        { title: 'Open platform overview', text: 'Review aggregate platform activity and use Refresh overview to request the latest summary.', target: '#clariva-nav-menu a[href="#platform-overview"]' }
      ];
    }

    return [
      { title: 'Welcome to the Owner Dashboard', text: 'This tour explains the owner controls, activity summaries, resource administration, and the other dashboards available to your account. It will not change account roles, verification, or delete accounts.', info: true },
      { title: 'Dashboard navigation', text: 'Open this menu to move between owner sections and the other dashboards your account can access.', target: '#clariva-menu-toggle' },
      { title: 'User management', text: 'Open the account directory to search for users and review account roles, academic levels, verification status, join dates, and last login.', target: '#clariva-nav-menu a[href="#owner-controls"]' },
      { title: 'Find an account', text: 'Search the account directory by name, email, role, or level.', target: '#owner-account-search' },
      { title: 'Account actions', text: 'This table shows account privileges and status. Role changes, verification changes, and permanent account removal are sensitive actions; the tour explains them but will not execute them.', target: '#owner-account-table' },
      { title: 'Owner activity', text: 'Open the activity section to review aggregate resource views, unique viewers, daily trends, and Offline Saves. Individual student activity records are not exposed here.', target: '#clariva-menu-toggle' },
      { title: 'Open owner activity', text: 'Review the aggregate activity chart and refresh the summary when needed.', target: '#clariva-nav-menu a[href="#owner-activity"]' },
      { title: 'Upload resources', text: 'The owner dashboard also includes the resource upload workflow. The form and file-selection process are explained in the Admin Dashboard tour.', target: '#clariva-menu-toggle' },
      { title: 'Open upload workspace', text: 'Navigate to the upload section shared with administrators.', target: '#clariva-nav-menu a[href="#upload-resource"]' },
      { title: 'Manage resources', text: 'The resource manager supports searching, filtering, previewing, editing, publishing, featuring, and deleting resources. Destructive actions are not performed during this tour.', target: '#clariva-menu-toggle' },
      { title: 'Open resource manager', text: 'Open the shared resource management workspace.', target: '#clariva-nav-menu a[href="#manage-resources"]' },
      { title: 'User overview', text: 'Review account totals and role and level distributions.', target: '#clariva-menu-toggle' },
      { title: 'Open user overview', text: 'View the account overview section.', target: '#clariva-nav-menu a[href="#user-overview"]' },
      { title: 'Platform overview', text: 'Review platform totals, recorded Downloads, distinct Offline Saves, views, and recent library changes.', target: '#clariva-menu-toggle' },
      { title: 'Open platform overview', text: 'Open the aggregate platform statistics.', target: '#clariva-nav-menu a[href="#platform-overview"]' }
    ];
  }

  function pageUrl(page) {
    return page;
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
    card.innerHTML = '<p class="clariva-tour-eyebrow"></p><h2 class="clariva-tour-title"></h2><p class="clariva-tour-copy"></p><p class="clariva-tour-instruction"></p><div class="clariva-tour-footer"><span class="clariva-tour-progress"></span><button type="button" class="clariva-tour-continue">Continue</button></div>';
    document.body.appendChild(card);
    card.querySelector('.clariva-tour-continue').addEventListener('click', () => {
      const step = getCurrentStep();
      if (step?.target && !step.info) return;
      advance();
    });
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
    card.classList.remove('clariva-tour-card-above');
    if (targetElement) {
      const rect = targetElement.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.58 || rect.bottom + cardRect.height + 28 > window.innerHeight) {
        card.classList.add('clariva-tour-card-above');
      }
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
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
    button.disabled = Boolean(step.target && !step.info);
    button.textContent = stepIndex === steps.length - 1 ? 'Finish this dashboard' : 'Continue';
    instruction.textContent = step.target && !step.info
      ? 'Select the highlighted control to continue.'
      : 'Select Continue when you have read this explanation.';
    ui.classList.add('is-visible');

    if (!step.target || step.info) {
      positionCard();
      return;
    }

    const startedAt = Date.now();
    const seek = () => {
      if (!isActive || getCurrentStep() !== step) return;
      const target = findTarget(step.target);
      if (target && !target.closest('[hidden]')) {
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
      writeJson(SESSION_PREFIX + userId, session);
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

    session.index += 1;
    if (session.index < session.sequence.length) {
      session.stepIndex = 0;
      writeJson(SESSION_PREFIX + userId, session);
      window.location.assign(pageUrl(session.sequence[session.index]));
      return;
    }

    const startPage = session.startPage;
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, 'complete');
      localStorage.removeItem(SESSION_PREFIX + userId);
    } catch (error) {
      console.warn('Clariva tour completion could not be saved:', error);
    }
    if (startPage !== PAGE) {
      window.location.assign(pageUrl(startPage));
      return;
    }
    showCompletionMessage();
  }

  function showCompletionMessage() {
    const completion = document.createElement('section');
    completion.className = 'clariva-tour-complete';
    completion.setAttribute('role', 'status');
    completion.innerHTML = '<h2>Tour completed</h2><p>You have completed the guided tour for every dashboard available to your account.</p><button type="button">Return to Clariva</button>';
    document.body.appendChild(completion);
    completion.querySelector('button').addEventListener('click', () => completion.remove());
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
    const sequence = PAGE_SEQUENCE[profileRole] || PAGE_SEQUENCE.student;

    if (localStorage.getItem(STORAGE_PREFIX + userId) === 'complete') return;

    session = readJson(SESSION_PREFIX + userId);
    if (!session || session.userId !== userId || !Array.isArray(session.sequence)) {
      const startPage = PAGE;
      session = {
        userId,
        role: profileRole,
        startPage,
        sequence: sequence.slice(),
        index: Math.max(0, sequence.indexOf(PAGE)),
        stepIndex: 0
      };
      writeJson(SESSION_PREFIX + userId, session);
    }

    if (session.sequence[session.index] !== PAGE) {
      const expectedPage = session.sequence[session.index];
      if (expectedPage && expectedPage !== PAGE) {
        window.location.assign(pageUrl(expectedPage));
        return;
      }
      return;
    }

    steps = getStepSet();
    stepIndex = Math.max(0, Math.min(Number(session.stepIndex || 0), steps.length - 1));
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
