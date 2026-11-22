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
    if (PAGE === 'Undergraduates.html') {
      return [
        { title: 'Welcome to Clariva', text: 'This short guided tour explains the controls on this page. You will move through the available dashboards linked to your account. There is no skip option; your progress is saved so you can continue if you leave.', info: true },
        { title: 'Your account menu', text: 'Open your account menu to review your account details and profile settings.', target: '#clariva-profile-toggle' },
        { title: 'Choose an avatar', text: 'Select an avatar to personalise your Clariva account. The selection is saved to your profile.', target: '[data-avatar-choice]' },
        { title: 'Dashboard navigation', text: 'Open this menu to move between the dashboards your account is permitted to use. The sign-out control is intentionally not part of the tour.', target: '#clariva-menu-toggle' },
        { title: 'Close dashboard navigation', text: 'Close the navigation menu to return to your resource library.', target: '#clariva-menu-toggle' },
        { title: 'Choose an academic level', text: 'The library lists your current academic level and earlier levels that have published resources. Select a level to continue.', target: '#student-level-grid [data-level-choice]', optional: true },
        { title: 'Choose a semester', text: 'Each level is organised into First Semester and Second Semester. Choose the semester whose materials you want to browse.', target: '#semester-picker-panel [data-semester-choice]', optional: true },
        { title: 'Search the collection', text: 'Search by resource title, course code, or course title to narrow the displayed materials.', target: '#resource-search', optional: true },
        { title: 'Filter by resource type', text: 'Use this filter to show only a particular type of material, such as lecture notes, handouts, or past questions.', target: '#resource-type-filter', optional: true },
        { title: 'Featured resources', text: 'Featured materials are highlighted for quick access. They are also included in the full resource list below.', target: '#featured-title', optional: true },
        { title: 'Offline Saves', text: 'Use “Save for offline” on a PDF resource card to store an app-managed copy and its library details on this device. After the app has been opened online once and the save is complete, you can reopen Clariva and read that saved PDF without an internet connection. This is separate from Downloads. Saved copies use this device’s storage and remain associated with your account. Clearing browser storage removes them.', info: true },
        { title: 'Open a resource', text: 'Open a learning resource to read it in Clariva’s in-page PDF viewer. The viewer includes page navigation and zoom controls.', target: '#all-resources .student-resource-open', optional: true },
        { title: 'Next page', text: 'Move to the next page of the open PDF. This control is unavailable when you are already on the last page.', target: '#pdf-reader-next', optional: true },
        { title: 'Previous page', text: 'Move back one page after advancing. This control is unavailable when you are already on the first page.', target: '#pdf-reader-prev', optional: true },
        { title: 'Next-page overlay arrow', text: 'The large right-side arrow is another way to advance through the PDF pages.', target: '#pdf-reader-overlay-next', optional: true },
        { title: 'Previous-page overlay arrow', text: 'The large left-side arrow moves back through the PDF pages.', target: '#pdf-reader-overlay-prev', optional: true },
        { title: 'Zoom out', text: 'Reduce the PDF page size for a more compact view.', target: '#pdf-reader-zoom-out', optional: true },
        { title: 'Zoom in', text: 'Increase the PDF page size when you need to inspect text or diagrams more closely.', target: '#pdf-reader-zoom-in', optional: true },
        { title: 'Close the viewer', text: 'Close the viewer to return to the resource list.', target: '#pdf-reader-close', optional: true },
        { title: 'Back to semesters', text: 'Return to the semester chooser for the academic level you selected.', target: '#semester-overlay-back', optional: true },
        { title: 'Back to academic levels', text: 'Return to the list of available academic levels. Choose another level whenever you need to revisit earlier course materials.', target: '#semester-overlay-back', optional: true }
      ];
    }

    if (PAGE === 'AdminDashboard.html') {
      return [
        { title: 'Welcome to the Admin Dashboard', text: 'This tour explains the administrator tools. You will see how to navigate resource management, uploads, user overview, and platform statistics. It will not submit uploads or execute account-changing actions.', info: true },
        { title: 'Your account menu', text: 'Open your account menu to review your account details and avatar settings.', target: '#clariva-profile-toggle' },
        { title: 'Choose an avatar', text: 'Select an avatar to personalise your Clariva account. The selection is saved to your profile.', target: '[data-avatar-choice]' },
        { title: 'Dashboard navigation', text: 'Open the navigation menu to move between the administrator sections and any other dashboard available to your account.', target: '#clariva-menu-toggle' },
        { title: 'Resource overview', text: 'This section summarises the resource library, including total resources, featured resources, and the existing Downloads metric. Offline Saves is tracked separately in Platform Overview.', target: '#clariva-nav-menu a[href="#resource-management"]' },
        { title: 'Total resources', text: 'The total number of resource records in the library, including unpublished materials.', target: '#resource-total' },
        { title: 'Featured resources', text: 'The number of resources currently marked as featured.', target: '#resource-featured-total' },
        { title: 'Recorded Downloads', text: 'This is the existing Downloads counter. Offline Saves are tracked separately and do not change this number.', target: '#resource-download-total' },
        { title: 'Open the upload workspace', text: 'The upload workspace is where verified administrators add learning materials and assign their academic metadata.', target: '#clariva-menu-toggle' },
        { title: 'Upload resource', text: 'Open the upload section to see the complete upload form.', target: '#clariva-nav-menu a[href="#upload-resource"]' },
        { title: 'Resource description', text: 'Describe the learning material. A clear description helps students understand what the document contains.', target: '#resource-description' },
        { title: 'Department', text: 'Enter the department associated with the resource.', target: '#resource-department' },
        { title: 'Academic level', text: 'Choose the level for which the resource is intended. Students at that level and higher can access it, subject to verification and publication rules.', target: '#resource-level' },
        { title: 'Semester', text: 'Choose First or Second Semester. This determines where the resource appears in the student library.', target: '#resource-semester' },
        { title: 'Course code', text: 'Enter the course code students use to identify this course.', target: '#resource-course-code' },
        { title: 'Course title', text: 'Enter the full course title to make the resource easier to recognise.', target: '#resource-course-title' },
        { title: 'Resource type', text: 'Choose the correct resource type to keep the library organised and make filtering useful.', target: '#resource-type' },
        { title: 'Choose document files', text: 'Open the file-source dialog to review the available ways to select documents.', target: '#resource-source-open' },
        { title: 'Device storage tab', text: 'This tab lets you choose documents stored on your phone or computer.', target: '#resource-source-tab-device' },
        { title: 'Google Drive tab', text: 'This tab switches to Google Drive. The Drive picker supports selecting multiple files before confirming.', target: '#resource-source-tab-drive' },
        { title: 'Close file selection', text: 'Close the source dialog. The tour will not open a file picker or select any files.', target: '#resource-source-close' },
        { title: 'Batch upload rule', text: 'Every file in one batch shares the same department, level, semester, course code, and resource type. Upload files separately when any of those details differ.', info: true },
        { title: 'Accepted document formats', text: 'The upload form accepts PDF, DOC, DOCX, PPT, and PPTX files, with a maximum of 50 MB per file.', info: true },
        { title: 'PDF optimisation', text: 'PDFs larger than 15 MB are optimised when possible. The existing upload flow still uses resumable uploads.', info: true },
        { title: 'Batch confirmation', text: 'After files are selected, the batch confirmation dialog lets you review or correct the shared level, semester, course code, and resource type before continuing.', info: true },
        { title: 'Selected files and upload queue', text: 'The selected-file list shows what will be uploaded. The queue and status areas show progress, failures, and network-related messages.', info: true },
        { title: 'Upload safely', text: 'Review the selected files and metadata before submitting. Upload starts the resumable transfer, so this tour will not press the upload button.', target: '#resource-upload-button', info: true },
        { title: 'Manage resources', text: 'Open this section to search, filter, preview, edit, publish or hide, feature, and remove resources. Destructive actions are explained but never executed during onboarding.', target: '#clariva-menu-toggle' },
        { title: 'Resource management tools', text: 'Open the resource list. Use its search and filters to find materials; each resource card contains its own management actions.', target: '#clariva-nav-menu a[href="#manage-resources"]' },
        { title: 'Search resources', text: 'Search by title or course to locate a particular item in the library.', target: '#resource-search' },
        { title: 'Run the search', text: 'Use this button to apply the search term to the resource list.', target: '#resource-search-button' },
        { title: 'Filter by level', text: 'Limit the resource list to a selected academic level.', target: '#filter-level' },
        { title: 'Filter by semester', text: 'Narrow the resource list to First or Second Semester.', target: '#filter-semester' },
        { title: 'Filter by resource type', text: 'Narrow the list by lecture note, handout, past questions, assignment, textbook, or another resource type.', target: '#filter-type' },
        { title: 'Resource actions', text: 'Each resource card provides preview, edit, visibility, featured status, and delete actions. Deletion and other changes are not performed during this tour.', target: '#resource-list' },
        { title: 'User overview', text: 'This section presents account totals and role and academic-level distributions. It does not expose individual student contact details.', target: '#clariva-menu-toggle' },
        { title: 'Open user overview', text: 'View the account summary and the breakdowns by role and academic level.', target: '#clariva-nav-menu a[href="#user-overview"]' },
        { title: 'Registered accounts', text: 'The total number of user accounts registered on Clariva.', target: '#admin-total-users' },
        { title: 'Student accounts', text: 'The number of accounts assigned the student role.', target: '#admin-total-students' },
        { title: 'Verified accounts', text: 'The number of accounts that have completed the verification process.', target: '#admin-verified-users' },
        { title: 'Pending verification', text: 'The number of accounts that have not yet been verified.', target: '#admin-pending-users' },
        { title: 'New accounts', text: 'The number of accounts created during the last seven days.', target: '#admin-new-users' },
        { title: 'Accounts by role', text: 'This breakdown shows how many accounts belong to each role.', target: '#admin-role-breakdown' },
        { title: 'Accounts by academic level', text: 'This breakdown shows how student accounts are distributed across academic levels.', target: '#admin-level-breakdown' },
        { title: 'Platform overview', text: 'This section presents library-wide totals, recent additions, resource-type distribution, views, Downloads, and the distinct Offline Saves metric.', target: '#clariva-menu-toggle' },
        { title: 'Open platform overview', text: 'Review aggregate platform activity and use Refresh overview to request the latest summary.', target: '#clariva-nav-menu a[href="#platform-overview"]' },
        { title: 'All resources', text: 'The total number of resources recorded in the library.', target: '#admin-total-resources' },
        { title: 'Published resources', text: 'The number of resources currently visible to eligible students.', target: '#admin-published-resources' },
        { title: 'Featured resources', text: 'The number of resources currently highlighted as featured.', target: '#admin-featured-resources' },
        { title: 'Resource views', text: 'The cumulative number of tracked resource views.', target: '#admin-total-views' },
        { title: 'Recorded Downloads', text: 'The existing Downloads total. It is independent of Offline Saves.', target: '#admin-total-downloads' },
        { title: 'Offline Saves', text: 'The number of distinct student-resource pairs saved for offline reading. Repeated saves by the same student count once.', target: '#admin-total-offline-saves' },
        { title: 'New resources', text: 'The number of resources added during the last seven days.', target: '#admin-new-resources' },
        { title: 'Resource types', text: 'See how the published library is distributed across resource types.', target: '#admin-resource-type-breakdown' },
        { title: 'Latest library update', text: 'This area shows when the most recent resource was added.', target: '#admin-latest-resource' },
        { title: 'Refresh platform overview', text: 'Use this control to refresh the latest platform totals and activity summary.', target: '#admin-overview-refresh' }
      ];
    }

    return [
      { title: 'Welcome to the Owner Dashboard', text: 'This tour explains the owner controls, activity summaries, resource administration, and the other dashboards available to your account. It will not change account roles, verification, or delete accounts.', info: true },
      { title: 'Owner overview', text: 'This is the starting summary for account activity, resource totals, user statistics, and platform-wide figures.', target: '#owner-overview' },
      { title: 'Total accounts', text: 'The number of accounts registered on Clariva.', target: '#owner-total-accounts' },
      { title: 'Student accounts', text: 'The number of accounts with the student role.', target: '#owner-student-accounts' },
      { title: 'Administrator accounts', text: 'The number of accounts with administrator privileges.', target: '#owner-admin-accounts' },
      { title: 'Owner accounts', text: 'The number of accounts with owner privileges.', target: '#owner-owner-accounts' },
      { title: 'Verified accounts', text: 'The number of accounts that have completed verification.', target: '#owner-verified-accounts' },
      { title: 'Views · last 7 days', text: 'The total tracked resource views during the last seven days.', target: '#owner-views-7d' },
      { title: 'Views · last 30 days', text: 'The total tracked resource views during the last thirty days.', target: '#owner-views-30d' },
      { title: 'Unique viewers', text: 'Distinct signed-in accounts that viewed at least one resource during the last seven days. Repeat views by one account count once.', target: '#owner-unique-viewers-7d' },
      { title: 'Offline Saves', text: 'Distinct student-resource pairs saved for offline reading. Repeated saves by the same student count once.', target: '#owner-offline-saves' },
      { title: 'Library resource total', text: 'The total number of resources in the library.', target: '#resource-total' },
      { title: 'Featured resource total', text: 'The number of resources marked as featured.', target: '#resource-featured-total' },
      { title: 'Recorded Downloads', text: 'The existing Downloads counter. It is separate from Offline Saves.', target: '#resource-download-total' },
      { title: 'Your account menu', text: 'Open your account menu to review your account details and avatar settings.', target: '#clariva-profile-toggle' },
      { title: 'Choose an avatar', text: 'Select an avatar to personalise your Clariva account. The selection is saved to your profile.', target: '[data-avatar-choice]' },
      { title: 'Dashboard navigation', text: 'Open this menu to move between owner sections and the other dashboards your account can access.', target: '#clariva-menu-toggle' },
      { title: 'User management', text: 'Open the account directory to search for users and review account roles, academic levels, verification status, join dates, and last login.', target: '#clariva-nav-menu a[href="#owner-controls"]' },
      { title: 'Find an account', text: 'Search the account directory by name, email, role, or level.', target: '#owner-account-search' },
      { title: 'Account actions', text: 'This table shows account privileges and status. Role changes, verification changes, and permanent account removal are sensitive actions; the tour explains them but will not execute them.', target: '#owner-account-table' },
      { title: 'Owner activity', text: 'Open the activity section to review aggregate resource views, unique viewers, daily trends, and Offline Saves. Individual student activity records are not exposed here.', target: '#clariva-menu-toggle' },
      { title: 'Open owner activity', text: 'Review the aggregate activity chart and refresh the summary when needed.', target: '#clariva-nav-menu a[href="#owner-activity"]' },
      { title: 'Daily resource views', text: 'The chart shows the number of resource views recorded on each of the last seven days.', target: '#owner-daily-views-chart' },
      { title: 'Refresh owner activity', text: 'Use this button to refresh the owner activity summary.', target: '#owner-refresh-activity' },
      { title: 'Upload resources', text: 'The owner dashboard also includes the resource upload workflow. The form and file-selection process are explained in the Admin Dashboard tour.', target: '#clariva-menu-toggle' },
      { title: 'Open upload workspace', text: 'Navigate to the upload section shared with administrators.', target: '#clariva-nav-menu a[href="#upload-resource"]' },
      { title: 'Manage resources', text: 'The resource manager supports searching, filtering, previewing, editing, publishing, featuring, and deleting resources. Destructive actions are not performed during this tour.', target: '#clariva-menu-toggle' },
      { title: 'Open resource manager', text: 'Open the shared resource management workspace.', target: '#clariva-nav-menu a[href="#manage-resources"]' },
      { title: 'User overview', text: 'Review account totals and role and level distributions.', target: '#clariva-menu-toggle' },
      { title: 'Open user overview', text: 'View the account overview section.', target: '#clariva-nav-menu a[href="#user-overview"]' },
      { title: 'Registered accounts', text: 'Total registered accounts across Clariva.', target: '#admin-total-users' },
      { title: 'Student accounts', text: 'Accounts assigned the student role.', target: '#admin-total-students' },
      { title: 'Verified accounts', text: 'Accounts that have completed verification.', target: '#admin-verified-users' },
      { title: 'Pending verification', text: 'Accounts that are still awaiting verification.', target: '#admin-pending-users' },
      { title: 'New accounts', text: 'Accounts created during the last seven days.', target: '#admin-new-users' },
      { title: 'Platform overview', text: 'Review platform totals, recorded Downloads, distinct Offline Saves, views, and recent library changes.', target: '#clariva-menu-toggle' },
      { title: 'Open platform overview', text: 'Open the aggregate platform statistics.', target: '#clariva-nav-menu a[href="#platform-overview"]' },
      { title: 'All resources', text: 'The total number of resources recorded in the library.', target: '#admin-total-resources' },
      { title: 'Published resources', text: 'The number of resources currently visible to eligible students.', target: '#admin-published-resources' },
      { title: 'Featured resources', text: 'The number of resources currently highlighted.', target: '#admin-featured-resources' },
      { title: 'Resource views', text: 'The cumulative number of tracked resource views.', target: '#admin-total-views' },
      { title: 'Recorded Downloads', text: 'The existing Downloads total, separate from Offline Saves.', target: '#admin-total-downloads' },
      { title: 'New resources', text: 'The number of resources added during the last seven days.', target: '#admin-new-resources' },
      { title: 'Resource types', text: 'Review how resources are distributed across the available types.', target: '#admin-resource-type-breakdown' },
      { title: 'Latest library update', text: 'See the date and time of the latest library addition.', target: '#admin-latest-resource' },
      { title: 'Refresh platform overview', text: 'Refresh the aggregate statistics when you need an updated snapshot.', target: '#admin-overview-refresh' }
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
        if (step.advanceSequenceOnClick) {
          session.index += 1;
          session.stepIndex = 0;
          writeJson(sessionStorageKey(), session);
          return;
        }
        if (step.completeSequenceOnClick) {
          try {
            localStorage.setItem(completionStorageKey(), 'complete');
            localStorage.removeItem(sessionStorageKey());
          } catch (error) {
            console.warn('Clariva tour completion could not be saved:', error);
          }
          return;
        }
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

    const startPage = session.startPage;
    try {
      localStorage.setItem(completionStorageKey(), 'complete');
      localStorage.removeItem(sessionStorageKey());
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

    if (localStorage.getItem(completionStorageKey()) === 'complete') return;

    session = readJson(sessionStorageKey());
    if (!session || session.userId !== userId || !Array.isArray(session.sequence)) {
      const startPage = PAGE;
      const orderedSequence = [PAGE, ...sequence.filter(item => item !== PAGE)];
      session = {
        userId,
        role: profileRole,
        startPage,
        sequence: orderedSequence,
        index: 0,
        stepIndex: 0
      };
      writeJson(sessionStorageKey(), session);
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
    const nextPage = session.sequence[session.index + 1];
    if (nextPage) {
      const nextLink = nextPage === 'AdminDashboard.html'
        ? '#clariva-admin-dashboard-link'
        : nextPage === 'OwnerDashboard.html'
          ? '#clariva-owner-dashboard-link'
          : '#clariva-student-dashboard-link';
      steps.push(
        { title: 'Move to your next dashboard', text: 'Open the navigation menu to continue the guided tour on the next dashboard available to your account.', target: '#clariva-menu-toggle' },
        { title: 'Open ' + pageNames[nextPage], text: 'Select this dashboard link. The tour will continue there automatically.', target: nextLink, advanceSequenceOnClick: true }
      );
    } else if (session.startPage !== PAGE) {
      const returnLink = session.startPage === 'AdminDashboard.html'
        ? '#clariva-admin-dashboard-link'
        : session.startPage === 'OwnerDashboard.html'
          ? '#clariva-owner-dashboard-link'
          : '#clariva-student-dashboard-link';
      steps.push(
        { title: 'Return to your starting dashboard', text: 'Open the navigation menu to return to the dashboard where your guided tour began.', target: '#clariva-menu-toggle' },
        { title: 'Return to ' + pageNames[session.startPage], text: 'Select this dashboard link to finish the tour and return to your starting dashboard.', target: returnLink, completeSequenceOnClick: true }
      );
    }
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
