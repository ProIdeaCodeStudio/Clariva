/* ============================================================
   CLARIVA — ADMIN DASHBOARD
   Resource upload, listing, search, filters and statistics.
   Uses the existing Supabase client from script.js.
   ============================================================ */

(() => {
  'use strict';

  const BUCKET_NAME = 'clariva-resources';
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const RESOURCE_LIMIT = 1000;
  const SUPABASE_PROJECT_ID = 'euadmjyyjtbbdyjgnoqg';
  const TUS_ENDPOINT = `https://${SUPABASE_PROJECT_ID}.storage.supabase.co/storage/v1/upload/resumable`;
  const GOOGLE_DRIVE_CONFIG = window.CLARIVA_GOOGLE_DRIVE_CONFIG || {
    apiKey: '',
    clientId: '',
    appId: ''
  };
  const GOOGLE_DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
  const GOOGLE_MIME_EXPORTS = {
    'application/vnd.google-apps.document': {
      extension: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    },
    'application/vnd.google-apps.presentation': {
      extension: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
  };
  let googleTokenClient = null;
  let googleAccessToken = null;
  let googlePickerReady = false;
  let uploadQueueBusy = false;
  let networkSlowByConnection = false;
  let networkWarningTimer = null;

  const ALLOWED_TYPES = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx']
  };

  let resources = [];
  let activePdf = null;
  let activePdfPage = 1;
  let pdfScale = 1;
  let pdfRenderTask = null;

  function getElement(id) {
    return document.getElementById(id);
  }

  function updateAdminPdfControls() {
    const pageCount = activePdf?.numPages || 0;
    const count = getElement('admin-pdf-page-count');
    const previous = getElement('admin-pdf-prev');
    const next = getElement('admin-pdf-next');
    if (count) count.textContent = pageCount ? 'Page ' + activePdfPage + ' / ' + pageCount : 'Page — / —';
    if (previous) previous.disabled = !pageCount || activePdfPage <= 1;
    if (next) next.disabled = !pageCount || activePdfPage >= pageCount;
  }

  async function renderAdminPdfPage() {
    if (!activePdf) return;
    const canvas = getElement('admin-pdf-canvas');
    const message = getElement('admin-pdf-message');
    const viewport = getElement('admin-pdf-viewport');
    const context = canvas.getContext('2d');

    if (pdfRenderTask) {
      try { pdfRenderTask.cancel(); } catch (_) {}
      pdfRenderTask = null;
    }

    try {
      const page = await activePdf.getPage(activePdfPage);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, viewport.clientWidth - 40);
      const fitScale = Math.min(1.5, availableWidth / baseViewport.width);
      const pageViewport = page.getViewport({ scale: fitScale * pdfScale });
      const outputScale = window.devicePixelRatio || 1;

      canvas.width = Math.floor(pageViewport.width * outputScale);
      canvas.height = Math.floor(pageViewport.height * outputScale);
      canvas.style.width = Math.floor(pageViewport.width) + 'px';
      canvas.style.height = Math.floor(pageViewport.height) + 'px';
      message.hidden = true;
      canvas.hidden = false;

      pdfRenderTask = page.render({
        canvasContext: context,
        viewport: pageViewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
      });
      await pdfRenderTask.promise;
      pdfRenderTask = null;
      updateAdminPdfControls();
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') {
        console.error('Admin PDF rendering error:', error);
        message.textContent = 'This page could not be displayed. Close the viewer and try again.';
        message.hidden = false;
        canvas.hidden = true;
      }
    }
  }

  async function showAdminPdfReader(signedUrl, title) {
    const reader = getElement('admin-pdf-reader');
    const message = getElement('admin-pdf-message');
    const canvas = getElement('admin-pdf-canvas');
    if (!window.pdfjsLib) {
      throw new Error('The PDF viewer could not be loaded. Refresh the page and try again.');
    }

    reader.hidden = false;
    document.body.classList.add('admin-pdf-open');
    getElement('admin-pdf-title').textContent = title || 'Resource document';
    message.textContent = 'Loading document…';
    message.hidden = false;
    canvas.hidden = true;
    activePdf = null;
    activePdfPage = 1;
    pdfScale = 1;
    updateAdminPdfControls();

    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      activePdf = await window.pdfjsLib.getDocument({
        url: signedUrl,
        disableAutoFetch: true
      }).promise;
      await renderAdminPdfPage();
    } catch (error) {
      closeAdminPdfReader();
      throw new Error('This PDF could not be displayed in Clariva. Please try again later.');
    }
  }

  function closeAdminPdfReader() {
    const reader = getElement('admin-pdf-reader');
    if (pdfRenderTask) {
      try { pdfRenderTask.cancel(); } catch (_) {}
      pdfRenderTask = null;
    }
    if (activePdf) {
      activePdf.destroy();
      activePdf = null;
    }
    if (reader) reader.hidden = true;
    document.body.classList.remove('admin-pdf-open');
  }

  function initializeAdminPdfReaderControls() {
    getElement('admin-pdf-close')?.addEventListener('click', closeAdminPdfReader);
    getElement('admin-pdf-prev')?.addEventListener('click', async () => {
      if (activePdf && activePdfPage > 1) {
        activePdfPage -= 1;
        await renderAdminPdfPage();
      }
    });
    getElement('admin-pdf-next')?.addEventListener('click', async () => {
      if (activePdf && activePdfPage < activePdf.numPages) {
        activePdfPage += 1;
        await renderAdminPdfPage();
      }
    });
    getElement('admin-pdf-zoom-out')?.addEventListener('click', async () => {
      pdfScale = Math.max(0.6, pdfScale - 0.15);
      await renderAdminPdfPage();
    });
    getElement('admin-pdf-zoom-in')?.addEventListener('click', async () => {
      pdfScale = Math.min(2, pdfScale + 0.15);
      await renderAdminPdfPage();
    });
    document.addEventListener('keydown', event => {
      if (getElement('admin-pdf-reader')?.hidden) return;
      if (event.key === 'Escape') closeAdminPdfReader();
      if (event.key === 'ArrowLeft' && activePdfPage > 1) {
        activePdfPage -= 1;
        renderAdminPdfPage();
      }
      if (event.key === 'ArrowRight' && activePdf && activePdfPage < activePdf.numPages) {
        activePdfPage += 1;
        renderAdminPdfPage();
      }
    });
    window.addEventListener('resize', () => {
      if (!getElement('admin-pdf-reader')?.hidden && activePdf) renderAdminPdfPage();
    });
  }


  function setStatus(message, type = 'info') {
    const status = getElement('resource-upload-status');
    if (!status) return;

    status.textContent = message;
    status.dataset.state = type;
  }

  function setUploading(isUploading) {
    const button = getElement('resource-upload-button');
    const picker = getElement('google-drive-picker-button');
    if (button) {
      button.disabled = isUploading;
      button.textContent = isUploading ? 'Uploading queue...' : 'Upload Resources';
    }
    if (picker) picker.disabled = isUploading;
    uploadQueueBusy = isUploading;
  }

  function setNetworkWarning(message) {
    const warning = getElement('resource-network-warning');
    if (!warning) return;
    warning.textContent = message || '';
    warning.hidden = !message;
  }

  function checkConnectionQuality() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const type = String(connection?.effectiveType || '').toLowerCase();
    const downlink = Number(connection?.downlink);
    const slowType = ['slow-2g', '2g'].includes(type);
    const lowDownlink = Number.isFinite(downlink) && downlink > 0 && downlink < 1;
    networkSlowByConnection = slowType || lowDownlink;
    if (networkSlowByConnection) {
      setNetworkWarning('Your connection appears slow. Uploads may take longer. Keep this page open while files are uploading.');
    } else if (!getElement('resource-network-warning')?.dataset.measuredSlow) {
      setNetworkWarning('');
    }
  }

  function updateMeasuredUploadSpeed(bytes, elapsedMs) {
    if (!elapsedMs || elapsedMs < 1) return;
    const bytesPerSecond = bytes / (elapsedMs / 1000);
    const warning = getElement('resource-network-warning');
    if (bytesPerSecond < 150 * 1024) {
      if (!networkWarningTimer) {
        networkWarningTimer = window.setTimeout(() => {
          if (warning) warning.dataset.measuredSlow = 'true';
          setNetworkWarning('Your upload speed is currently slow. The upload may take longer; please keep this page open.');
          networkWarningTimer = null;
        }, 4500);
      }
    } else {
      if (networkWarningTimer) {
        clearTimeout(networkWarningTimer);
        networkWarningTimer = null;
      }
      if (warning) delete warning.dataset.measuredSlow;
      if (!networkSlowByConnection) setNetworkWarning('');
    }
  }

  function getSelectedFiles() {
    return Array.from(getElement('resource-file')?.files || []);
  }

  function renderSelectedFiles() {
    const files = getSelectedFiles();
    const label = getElement('resource-file-selection');
    if (label) {
      label.textContent = files.length
        ? `${files.length} file${files.length === 1 ? '' : 's'} selected · ${formatFileSize(files.reduce((sum, file) => sum + file.size, 0))} total`
        : 'No files selected.';
    }
  }

  function addFilesToPicker(files) {
    const input = getElement('resource-file');
    if (!input || !files.length) return;
    const transfer = new DataTransfer();
    [...getSelectedFiles(), ...files].forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    renderSelectedFiles();
  }

  function renderUploadQueue(files) {
    const queue = getElement('resource-upload-queue');
    if (!queue) return;
    queue.replaceChildren();
    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'admin-upload-queue-item';
      row.id = `upload-queue-${index}`;
      const name = document.createElement('span');
      name.className = 'admin-upload-queue-name';
      name.textContent = file.name;
      const state = document.createElement('span');
      state.className = 'admin-upload-queue-state';
      state.textContent = 'Waiting';
      state.id = `upload-queue-state-${index}`;
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = 0;
      progress.id = `upload-queue-progress-${index}`;
      row.append(name, state, progress);
      queue.appendChild(row);
    });
  }

  function updateQueueItem(index, state, percent) {
    const stateElement = getElement(`upload-queue-state-${index}`);
    const progress = getElement(`upload-queue-progress-${index}`);
    if (stateElement) stateElement.textContent = state;
    if (progress && Number.isFinite(percent)) progress.value = Math.max(0, Math.min(100, percent));
  }

  function initializeGoogleDrivePicker() {
    const button = getElement('google-drive-picker-button');
    const status = getElement('google-drive-status');
    if (!button) return;

    const configured = Boolean(
      GOOGLE_DRIVE_CONFIG.apiKey &&
      GOOGLE_DRIVE_CONFIG.clientId &&
      GOOGLE_DRIVE_CONFIG.appId
    );
    if (!configured) {
      button.disabled = true;
      if (status) status.textContent = 'Google Drive picker is ready to configure. Add the Google API key, OAuth client ID and project app ID to CLARIVA_GOOGLE_DRIVE_CONFIG after configuring the Google Cloud project.';
      return;
    }

    button.disabled = false;
    if (status) status.textContent = 'Connect your Google account to select one or more supported documents.';
    button.addEventListener('click', openGoogleDrivePicker);
  }

  function loadGooglePickerApi() {
    return new Promise((resolve, reject) => {
      if (googlePickerReady && window.google?.picker) return resolve();
      if (!window.gapi) return reject(new Error('Google Picker library did not load. Refresh the page and try again.'));
      window.gapi.load('picker', {
        callback: () => {
          googlePickerReady = true;
          resolve();
        },
        onerror: () => reject(new Error('Google Picker could not be loaded.'))
      });
    });
  }

  async function openGoogleDrivePicker() {
    const status = getElement('google-drive-status');
    const button = getElement('google-drive-picker-button');
    if (!window.google?.accounts?.oauth2) {
      if (status) status.textContent = 'Google sign-in could not load. Check your connection and refresh.';
      return;
    }
    button.disabled = true;
    try {
      await loadGooglePickerApi();
      googleTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_DRIVE_CONFIG.clientId,
        scope: GOOGLE_DRIVE_SCOPES,
        callback: async response => {
          if (response.error) {
            if (status) status.textContent = 'Google Drive authorization was not completed.';
            button.disabled = false;
            return;
          }
          googleAccessToken = response.access_token;
          try {
            await showGooglePicker();
          } catch (error) {
            if (status) status.textContent = error.message || 'Unable to open Google Drive picker.';
          } finally {
            button.disabled = false;
          }
        }
      });
      googleTokenClient.requestAccessToken({ prompt: googleAccessToken ? '' : 'consent' });
    } catch (error) {
      if (status) status.textContent = error.message || 'Google Drive picker could not be started.';
      button.disabled = false;
    }
  }

  function showGooglePicker() {
    return new Promise((resolve, reject) => {
      const picker = new google.picker.PickerBuilder()
        .setAppId(GOOGLE_DRIVE_CONFIG.appId)
        .setDeveloperKey(GOOGLE_DRIVE_CONFIG.apiKey)
        .setOAuthToken(googleAccessToken)
        .setOrigin(window.location.origin)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .addView(new google.picker.DocsView()
          .setIncludeFolders(false)
          .setSelectFolderEnabled(false)
          .setMimeTypes([
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.presentation'
          ].join(',')))
        .setCallback(async data => {
          if (data.action === google.picker.Action.CANCEL) return resolve();
          if (data.action !== google.picker.Action.PICKED) return;
          try {
            const files = await Promise.all(data.docs.map(downloadGoogleDriveFile));
            addFilesToPicker(files);
            const status = getElement('google-drive-status');
            if (status) status.textContent = `${files.length} file${files.length === 1 ? '' : 's'} added from Google Drive. Complete the resource details and upload the queue.`;
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  async function downloadGoogleDriveFile(documentInfo) {
    const nativeExport = GOOGLE_MIME_EXPORTS[documentInfo.mimeType];
    const extension = nativeExport?.extension ||
      String(documentInfo.name || '').split('.').pop().toLowerCase();
    const allowed = ['pdf', 'doc', 'docx', 'ppt', 'pptx'];
    if (!allowed.includes(extension)) {
      throw new Error(`“${documentInfo.name}” is not a supported document type.`);
    }

    const url = nativeExport
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentInfo.id)}/export?mimeType=${encodeURIComponent(nativeExport.mimeType)}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentInfo.id)}?alt=media`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Could not import “${documentInfo.name}” from Google Drive (${response.status}).`);
    }

    const blob = await response.blob();
    const mime = nativeExport?.mimeType || documentInfo.mimeType || blob.type || 'application/octet-stream';
    const name = nativeExport
      ? `${documentInfo.name.replace(/\.[^.]+$/, '')}.${extension}`
      : documentInfo.name;
    return new File([blob], name, { type: mime, lastModified: Date.now() });
  }

  function setResourceActionStatus(message, type = 'info') {
    const status = getElement('resource-action-status');
    if (!status) return;

    status.textContent = message;
    status.dataset.state = type;
  }

  function validateFile(file) {
    if (!file) {
      throw new Error('Please select a document to upload.');
    }

    if (file.size === 0) {
      throw new Error('The selected file is empty.');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error('The file exceeds the 50 MB upload limit.');
    }

    const extension = file.name.split('.').pop().toLowerCase();
    const allowedExtensions = ALLOWED_TYPES[file.type];

    if (!allowedExtensions || !allowedExtensions.includes(extension)) {
      throw new Error('Unsupported file. Upload a PDF, DOC, DOCX, PPT or PPTX file.');
    }
  }

  function sanitizeFileName(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();

    const baseName = fileName
      .replace(/\.[^/.]+$/, '')
      .normalize('NFKD')
      .replace(/[^\w-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);

    return `${baseName || 'resource'}.${extension}`;
  }

  async function getAuthorizedUploader() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
      throw new Error('Supabase is not ready. Refresh the page and try again.');
    }

    const {
      data: { user },
      error: userError
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      throw new Error('Your session has expired. Please sign in again.');
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from('students')
      .select('Verified, Role')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('Unable to verify your administrator account.');
    }

    const role = String(profile.Role || '').toLowerCase();

    if (profile.Verified !== true || !['admin', 'owner'].includes(role)) {
      throw new Error('You are not authorized to upload resources.');
    }

    return user;
  }

  /* ============================================================
     RESOURCE DATA
     ============================================================ */

  async function loadResources() {
    const list = getElement('resource-list');

    if (!list) return;

    list.textContent = 'Loading resources...';

    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) {
        throw new Error('Supabase is not ready. Refresh the page.');
      }

      const { data, error } = await supabaseClient
        .from('Resources')
        .select(`
          id,
          title,
          description,
          department,
          level,
          semester,
          course_code,
          course_title,
          resource_type,
          file_url,
          file_name,
          file_size,
          visibility,
          featured,
          download_count,
          view_count,
          created_at
        `)
        .order('created_at', { ascending: false })
        .limit(RESOURCE_LIMIT);

      if (error) {
        throw error;
      }

      resources = data || [];

      updateStatistics();
      renderResources();

    } catch (error) {
      console.error('Clariva resource loading error:', error);

      list.textContent =
        `Unable to load resources: ${error.message || 'Unknown error'}`;
    }
  }

  /* ============================================================
     ADMIN USER AND PLATFORM OVERVIEW
     Reads one aggregate-only view. No student contact details
     or individual profile rows are returned to the browser.
     ============================================================ */

  function setOverviewStatus(id, message, type = 'info') {
    const element = getElement(id);
    if (!element) return;
    element.textContent = message;
    element.dataset.state = type;
  }

  function setOverviewValue(id, value) {
    const element = getElement(id);
    if (element) element.textContent = Number(value || 0).toLocaleString();
  }

  function renderOverviewBreakdown(id, values, emptyLabel) {
    const container = getElement(id);
    if (!container) return;
    container.replaceChildren();

    const entries = Object.entries(values || {})
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

    if (!entries.length) {
      const empty = createTextElement('p', 'admin-muted', emptyLabel);
      container.appendChild(empty);
      return;
    }

    entries.forEach(([label, count]) => {
      const row = document.createElement('div');
      row.className = 'admin-breakdown-row';
      const name = createTextElement('span', 'admin-breakdown-label', label);
      const value = createTextElement('span', 'admin-breakdown-value', Number(count || 0).toLocaleString());
      row.append(name, value);
      container.appendChild(row);
    });
  }

  function formatOverviewDate(value) {
    if (!value) return 'No resources have been added yet.';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Latest update date unavailable.';
    return 'Most recent resource added ' + date.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  async function loadAdminOverview() {
    const userStatus = getElement('admin-user-overview-status');
    const platformStatus = getElement('admin-platform-overview-status');
    if (!userStatus || !platformStatus) return;

    setOverviewStatus('admin-user-overview-status', 'Loading account statistics...');
    setOverviewStatus('admin-platform-overview-status', 'Loading platform statistics...');

    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) {
        throw new Error('Supabase is not ready. Refresh the page and try again.');
      }

      const { data, error } = await supabaseClient
        .rpc('get_admin_dashboard_stats');

      if (error) throw error;
      if (!data) {
        throw new Error('The account could not access administrator statistics. Check that your verified admin or owner role is active.');
      }

      setOverviewValue('admin-total-users', data.total_users);
      setOverviewValue('admin-total-students', data.total_students);
      setOverviewValue('admin-verified-users', data.verified_users);
      setOverviewValue('admin-pending-users', data.pending_verification);
      setOverviewValue('admin-new-users', data.new_users_7d);
      renderOverviewBreakdown('admin-role-breakdown', {
        Students: data.total_students,
        Administrators: data.admin_users,
        Owners: data.owner_users
      }, 'No account roles to display.');
      renderOverviewBreakdown('admin-level-breakdown', data.users_by_level, 'No academic levels assigned.');

      setOverviewValue('admin-total-resources', data.total_resources);
      setOverviewValue('admin-published-resources', data.published_resources);
      setOverviewValue('admin-featured-resources', data.featured_resources);
      setOverviewValue('admin-total-downloads', data.total_downloads);
      setOverviewValue('admin-total-views', data.total_views);
      setOverviewValue('admin-new-resources', data.resources_added_7d);
      renderOverviewBreakdown('admin-resource-type-breakdown', data.resources_by_type, 'No resource types to display.');

      const latest = getElement('admin-latest-resource');
      if (latest) latest.textContent = formatOverviewDate(data.latest_resource_at);

      setOverviewStatus('admin-user-overview-status', 'Account statistics updated.', 'success');
      setOverviewStatus('admin-platform-overview-status', 'Platform statistics updated.', 'success');
    } catch (error) {
      console.error('Clariva admin overview error:', error);
      const message = error?.message || 'Unknown error';
      setOverviewStatus('admin-user-overview-status', 'Unable to load account statistics: ' + message, 'error');
      setOverviewStatus('admin-platform-overview-status', 'Unable to load platform statistics: ' + message, 'error');
    }
  }

  function updateStatistics() {
    const total = resources.length;

    const featured = resources.filter(
      resource => resource.featured === true
    ).length;

    const downloads = resources.reduce(
      (sum, resource) => sum + Number(resource.download_count || 0),
      0
    );

    if (getElement('resource-total')) {
      getElement('resource-total').textContent = total.toLocaleString();
    }

    if (getElement('resource-featured-total')) {
      getElement('resource-featured-total').textContent =
        featured.toLocaleString();
    }

    if (getElement('resource-download-total')) {
      getElement('resource-download-total').textContent =
        downloads.toLocaleString();
    }
  }
  /* ============================================================
  SEARCH AND FILTERS
  ============================================================ */

  let appliedSearch = '';

  function getFilteredResources() {
    const search = appliedSearch.trim().toLowerCase();

    const level = getElement('filter-level')?.value || '';
    const semester = getElement('filter-semester')?.value || '';
    const type = getElement('filter-type')?.value || '';

    return resources.filter(resource => {
      // Search only text-based resource information.
      // Resource type, level and semester are excluded.
      const searchableText = [
        resource.title,
        resource.description,
        resource.course_code,
        resource.course_title,
        resource.department,
        resource.file_name
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      // The complete search phrase must appear in the same order.
      const matchesSearch =
        !search || searchableText.includes(search);

      // These selections only narrow the search results.
      const matchesLevel =
        !level || String(resource.level) === level;

      const matchesSemester =
        !semester || String(resource.semester) === semester;

      const matchesType =
        !type || resource.resource_type === type;

      return (
        matchesSearch &&
        matchesLevel &&
        matchesSemester &&
        matchesType
      );
    });
  }

  /* ============================================================
     RESOURCE DISPLAY
     ============================================================ */

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
      element.className = className;
    }

    element.textContent = text || '';

    return element;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes || 0);

    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDate(dateValue) {
    if (!dateValue) return 'Date unavailable';

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return 'Date unavailable';
    }

    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  async function updateResourceRecord(resource, updates, button, busyLabel) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel || 'Saving...';
    setResourceActionStatus('Saving resource changes...', 'info');

    try {
      await getAuthorizedUploader();

      const { data, error } = await supabaseClient
        .from('Resources')
        .update(updates)
        .eq('id', resource.id)
        .select('*')
        .single();

      if (error) throw error;
      if (!data) throw new Error('The resource update was not confirmed.');

      resources = resources.map(item =>
        item.id === resource.id ? { ...item, ...data } : item
      );

      updateStatistics();
      renderResources();

      let successMessage = 'Resource details saved successfully.';
      if (Object.prototype.hasOwnProperty.call(updates, 'visibility')) {
        successMessage = updates.visibility
          ? 'Resource published successfully.'
          : 'Resource hidden from students successfully.';
      } else if (Object.prototype.hasOwnProperty.call(updates, 'featured')) {
        successMessage = updates.featured
          ? 'Resource featured successfully.'
          : 'Resource removed from featured resources.';
      }
      setResourceActionStatus(successMessage, 'success');
    } catch (error) {
      console.error('Clariva resource update error:', error);
      setResourceActionStatus(
        'Unable to update this resource: ' + (error.message || 'Unknown error'),
        'error'
      );
      alert('Unable to update this resource: ' + (error.message || 'Unknown error'));
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function deleteResourceRecord(resource, button) {
    const resourceTitle = resource.title || 'this resource';
    const confirmed = window.confirm(
      'Permanently delete "' + resourceTitle + '" from Clariva? This cannot be undone.'
    );
    if (!confirmed) return;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Deleting...';
    setResourceActionStatus('Removing resource from the library...', 'info');

    try {
      await getAuthorizedUploader();

      const { data, error } = await supabaseClient
        .from('Resources')
        .delete()
        .eq('id', resource.id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('The resource record was not found or could not be deleted.');

      resources = resources.filter(item => item.id !== resource.id);
      updateStatistics();
      renderResources();

      if (resource.file_url) {
        const { error: storageError } = await supabaseClient
          .storage
          .from(BUCKET_NAME)
          .remove([resource.file_url]);

        if (storageError) {
          console.error('Clariva resource storage cleanup error:', storageError);
          setResourceActionStatus(
            'The resource was removed from the library, but its private storage file could not be deleted. It is no longer listed or available to students; storage cleanup remains outstanding.',
            'error'
          );
          return;
        }
      }

      setResourceActionStatus('Resource and stored file deleted successfully.', 'success');
    } catch (error) {
      console.error('Clariva resource deletion error:', error);
      setResourceActionStatus(
        'Unable to delete this resource: ' + (error.message || 'Unknown error'),
        'error'
      );
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function appendEditorField(form, resource, labelText, name, value, type, options) {
    const wrapper = document.createElement('div');
    wrapper.className = 'admin-field';
    if (name === 'description' || name === 'course_title') {
      wrapper.classList.add('admin-field-full');
    }

    const label = document.createElement('label');
    const inputId = 'resource-edit-' + resource.id + '-' + name;
    label.htmlFor = inputId;
    label.textContent = labelText;

    let control;
    if (type === 'textarea') {
      control = document.createElement('textarea');
      control.maxLength = name === 'description' ? 1000 : 160;
      control.value = value || '';
    } else if (type === 'select') {
      control = document.createElement('select');
      (options || []).forEach(option => {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        control.appendChild(item);
      });
      control.value = String(value ?? '');
    } else {
      control = document.createElement('input');
      control.type = 'text';
      control.maxLength = name === 'course_code' ? 30 : 160;
      control.value = value || '';
    }

    control.id = inputId;
    control.name = name;
    if (['title', 'level', 'semester', 'resource_type'].includes(name)) {
      control.required = true;
    }

    wrapper.append(label, control);
    form.appendChild(wrapper);
    return control;
  }

  function createResourceEditor(resource, onClose) {
    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.hidden = true;
    panel.style.marginTop = '16px';
    panel.style.padding = '20px';

    const heading = createTextElement('h4', '', 'Edit resource details');
    heading.style.marginBottom = '12px';
    panel.appendChild(heading);

    const form = document.createElement('form');
    form.className = 'admin-form-grid';

    appendEditorField(form, resource, 'Resource title', 'title', resource.title, 'text');
    appendEditorField(form, resource, 'Description', 'description', resource.description, 'textarea');
    appendEditorField(form, resource, 'Department', 'department', resource.department, 'text');
    appendEditorField(form, resource, 'Level', 'level', resource.level, 'select', [
      { value: '100', label: '100 Level' },
      { value: '200', label: '200 Level' },
      { value: '300', label: '300 Level' },
      { value: '400', label: '400 Level' },
      { value: '500', label: '500 Level' }
    ]);
    appendEditorField(form, resource, 'Semester', 'semester', resource.semester, 'select', [
      { value: '1', label: 'First semester' },
      { value: '2', label: 'Second semester' }
    ]);
    appendEditorField(form, resource, 'Course code', 'course_code', resource.course_code, 'text');
    appendEditorField(form, resource, 'Course title', 'course_title', resource.course_title, 'text');
    appendEditorField(form, resource, 'Resource type', 'resource_type', resource.resource_type, 'select', [
      { value: 'Lecture Note', label: 'Lecture note' },
      { value: 'Handout', label: 'Handout' },
      { value: 'Past Questions', label: 'Past questions' },
      { value: 'Assignment', label: 'Assignment' },
      { value: 'Textbook', label: 'Textbook' },
      { value: 'Other', label: 'Other' }
    ]);

    const actions = document.createElement('div');
    actions.className = 'admin-actions admin-field-full';

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'admin-button';
    saveButton.textContent = 'Save Changes';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'admin-button admin-button-secondary';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      panel.hidden = true;
      if (typeof onClose === 'function') onClose();
    });

    actions.append(saveButton, cancelButton);
    form.appendChild(actions);

    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const values = new FormData(form);
      const updates = {
        title: String(values.get('title') || '').trim(),
        description: String(values.get('description') || '').trim() || null,
        department: String(values.get('department') || '').trim() || null,
        level: Number(values.get('level')),
        semester: Number(values.get('semester')),
        course_code: String(values.get('course_code') || '').trim() || null,
        course_title: String(values.get('course_title') || '').trim() || null,
        resource_type: String(values.get('resource_type') || '')
      };

      if (!updates.title || !updates.level || !updates.semester || !updates.resource_type) {
        alert('Please complete all required resource details.');
        return;
      }

      updateResourceRecord(resource, updates, saveButton, 'Saving...');
    });

    panel.appendChild(form);
    return panel;
  }

  function renderResources() {
    const list = getElement('resource-list');
    if (!list) return;

    const filteredResources = getFilteredResources();
    list.replaceChildren();

    if (filteredResources.length === 0) {
      const message = createTextElement(
        'strong',
        '',
        resources.length === 0
          ? 'No resources have been uploaded yet.'
          : 'No matching resources found.'
      );

      list.className = 'admin-placeholder';
      list.appendChild(message);

      if (resources.length > 0) {
        list.appendChild(document.createTextNode(
          'Try changing your search or filter selections.'
        ));
      }
      return;
    }

    list.className = 'admin-resource-list';
    list.appendChild(createTextElement(
      'p',
      'admin-muted',
      'Showing ' + filteredResources.length + ' of ' + resources.length + ' resources'
    ));

    filteredResources.forEach(resource => {
      const card = document.createElement('article');
      card.className = 'admin-panel';
      card.style.marginBottom = '16px';
      card.style.padding = '20px';

      const title = createTextElement('h3', '', resource.title || 'Untitled resource');
      title.style.color = 'var(--deep-ink)';
      title.style.marginBottom = '8px';
      card.appendChild(title);

      const course = [resource.course_code, resource.course_title]
        .filter(Boolean).join(' — ');
      if (course) card.appendChild(createTextElement('p', 'admin-muted', course));

      if (resource.description) {
        card.appendChild(createTextElement('p', 'admin-muted', resource.description));
      }

      const details = [
        resource.department,
        resource.level ? resource.level + ' Level' : null,
        resource.semester ? 'Semester ' + resource.semester : null,
        resource.resource_type,
        resource.file_name,
        formatFileSize(resource.file_size),
        'Views: ' + Number(resource.view_count || 0),
        'Downloads: ' + Number(resource.download_count || 0),
        'Uploaded: ' + formatDate(resource.created_at)
      ].filter(Boolean);

      card.appendChild(createTextElement('p', 'admin-muted', details.join(' • ')));

      const isVisible = resource.visibility !== false;
      const statusDetails = [isVisible ? 'Visible to students' : 'Hidden from students'];
      if (resource.featured) statusDetails.push('Featured');
      card.appendChild(createTextElement('p', 'admin-muted', statusDetails.join(' • ')));

      const actions = document.createElement('div');
      actions.className = 'admin-actions';

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'admin-button';
      openButton.textContent = 'Open File';
      openButton.addEventListener('click', () => openResourceFile(resource, openButton));

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'admin-button admin-button-secondary';
      editButton.textContent = 'Edit Details';

      const editor = createResourceEditor(resource, () => {
        editButton.textContent = 'Edit Details';
      });
      editButton.addEventListener('click', () => {
        editor.hidden = !editor.hidden;
        editButton.textContent = editor.hidden ? 'Edit Details' : 'Close Editor';
      });

      const visibilityButton = document.createElement('button');
      visibilityButton.type = 'button';
      visibilityButton.className = 'admin-button admin-button-secondary';
      visibilityButton.textContent = isVisible ? 'Hide from Students' : 'Publish to Students';
      visibilityButton.addEventListener('click', () => {
        const nextVisibility = !isVisible;
        const confirmation = nextVisibility
          ? 'Publish this resource so eligible students can access it?'
          : 'Hide this resource from students?';
        if (!window.confirm(confirmation)) return;
        updateResourceRecord(
          resource,
          { visibility: nextVisibility },
          visibilityButton,
          nextVisibility ? 'Publishing...' : 'Hiding...'
        );
      });

      const featuredButton = document.createElement('button');
      featuredButton.type = 'button';
      featuredButton.className = 'admin-button admin-button-secondary';
      featuredButton.textContent = resource.featured ? 'Unfeature' : 'Feature Resource';
      featuredButton.addEventListener('click', () => {
        const nextFeatured = !resource.featured;
        updateResourceRecord(
          resource,
          { featured: nextFeatured },
          featuredButton,
          nextFeatured ? 'Featuring...' : 'Updating...'
        );
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'admin-button admin-button-danger';
      deleteButton.textContent = 'Delete Resource';
      deleteButton.setAttribute('aria-label', 'Delete ' + (resource.title || 'resource'));
      deleteButton.addEventListener('click', () => {
        deleteResourceRecord(resource, deleteButton);
      });

      actions.append(openButton, editButton, visibilityButton, featuredButton, deleteButton);
      card.append(actions, editor);
      list.appendChild(card);
    });
  }

  async function openResourceFile(resource, button) {
    if (!resource.file_url) {
      alert('No storage path is available for this resource.');
      return;
    }

    const originalText = button.textContent;
    const fileName = resource.file_name || '';
    const isPdf = fileName.toLowerCase().endsWith('.pdf') ||
      String(resource.resource_type || '').toLowerCase().includes('pdf');

    button.disabled = true;
    button.textContent = isPdf ? 'Preparing viewer...' : 'Preparing file...';

    try {
      const { data, error } = await supabaseClient
        .storage
        .from(BUCKET_NAME)
        .createSignedUrl(resource.file_url, 300);

      if (error) throw error;
      if (!data?.signedUrl) throw new Error('Supabase did not return a file link.');

      if (isPdf) {
        await showAdminPdfReader(data.signedUrl, resource.title || fileName);
      } else {
        const openedWindow = window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
        if (!openedWindow) window.location.href = data.signedUrl;
      }
    } catch (error) {
      console.error('Clariva file retrieval error:', error);
      alert(`Unable to open this resource: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  /* ============================================================
     RESOURCE UPLOAD
     ============================================================ */

  async function uploadOneFile(file, index, metadata, user, session) {
    validateFile(file);
    const safeName = sanitizeFileName(file.name);
    const uniqueName = `${crypto.randomUUID()}-${safeName}`;
    const storagePath = `resources/${metadata.level}/${metadata.semester}/${uniqueName}`;
    updateQueueItem(index, 'Uploading…', 0);

    let lastProgressAt = performance.now();
    let lastBytesUploaded = 0;
    await new Promise((resolve, reject) => {
      if (!window.tus?.Upload) {
        reject(new Error('The resumable upload library did not load. Refresh the page and try again.'));
        return;
      }

      const upload = new window.tus.Upload(file, {
        endpoint: TUS_ENDPOINT,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_KEY
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
        metadata: {
          bucketName: BUCKET_NAME,
          objectName: storagePath,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600'
        },
        onError: error => reject(error),
        onProgress: (bytesUploaded, bytesTotal) => {
          const now = performance.now();
          const deltaBytes = Math.max(0, bytesUploaded - lastBytesUploaded);
          updateMeasuredUploadSpeed(deltaBytes, now - lastProgressAt);
          lastProgressAt = now;
          lastBytesUploaded = bytesUploaded;
          updateQueueItem(index, `Uploading ${Math.round(bytesUploaded / bytesTotal * 100)}%`, bytesUploaded / bytesTotal * 100);
        },
        onSuccess: resolve
      });

      upload.findPreviousUploads().then(previousUploads => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      }).catch(reject);
    });

    updateQueueItem(index, 'Saving details…', 100);
    const title = metadata.filesCount > 1
      ? `${metadata.title} — ${file.name.replace(/\.[^.]+$/, '')}`
      : metadata.title;

    const { error: insertError } = await supabaseClient
      .from('Resources')
      .insert({
        title,
        description: metadata.description || null,
        department: metadata.department || null,
        level: metadata.level,
        semester: metadata.semester,
        course_code: metadata.courseCode || null,
        course_title: metadata.courseTitle || null,
        resource_type: metadata.resourceType,
        file_url: storagePath,
        file_name: file.name,
        file_size: file.size,
        uploaded_by: user.id,
        visibility: true,
        featured: false
      });

    if (insertError) {
      const { error: cleanupError } = await supabaseClient.storage.from(BUCKET_NAME).remove([storagePath]);
      if (cleanupError) console.error('Failed to remove unregistered upload:', cleanupError);
      throw new Error(`Could not save details for ${file.name}: ${insertError.message}`);
    }

    updateQueueItem(index, 'Uploaded', 100);
  }

  async function uploadResource(event) {
    event.preventDefault();

    const form = getElement('resource-upload-form');
    if (!form || !form.reportValidity()) return;

    const files = getSelectedFiles();
    if (!files.length) {
      setStatus('Select at least one document to upload.', 'error');
      return;
    }

    const metadata = {
      title: getElement('resource-title').value.trim(),
      description: getElement('resource-description').value.trim(),
      department: getElement('resource-department').value.trim(),
      level: Number(getElement('resource-level').value),
      semester: Number(getElement('resource-semester').value),
      courseCode: getElement('resource-course-code').value.trim(),
      courseTitle: getElement('resource-course-title').value.trim(),
      resourceType: getElement('resource-type').value,
      filesCount: files.length
    };

    if (!metadata.title || !metadata.level || !metadata.semester || !metadata.resourceType) {
      setStatus('Please complete all required resource details.', 'error');
      return;
    }

    try {
      files.forEach(validateFile);
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    renderUploadQueue(files);
    setUploading(true);
    setStatus(`Preparing ${files.length} document${files.length === 1 ? '' : 's'} (${formatFileSize(totalSize)} total)…`);

    try {
      const user = await getAuthorizedUploader();
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error('Your upload session has expired. Please sign in again.');
      }

      let completed = 0;
      const failures = [];
      const failedFiles = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        try {
          await uploadOneFile(file, index, metadata, user, sessionData.session);
          completed += 1;
        } catch (error) {
          console.error(`Upload failed for ${file.name}:`, error);
          updateQueueItem(index, 'Failed', 0);
          failures.push(`${file.name}: ${error.message || 'Upload failed'}`);
          failedFiles.push(file);
        }
      }

      if (completed) {
        await loadResources();
        document.dispatchEvent(new CustomEvent('clariva:resource-uploaded'));
      }

      if (failures.length) {
        const retrySelection = new DataTransfer();
        failedFiles.forEach(file => retrySelection.items.add(file));
        const fileInput = getElement('resource-file');
        if (fileInput) fileInput.files = retrySelection.files;
        renderSelectedFiles();
        setStatus(`${completed} of ${files.length} files uploaded. Only failed files remain selected for retry: ${failures.join(' | ')}`, 'error');
      } else {
        setStatus(`All ${completed} resource${completed === 1 ? '' : 's'} uploaded successfully.`, 'success');
        form.reset();
        renderSelectedFiles();
      }
    } catch (error) {
      console.error('Clariva resource upload queue error:', error);
      setStatus(error.message || 'An unexpected upload error occurred.', 'error');
    } finally {
      setUploading(false);
      checkConnectionQuality();
    }
  }
  /* ============================================================
     DASHBOARD INITIALIZATION
     ============================================================ */

  function initializeAdminDashboard() {
    initializeAdminPdfReaderControls();
    const form = getElement('resource-upload-form');

    if (form && form.dataset.uploadHandlerAttached !== 'true') {
      form.addEventListener('submit', uploadResource);
      form.dataset.uploadHandlerAttached = 'true';
    }
    const fileInput = getElement('resource-file');
    if (fileInput && fileInput.dataset.selectionHandlerAttached !== 'true') {
      fileInput.addEventListener('change', renderSelectedFiles);
      fileInput.dataset.selectionHandlerAttached = 'true';
    }
    initializeGoogleDrivePicker();
    checkConnectionQuality();
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    connection?.addEventListener?.('change', checkConnectionQuality);

    const search = getElement('resource-search');
    const searchButton = getElement('resource-search-button');

    function applySearch() {
      appliedSearch = search?.value || '';
      renderResources();
    }

    if (searchButton) {
      searchButton.addEventListener('click', applySearch);
    }

    if (search) {
      search.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applySearch();
        }
      });
    }

    ['filter-level', 'filter-semester', 'filter-type'].forEach(id => {
      const filter = getElement(id);

      if (filter) {
        filter.addEventListener('change', renderResources);
      }
    });

    loadResources();
    loadAdminOverview();

    const overviewRefresh = getElement('admin-overview-refresh');
    if (overviewRefresh && overviewRefresh.dataset.handlerAttached !== 'true') {
      overviewRefresh.addEventListener('click', loadAdminOverview);
      overviewRefresh.dataset.handlerAttached = 'true';
    }
  }

  window.addEventListener(
    'load',
    initializeAdminDashboard
  );
})();
