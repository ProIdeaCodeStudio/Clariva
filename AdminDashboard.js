/* ============================================================
   CLARIVA — ADMIN DASHBOARD
   Resource upload, listing, search, filters and statistics.
   Uses the existing Supabase client from script.js.
   ============================================================ */

(() => {
  'use strict';

  const BUCKET_NAME = 'clariva-resources';
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const COMPRESSION_THRESHOLD = 15 * 1024 * 1024;
  const PDF_COMPRESSION_QUALITY = 80;
  const PDF_COMPRESSOR_URL = 'https://esm.sh/compress-pdf-lib@1.0.5?bundle';
  const RESOURCE_LIMIT = 1000;
  const SUPABASE_PROJECT_ID = 'euadmjyyjtbbdyjgnoqg';
  const TUS_ENDPOINT = `https://${SUPABASE_PROJECT_ID}.storage.supabase.co/storage/v1/upload/resumable`;
  const GOOGLE_DRIVE_CONFIG = window.CLARIVA_GOOGLE_DRIVE_CONFIG || {
    apiKey: '',
    clientId: '',
    appId: ''
  };
  const GOOGLE_DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
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
  let excludedUploadFiles = new Set();
  let networkSlowByConnection = false;
  let networkWarningTimer = null;
  let pdfCompressorPromise = null;

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
    const overlayPrevious = getElement('admin-pdf-overlay-prev');
    const overlayNext = getElement('admin-pdf-overlay-next');
    if (overlayPrevious) overlayPrevious.disabled = !pageCount || activePdfPage <= 1;
    if (overlayNext) overlayNext.disabled = !pageCount || activePdfPage >= pageCount;
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
    const goToPreviousAdminPage = async () => {
      if (activePdf && activePdfPage > 1) { activePdfPage -= 1; await renderAdminPdfPage(); }
    };
    const goToNextAdminPage = async () => {
      if (activePdf && activePdfPage < activePdf.numPages) { activePdfPage += 1; await renderAdminPdfPage(); }
    };
    getElement('admin-pdf-overlay-prev')?.addEventListener('click', goToPreviousAdminPage);
    getElement('admin-pdf-overlay-next')?.addEventListener('click', goToNextAdminPage);
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
    const sourceOpen = getElement('resource-source-open');
    const devicePicker = getElement('device-file-picker-button');
    if (button) {
      button.disabled = isUploading;
      button.textContent = isUploading ? 'Uploading queue...' : 'Upload Resources';
    }
    if (picker) picker.disabled = isUploading;
    if (sourceOpen) sourceOpen.disabled = isUploading;
    if (devicePicker) devicePicker.disabled = isUploading;
    const form = getElement('resource-upload-form');
    if (form) {
      form.querySelectorAll('input, select, textarea, button[type="reset"], .admin-selected-file-remove').forEach(control => {
        control.disabled = isUploading;
      });
    }
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
      setNetworkWarning('Low network speed. Refresh your network.');
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
          setNetworkWarning('Low network speed. Refresh your network.');
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

  function getFilesForUpload() {
    return getSelectedFiles().filter(file => !excludedUploadFiles.has(file));
  }

  function renderSelectedFiles() {
    const files = getSelectedFiles();
    const currentFiles = new Set(files);
    excludedUploadFiles.forEach(file => {
      if (!currentFiles.has(file)) excludedUploadFiles.delete(file);
    });
    const uploadFiles = getFilesForUpload();
    const label = getElement('resource-file-selection');
    const list = getElement('resource-selected-file-list');
    if (label) {
      label.textContent = files.length
        ? uploadFiles.length + ' of ' + files.length + ' file' + (files.length === 1 ? '' : 's') +
          ' selected for upload · ' + formatFileSize(uploadFiles.reduce((sum, file) => sum + file.size, 0)) + ' selected'
        : 'No files selected.';
    }
    if (!list) return;
    list.replaceChildren();
    files.forEach((file, index) => {
      const item = document.createElement('li');
      item.className = 'admin-selected-file-item';
      const details = document.createElement('span');
      details.className = 'admin-selected-file-details';
      const name = document.createElement('strong');
      name.textContent = file.name;
      const size = document.createElement('small');
      size.textContent = formatFileSize(file.size);
      details.append(name, size);

      const toggle = document.createElement('label');
      toggle.className = 'admin-selected-file-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !excludedUploadFiles.has(file);
      checkbox.setAttribute('aria-label', 'Include ' + file.name + ' in upload');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) excludedUploadFiles.delete(file);
        else excludedUploadFiles.add(file);
        renderSelectedFiles();
      });
      const toggleText = document.createElement('span');
      toggleText.textContent = 'Include';
      toggle.append(checkbox, toggleText);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'admin-button admin-button-secondary admin-selected-file-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + file.name);
      remove.addEventListener('click', () => {
        const transfer = new DataTransfer();
        getSelectedFiles().forEach((selected, selectedIndex) => {
          if (selectedIndex !== index) transfer.items.add(selected);
        });
        const input = getElement('resource-file');
        if (input) input.files = transfer.files;
        excludedUploadFiles.delete(file);
        renderSelectedFiles();
      });
      item.append(details, toggle, remove);
      list.appendChild(item);
    });
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

  function initializeResourceSourcePicker() {
    const dialog = getElement('resource-source-dialog');
    const openButton = getElement('resource-source-open');
    const closeButton = getElement('resource-source-close');
    const deviceButton = getElement('device-file-picker-button');
    const fileInput = getElement('resource-file');
    const tabs = Array.from(document.querySelectorAll('[data-resource-source-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-resource-source-panel]'));

    if (!dialog || !openButton || !fileInput) return;

    openButton.addEventListener('click', () => {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });

    closeButton?.addEventListener('click', () => dialog.close());

    function activateTab(name) {
      tabs.forEach(tab => {
        const active = tab.dataset.resourceSourceTab === name;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach(panel => {
        panel.hidden = panel.dataset.resourceSourcePanel !== name;
      });
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab.dataset.resourceSourceTab));
    });

    deviceButton?.addEventListener('click', () => {
      dialog.close();
      fileInput.click();
    });

    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });

    activateTab('device');
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
    const sourceDialog = getElement('resource-source-dialog');
    if (sourceDialog?.open) sourceDialog.close();
    const status = getElement('google-drive-status');
    const button = getElement('google-drive-picker-button');
    if (!window.google?.accounts?.oauth2) {
      if (status) status.textContent = 'Google sign-in unavailable. Refresh and try again.';
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
            if (status) status.textContent = 'Google Drive access was not authorised.';
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
          .setMode(google.picker.DocsViewMode.LIST)
          .setIncludeFolders(true)
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
            if (status) status.textContent = `${files.length} file${files.length === 1 ? '' : 's'} selected from Drive.`;
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

  function showResourceUpdateSuccess(message) {
    const dialog = getElement('resource-update-success-dialog');
    const messageElement = getElement('resource-update-success-message');
    const okButton = getElement('resource-update-success-ok');
    if (!dialog || !okButton) {
      alert(message);
      return;
    }

    if (messageElement) messageElement.textContent = message;
    okButton.onclick = () => dialog.close();
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      alert(message);
    }
  }

  function setResourceActionStatus(message, type = 'info') {
    const status = getElement('resource-action-status');
    if (!status) return;

    status.textContent = message;
    status.dataset.state = type;
  }

  function validateFileType(file) {
    if (!file) {
      throw new Error('Please select a document to upload.');
    }

    if (file.size === 0) {
      throw new Error('The selected file is empty.');
    }

    const extension = file.name.split('.').pop().toLowerCase();
    const allowedExtensions = ALLOWED_TYPES[file.type];

    if (!allowedExtensions || !allowedExtensions.includes(extension)) {
      throw new Error('Unsupported file. Upload a PDF, DOC, DOCX, PPT or PPTX file.');
    }
  }

  function validateFile(file) {
    validateFileType(file);
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('The file exceeds the 50 MB upload limit after compression.');
    }
  }

  async function loadPdfCompressor() {
    if (!pdfCompressorPromise) {
      pdfCompressorPromise = import(PDF_COMPRESSOR_URL).then(module => {
        if (typeof module.compressPDF !== 'function') {
          throw new Error('The PDF compression module did not expose its compressor.');
        }
        return module;
      }).catch(error => {
        pdfCompressorPromise = null;
        throw error;
      });
    }
    return pdfCompressorPromise;
  }

  async function getPdfPageCount(file) {
    if (!window.pdfjsLib) {
      throw new Error('PDF validation is unavailable because the PDF reader library did not load.');
    }

    const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
    if (!header.includes('%PDF-')) {
      throw new Error('The file does not contain a valid PDF header.');
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const task = window.pdfjsLib.getDocument({
      data: new Uint8Array(await file.arrayBuffer())
    });

    let documentProxy = null;
    try {
      documentProxy = await task.promise;
      return documentProxy.numPages;
    } finally {
      if (documentProxy) {
        await documentProxy.destroy();
      } else {
        await task.destroy();
      }
    }
  }

  async function hasDigitalSignatureMarker(file) {
    const markers = ['/ByteRange', '/FT /Sig', '/FT/Sig'];
    const chunkSize = 2 * 1024 * 1024;
    let carry = '';

    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer();
      const text = carry + new TextDecoder('latin1').decode(chunk);
      if (markers.some(marker => text.includes(marker))) return true;
      carry = text.slice(-32);
    }
    return false;
  }

  async function prepareFileForUpload(file, index) {
    validateFileType(file);

    if (file.size <= COMPRESSION_THRESHOLD) {
      validateFile(file);
      return { file, optimized: false, note: 'Compression not required' };
    }

    if (file.type !== 'application/pdf') {
      validateFile(file);
      return {
        file,
        optimized: false,
        note: 'Original retained; safe compression is not configured for this document format'
      };
    }

    updateQueueItem(index, 'Checking PDF…', 0);

    try {
      if (await hasDigitalSignatureMarker(file)) {
        validateFile(file);
        return {
          file,
          optimized: false,
          note: 'Original retained because modifying a digitally signed PDF can invalidate its signature'
        };
      }

      const originalPages = await getPdfPageCount(file);
      const { compressPDF } = await loadPdfCompressor();
      updateQueueItem(index, 'Compressing…', 0);

      const result = await compressPDF(file, {
        quality: PDF_COMPRESSION_QUALITY,
        scale: 1,
        onlyIfSmaller: true,
        workers: 0
      });

      const compressed = result?.file;
      if (!(compressed instanceof Blob) || compressed.size === 0) {
        throw new Error('The compressor returned an empty or invalid file.');
      }

      if (compressed.size >= file.size) {
        validateFile(file);
        return {
          file,
          optimized: false,
          note: 'Original retained because compression did not reduce the file size'
        };
      }

      const candidate = new File(
        [compressed],
        file.name,
        { type: 'application/pdf', lastModified: file.lastModified }
      );

      const compressedPages = await getPdfPageCount(candidate);
      if (compressedPages !== originalPages) {
        throw new Error('The compressed PDF did not preserve the original page count.');
      }

      if (candidate.size > MAX_FILE_SIZE) {
        throw new Error('The compressed PDF still exceeds the 50 MB upload limit.');
      }

      return {
        file: candidate,
        optimized: true,
        note: `Optimized by ${Number(result.stats?.reduction || 0).toFixed(1)}%`
      };
    } catch (error) {
      if (file.size <= MAX_FILE_SIZE) {
        console.warn(`Clariva kept the original PDF after compression failed for ${file.name}:`, error);
        return {
          file,
          optimized: false,
          note: 'Original retained because compression or PDF validation failed'
        };
      }

      throw new Error(
        `Compression could not produce a valid PDF within the 50 MB limit. Original retained locally; upload rejected. ${error.message || ''}`.trim()
      );
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

  async function getAuthorizedUploader(requiredPermission = 'resource_upload') {
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

    if (profile.Verified !== true) {
      throw new Error('Your account is not verified for resource management.');
    }

    if (['admin', 'owner'].includes(role)) return user;

    const courseRepPermissions = new Set(window.clarivaCourseRepPermissions || []);
    if (role === 'student' && window.clarivaIsCourseRep === true && courseRepPermissions.has(requiredPermission)) {
      return user;
    }

    throw new Error('Your account does not have permission for this resource action.');
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

      let data;
      let error;
      if (window.clarivaIsCourseRep === true) {
        const result = await supabaseClient.rpc('course_rep_list_resources');
        data = result.data;
        error = result.error;
      } else {
        const result = await supabaseClient
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
        data = result.data;
        error = result.error;
      }

      if (error) {
        throw error;
      }

      resources = (data || []).slice(0, RESOURCE_LIMIT);

      updateStatistics();
      renderResources();

    } catch (error) {
      console.error('Clariva resource loading error:', error);

      list.textContent = window.clarivaFriendlyError?.(error, 'Unable to load resources. Refresh and try again.') || 'Unable to load resources. Refresh and try again.';
    }
  }

  /* ============================================================
     ADMIN USER AND PLATFORM OVERVIEW
     Reads one aggregate-only view. No student contact details
     or individual profile rows are returned to the browser.
     ============================================================ */

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
    const status = getElement('admin-overview-status');
    if (status) {
      status.hidden = false;
      status.textContent = 'Refreshing overview…';
    }
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
      setOverviewValue('admin-total-offline-saves', data.total_offline_saves);
      setOverviewValue('admin-total-views', data.total_views);
      setOverviewValue('admin-new-resources', data.resources_added_7d);
      renderOverviewBreakdown('admin-resource-type-breakdown', data.resources_by_type, 'No resource types to display.');

      const latest = getElement('admin-latest-resource');
      if (latest) latest.textContent = formatOverviewDate(data.latest_resource_at);
      if (status) {
        status.hidden = true;
        status.textContent = '';
      }

    } catch (error) {
      console.error('Clariva admin overview error:', error);
      if (status) {
        status.textContent = window.clarivaFriendlyError?.(error, 'Unable to refresh the overview. Try again.') || 'Unable to refresh the overview. Try again.';
        status.hidden = false;
      }
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
    try {
      await getAuthorizedUploader('resource_update');

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
      showResourceUpdateSuccess(successMessage);
    } catch (error) {
      console.error('Clariva resource update error:', error);
      setResourceActionStatus(
        window.clarivaFriendlyError?.(error, 'Unable to update this resource. Try again.') || 'Unable to update this resource. Try again.',
        'error'
      );
      // The inline status already gives the user a concise, actionable message.
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
      await getAuthorizedUploader('resource_delete');

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
        window.clarivaFriendlyError?.(error, 'Unable to delete this resource. Try again.') || 'Unable to delete this resource. Try again.',
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

    if (window.clarivaIsCourseRep === true) {
      ['department', 'level', 'course_code'].forEach(name => {
        const control = form.querySelector('[name="' + name + '"]');
        if (control) control.disabled = true;
      });
    }

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
      featuredButton.textContent = resource.featured
        ? (resource.featured_permanent ? 'Unfeature' : 'Keep Featured')
        : 'Feature Resource';
      featuredButton.addEventListener('click', () => {
        const keepFeatured = resource.featured && resource.featured_permanent !== true;
        const nextFeatured = !resource.featured || keepFeatured;
        updateResourceRecord(
          resource,
          nextFeatured
            ? { featured: true, featured_permanent: true, featured_until: null }
            : { featured: false, featured_permanent: false, featured_until: null },
          featuredButton,
          keepFeatured ? 'Keeping featured...' : nextFeatured ? 'Featuring...' : 'Updating...'
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

      if (window.clarivaIsCourseRep === true) {
        actions.appendChild(openButton);
        if ((window.clarivaCourseRepPermissions || []).includes('resource_update')) {
          actions.append(editButton);
          card.appendChild(editor);
        }
      } else {
        actions.append(openButton, editButton, visibilityButton, featuredButton, deleteButton);
        card.appendChild(editor);
      }
      card.appendChild(actions);
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
      alert(window.clarivaFriendlyError?.(error, 'Unable to open this resource. Try again.') || 'Unable to open this resource. Try again.');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  /* ============================================================
     RESOURCE UPLOAD
     ============================================================ */

  function getResourceTitleFromFileName(fileName) {
    const title = String(fileName || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .slice(0, 160);
    return title || 'Untitled resource';
  }

  function confirmBatchUpload(metadata) {
    const dialog = getElement('resource-batch-confirm-dialog');
    const fields = {
      level: getElement('batch-edit-level'),
      semester: getElement('batch-edit-semester'),
      courseCode: getElement('batch-edit-course-code'),
      resourceType: getElement('batch-edit-resource-type')
    };
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm('You selected multiple files. Continue only if the semester, course code, level and resource type are correct for every file.'));
    }
    fields.level.value = String(metadata.level);
    fields.semester.value = String(metadata.semester);
    fields.courseCode.value = metadata.courseCode || '';
    fields.resourceType.value = metadata.resourceType;
    return new Promise(resolve => {
      const confirmButton = getElement('resource-batch-confirm');
      const cancelButton = getElement('resource-batch-cancel');
      const finish = confirmed => {
        dialog.removeEventListener('close', handleClose);
        confirmButton?.removeEventListener('click', handleConfirm);
        cancelButton?.removeEventListener('click', handleCancel);
        if (dialog.open) dialog.close(confirmed ? 'confirm' : 'cancel');
        resolve(confirmed);
      };
      const handleConfirm = () => {
        if (!fields.level.value || !fields.semester.value || !fields.resourceType.value) {
          Object.values(fields).forEach(field => field?.reportValidity?.());
          return;
        }
        metadata.level = Number(fields.level.value);
        metadata.semester = Number(fields.semester.value);
        metadata.courseCode = fields.courseCode.value.trim();
        metadata.resourceType = fields.resourceType.value;
        finish(true);
      };
      const handleCancel = () => finish(false);
      const handleClose = () => {
        confirmButton?.removeEventListener('click', handleConfirm);
        cancelButton?.removeEventListener('click', handleCancel);
        resolve(dialog.returnValue === 'confirm');
      };
      confirmButton?.addEventListener('click', handleConfirm);
      cancelButton?.addEventListener('click', handleCancel);
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', handleClose, { once: true });
      dialog.showModal();
    });
  }

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
    const title = getResourceTitleFromFileName(file.name);

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
        featured: window.clarivaIsCourseRep === true ? false : true,
        featured_until: window.clarivaIsCourseRep === true ? null : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        featured_permanent: false
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
    if (uploadQueueBusy) return;

    const form = getElement('resource-upload-form');
    if (!form) {
      setStatus('The upload form is unavailable. Refresh the dashboard and try again.', 'error');
      return;
    }
    if (!form.reportValidity()) {
      setStatus('Please complete the highlighted required fields before uploading.', 'error');
      return;
    }

    const allFiles = getSelectedFiles();
    if (!allFiles.length) {
      setStatus('Select at least one document to upload.', 'error');
      return;
    }
    const files = getFilesForUpload();
    if (!files.length) {
      setStatus('Tick at least one file to include in the upload.', 'error');
      return;
    }

    const metadata = {
      description: getElement('resource-description').value.trim(),
      department: getElement('resource-department').value.trim(),
      level: Number(getElement('resource-level').value),
      semester: Number(getElement('resource-semester').value),
      courseCode: getElement('resource-course-code').value.trim(),
      courseTitle: getElement('resource-course-title').value.trim(),
      resourceType: getElement('resource-type').value
    };

    if (!metadata.level || !metadata.semester || !metadata.resourceType) {
      setStatus('Please complete all required resource details.', 'error');
      return;
    }

    try {
      files.forEach(validateFileType);
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }

    if (files.length > 1) {
      const confirmed = await confirmBatchUpload(metadata);
      if (!confirmed) {
        setStatus('Batch upload cancelled. Review the selected files and details before uploading.');
        return;
      }
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    renderUploadQueue(files);
    setUploading(true);
    setStatus(`Preparing ${files.length} document${files.length === 1 ? '' : 's'} (${formatFileSize(totalSize)} total)…`);

    try {
      const preparedFiles = new Array(files.length);
      const preparationFailures = new Map();

      for (let index = 0; index < files.length; index += 1) {
        const originalFile = files[index];
        setStatus(`Preparing ${index + 1} of ${files.length}: ${originalFile.name}`);
        try {
          const prepared = await prepareFileForUpload(originalFile, index);
          preparedFiles[index] = prepared.file;
          updateQueueItem(
            index,
            prepared.optimized ? 'Optimized' : 'Ready',
            prepared.optimized ? 100 : 0
          );
          if (prepared.note) {
            console.info(`Clariva upload preparation — ${originalFile.name}: ${prepared.note}`);
          }
        } catch (error) {
          preparationFailures.set(index, error);
          updateQueueItem(index, 'Rejected', 0);
        }
      }

      const user = await getAuthorizedUploader();
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error('Your upload session has expired. Please sign in again.');
      }

      let completed = 0;
      const failures = [];
      const failedFiles = [];
      for (let index = 0; index < files.length; index += 1) {
        const originalFile = files[index];
        const preparationError = preparationFailures.get(index);
        if (preparationError) {
          failures.push(`${originalFile.name}: ${preparationError.message || 'File preparation failed'}`);
          failedFiles.push(originalFile);
          continue;
        }

        const file = preparedFiles[index];
        setStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        try {
          await uploadOneFile(file, index, metadata, user, sessionData.session);
          completed += 1;
        } catch (error) {
          console.error(`Upload failed for ${file.name}:`, error);
          updateQueueItem(index, 'Failed', 0);
          failures.push(`${originalFile.name}: ${window.clarivaFriendlyError?.(error, 'Upload failed.') || 'Upload failed.'}`);
          failedFiles.push(originalFile);
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
        excludedUploadFiles.clear();
        renderSelectedFiles();
        setStatus(`${completed} of ${files.length} files uploaded. Only failed files remain selected for retry: ${failures.join(' | ')}`, 'error');
      } else {
        setStatus(`All ${completed} resource${completed === 1 ? '' : 's'} uploaded successfully.`, 'success');
        form.reset();
        renderSelectedFiles();
      }
    } catch (error) {
      console.error('Clariva resource upload queue error:', error);
      setStatus(window.clarivaFriendlyError?.(error, 'Upload failed. Try again.') || 'Upload failed. Try again.', 'error');
    } finally {
      setUploading(false);
      checkConnectionQuality();
    }
  }
  /* ============================================================
     DASHBOARD INITIALIZATION
     ============================================================ */

  function setFeatureStatus(id, message, state = 'info') {
    const node = getElement(id);
    if (!node) return;
    node.textContent = message || '';
    node.dataset.state = state;
  }

  function appendOption(select, value, label) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    select.appendChild(option);
  }

  function initializeCourseRepTermSelectors() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    ['course-rep-start-month', 'course-rep-end-month'].forEach(id => {
      const select = getElement(id);
      if (!select || select.dataset.optionsReady === 'true') return;
      monthNames.forEach((name, index) => appendOption(select, index + 1, name));
      select.dataset.optionsReady = 'true';
    });
    ['course-rep-start-year', 'course-rep-end-year'].forEach(id => {
      const select = getElement(id);
      if (!select || select.dataset.optionsReady === 'true') return;
      const year = new Date().getFullYear();
      // Allow appointments whose academic term has already begun, as well as future terms.
      for (let value = 2020; value <= year + 8; value += 1) appendOption(select, value, String(value));
      select.dataset.optionsReady = 'true';
    });
  }

  async function loadCourseRepCandidates() {
    const select = getElement('course-rep-student');
    if (!select || !supabaseClient) return;
    select.replaceChildren();
    appendOption(select, '', 'Loading eligible students…');
    try {
      const { data, error } = await supabaseClient.rpc('admin_list_course_rep_candidates', { p_search: null });
      if (error) throw error;
      select.replaceChildren();
      appendOption(select, '', 'Select a verified student');
      (data || []).forEach(student => {
        const option = document.createElement('option');
        option.value = student.user_id;
        option.textContent = (student.display_name || 'Student') + ' — ' + (student.academic_level || 'Level unavailable') + ' Level';
        option.dataset.level = student.academic_level || '';
        select.appendChild(option);
      });
      if (!data?.length) appendOption(select, '', 'No eligible students found');
    } catch (error) {
      console.error('Course representative candidates could not be loaded:', error);
      select.replaceChildren();
      appendOption(select, '', 'Unable to load students');
      setFeatureStatus('course-rep-status', window.clarivaFriendlyError?.(error, 'Eligible students could not be loaded.') || 'Eligible students could not be loaded.', 'error');
    }
  }

  function formatAppointmentTerm(row) {
    const month = value => new Date(2000, Number(value) - 1, 1).toLocaleString(undefined, { month: 'short' });
    return month(row.start_month) + ' ' + row.start_year + ' – ' + month(row.end_month) + ' ' + row.end_year;
  }

  function appointmentStatus(row) {
    if (row.revoked_at) return 'Revoked';
    const now = new Date();
    const start = new Date(Number(row.start_year), Number(row.start_month) - 1, 1);
    const endExclusive = new Date(Number(row.end_year), Number(row.end_month), 1);
    if (now < start) return 'Scheduled';
    if (now >= endExclusive) return 'Expired';
    return 'Active';
  }

  async function loadCourseRepAppointments() {
    const body = getElement('course-rep-appointments');
    if (!body || !supabaseClient) return;
    body.replaceChildren();
    const loading = document.createElement('tr');
    const loadingCell = document.createElement('td');
    loadingCell.colSpan = 6;
    loadingCell.textContent = 'Loading appointments…';
    loading.appendChild(loadingCell);
    body.appendChild(loading);
    try {
      const { data, error } = await supabaseClient.rpc('admin_list_course_rep_appointments');
      if (error) throw error;
      body.replaceChildren();
      if (!data?.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.textContent = 'No course-representative appointments yet.';
        row.appendChild(cell);
        body.appendChild(row);
        return;
      }
      data.forEach(appointment => {
        const row = document.createElement('tr');
        const scope = 'Level ' + appointment.scope_level +
          (appointment.scope_department ? ' · ' + appointment.scope_department : ' · All departments') +
          (appointment.scope_course_code ? ' · ' + appointment.scope_course_code : ' · All courses');
        const cells = [
          appointment.student_name || 'Student',
          scope,
          formatAppointmentTerm(appointment),
          (appointment.permissions || []).map(value => value.replace('resource_', '').replace('_', ' ')).join(', ') || 'No permissions',
          appointmentStatus(appointment)
        ];
        cells.forEach(value => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        });
        const action = document.createElement('td');
        if (!appointment.revoked_at && appointmentStatus(appointment) !== 'Expired') {
          const revoke = document.createElement('button');
          revoke.type = 'button';
          revoke.className = 'admin-button admin-button-secondary';
          revoke.textContent = 'Revoke';
          revoke.addEventListener('click', async () => {
            const reason = window.prompt('Optional reason for revoking this appointment:') || '';
            if (!window.confirm('Revoke this course-representative appointment now?')) return;
            revoke.disabled = true;
            try {
              const { error } = await supabaseClient.rpc('admin_revoke_course_rep_appointment', {
                p_appointment_id: appointment.appointment_id,
                p_reason: reason
              });
              if (error) throw error;
              setFeatureStatus('course-rep-status', 'Appointment revoked. The scoped permissions have been terminated.', 'success');
              await loadCourseRepAppointments();
            } catch (error) {
              console.error('Course representative appointment revocation failed:', error);
              setFeatureStatus('course-rep-status', window.clarivaFriendlyError?.(error, 'The appointment could not be revoked.') || 'The appointment could not be revoked.', 'error');
              revoke.disabled = false;
            }
          });
          action.appendChild(revoke);
        } else {
          action.textContent = '—';
        }
        row.appendChild(action);
        body.appendChild(row);
      });
    } catch (error) {
      console.error('Course representative appointments could not be loaded:', error);
      body.replaceChildren();
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'Appointments could not be loaded. Refresh and try again.';
      row.appendChild(cell);
      body.appendChild(row);
      setFeatureStatus('course-rep-status', window.clarivaFriendlyError?.(error, 'Appointments could not be loaded.') || 'Appointments could not be loaded.', 'error');
    }
  }

  async function createCourseRepAppointment(event) {
    event.preventDefault();
    const form = getElement('course-rep-appointment-form');
    const studentSelect = getElement('course-rep-student');
    const selectedStudent = studentSelect?.selectedOptions?.[0];
    const level = getElement('course-rep-level')?.value;
    const permissions = Array.from(form.querySelectorAll('[name="course-rep-permission"]:checked')).map(input => input.value);
    if (!studentSelect?.value || !selectedStudent?.dataset.level || selectedStudent.dataset.level !== level) {
      setFeatureStatus('course-rep-status', 'Select a student and use that student’s registered academic level.', 'error');
      return;
    }
    if (!permissions.length) {
      setFeatureStatus('course-rep-status', 'Select at least one permission for this appointment.', 'error');
      return;
    }
    if (!getElement('course-rep-department').value.trim()) {
      setFeatureStatus('course-rep-status', 'Enter the department this appointment will cover.', 'error');
      return;
    }
    const startMonth = Number(getElement('course-rep-start-month').value);
    const startYear = Number(getElement('course-rep-start-year').value);
    const endMonth = Number(getElement('course-rep-end-month').value);
    const endYear = Number(getElement('course-rep-end-year').value);
    if (!startMonth || !startYear || !endMonth || !endYear ||
        new Date(startYear, startMonth - 1, 1) > new Date(endYear, endMonth - 1, 1)) {
      setFeatureStatus('course-rep-status', 'Choose a valid appointment term. The end month cannot be earlier than the start month.', 'error');
      return;
    }
    const button = getElement('course-rep-appoint-button');
    button.disabled = true;
    setFeatureStatus('course-rep-status', 'Creating appointment…');
    try {
      const { data: authData, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !authData?.user) throw authError || new Error('Your session has expired.');
      const { error } = await supabaseClient.from('course_rep_appointments').insert({
        student_user_id: studentSelect.value,
        scope_level: Number(level),
        scope_department: getElement('course-rep-department').value.trim() || null,
        scope_course_code: getElement('course-rep-course').value.trim().toUpperCase() || null,
        start_month: startMonth,
        start_year: startYear,
        end_month: endMonth,
        end_year: endYear,
        permissions,
        appointed_by: authData.user.id
      });
      if (error) throw error;
      form.reset();
      setFeatureStatus('course-rep-status', 'Course-representative appointment created successfully.', 'success');
      await Promise.all([loadCourseRepCandidates(), loadCourseRepAppointments()]);
    } catch (error) {
      console.error('Course representative appointment creation failed:', error);
      setFeatureStatus('course-rep-status', window.clarivaFriendlyError?.(error, 'The appointment could not be created.') || 'The appointment could not be created.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function renderAnnouncementHistory(items) {
    const container = getElement('announcement-history');
    if (!container) return;
    container.replaceChildren();
    if (!items?.length) {
      container.textContent = 'No announcements have been published yet.';
      return;
    }
    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'admin-placeholder';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('p');
      const audience = item.audience_type === 'all'
        ? 'All users'
        : item.audience_type === 'role'
          ? 'Role: ' + item.audience_value
          : 'Level ' + item.audience_value + ' students';
      detail.textContent = audience + ' · ' + Number(item.recipient_count || 0).toLocaleString() +
        ' recipient(s) · ' + new Date(item.published_at).toLocaleString();
      card.append(title, detail);
      container.appendChild(card);
    });
  }

  async function loadAnnouncementHistory() {
    const container = getElement('announcement-history');
    if (!container || !supabaseClient) return;
    container.textContent = 'Loading announcement history…';
    try {
      const { data, error } = await supabaseClient.from('announcements')
        .select('id,title,audience_type,audience_value,published_at,recipient_count')
        .order('published_at', { ascending: false }).limit(30);
      if (error) throw error;
      renderAnnouncementHistory(data || []);
    } catch (error) {
      console.error('Announcement history could not be loaded:', error);
      container.textContent = window.clarivaFriendlyError?.(error, 'Announcement history could not be loaded.') || 'Announcement history could not be loaded.';
    }
  }

  async function publishManualAnnouncement(event) {
    event.preventDefault();
    const title = getElement('announcement-title').value.trim();
    const message = getElement('announcement-message').value.trim();
    const audience = getElement('announcement-audience').value;
    const destination = getElement('announcement-destination').value.trim() || './';
    const [audienceType, audienceValue] = audience.includes(':') ? audience.split(':', 2) : ['all', null];
    const button = getElement('announcement-publish-button');
    if (!title || !message) {
      setFeatureStatus('announcement-status', 'Enter an announcement title and message.', 'error');
      return;
    }
    if (!window.confirm('Publish this announcement to ' + getElement('announcement-audience').selectedOptions[0].textContent + '?')) return;
    button.disabled = true;
    setFeatureStatus('announcement-status', 'Publishing announcement…');
    try {
      const { data, error } = await supabaseClient.rpc('publish_announcement', {
        p_title: title,
        p_message: message,
        p_audience_type: audienceType,
        p_audience_value: audienceValue,
        p_destination: destination
      });
      if (error) throw error;

      let deliveryMessage = 'The announcement is available in recipients’ Clariva inboxes.';
      try {
        const { data: pushResult, error: pushError } = await supabaseClient.functions.invoke('clariva-push', {
          body: { action: 'announcement_push', announcementId: data }
        });
        if (pushError || pushResult?.error) {
          throw pushError || new Error(pushResult.error);
        }
        const pushSent = Number(pushResult?.sent || 0);
        const pushFailed = Number(pushResult?.failed || 0);
        deliveryMessage += pushSent
          ? ' Push sent to ' + pushSent.toLocaleString() + ' subscribed device(s).'
          : ' No subscribed devices were available for push delivery.';
        if (pushFailed) deliveryMessage += ' ' + pushFailed.toLocaleString() + ' device(s) could not be reached.';
      } catch (pushError) {
        console.warn('Clariva announcement push delivery is unavailable:', pushError);
        deliveryMessage += ' Push delivery could not be completed; in-app delivery is saved.';
      }

      getElement('manual-announcement-form').reset();
      setFeatureStatus('announcement-status', deliveryMessage, 'success');
      await loadAnnouncementHistory();
      document.dispatchEvent(new CustomEvent('clariva:announcement-published', { detail: { id: data } }));
    } catch (error) {
      console.error('Manual announcement publishing failed:', error);
      setFeatureStatus('announcement-status', window.clarivaFriendlyError?.(error, 'The announcement could not be published.') || 'The announcement could not be published.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function configureCourseRepDashboard() {
    if (window.clarivaIsCourseRep !== true) return;
    const permissions = new Set(window.clarivaCourseRepPermissions || []);
    const title = getElement('admin-page-title');
    const description = document.querySelector('.admin-description');
    if (title) title.textContent = 'Course Representative Dashboard';
    if (description) description.textContent = 'Manage learning resources only within your appointed department and academic level.';
    ['resource-management', 'user-overview', 'platform-overview', 'course-representatives', 'manual-announcements'].forEach(id => {
      const section = getElement(id);
      if (section) section.hidden = true;
    });
    if (!permissions.has('resource_upload')) {
      const upload = getElement('upload-resource');
      if (upload) upload.hidden = true;
    } else {
      const department = getElement('resource-department');
      if (department) {
        department.required = true;
        department.placeholder = 'Enter the department in your appointment';
      }
      const level = getElement('resource-level');
      const registeredLevel = String(window.clarivaCachedProfile?.Level || '');
      if (level && registeredLevel) level.value = registeredLevel;
      const intro = getElement('upload-resource')?.querySelector('.admin-panel-intro');
      if (intro) intro.textContent = 'Upload resources only within your appointed department and academic level. Enter the exact department and, if your appointment is course-specific, the matching course code.';
    }
    const nav = getElement('clariva-nav-menu');
    nav?.querySelectorAll('a[href="#resource-management"],a[href="#user-overview"],a[href="#platform-overview"],a[href="#course-representatives"],a[href="#manual-announcements"]').forEach(link => {
      link.hidden = true;
    });
    const repLink = getElement('clariva-course-rep-dashboard-link');
    if (repLink) repLink.hidden = true;
  }

  function initializeAdminCommunicationAndCourseRepFeatures() {
    if (!getElement('course-rep-appointment-form') && !getElement('manual-announcement-form')) return;
    initializeCourseRepTermSelectors();
    const studentSelect = getElement('course-rep-student');
    studentSelect?.addEventListener('change', () => {
      const level = studentSelect.selectedOptions?.[0]?.dataset.level || '';
      if (getElement('course-rep-level')) getElement('course-rep-level').value = level;
    });
    const appointmentForm = getElement('course-rep-appointment-form');
    if (appointmentForm && appointmentForm.dataset.handlerAttached !== 'true') {
      appointmentForm.addEventListener('submit', createCourseRepAppointment);
      appointmentForm.dataset.handlerAttached = 'true';
    }
    getElement('course-rep-refresh')?.addEventListener('click', () => {
      void loadCourseRepCandidates();
      void loadCourseRepAppointments();
    });
    const announcementForm = getElement('manual-announcement-form');
    if (announcementForm && announcementForm.dataset.handlerAttached !== 'true') {
      announcementForm.addEventListener('submit', publishManualAnnouncement);
      announcementForm.dataset.handlerAttached = 'true';
    }
    void loadCourseRepCandidates();
    void loadCourseRepAppointments();
    void loadAnnouncementHistory();
  }

  function initializeAdminDashboard() {
    initializeAdminPdfReaderControls();
    configureCourseRepDashboard();
    if (window.clarivaIsCourseRep !== true) initializeAdminCommunicationAndCourseRepFeatures();
    const form = getElement('resource-upload-form');

    if (form && form.dataset.uploadHandlerAttached !== 'true') {
      form.addEventListener('submit', uploadResource);
      form.addEventListener('reset', () => {
        window.setTimeout(() => {
          excludedUploadFiles.clear();
          renderSelectedFiles();
          const queue = getElement('resource-upload-queue');
          if (queue) queue.replaceChildren();
          setNetworkWarning('');
        }, 0);
      });
      form.dataset.uploadHandlerAttached = 'true';
    }

    // Handle an explicit tap before the browser's native submit sequence.
    // uploadResource performs the same form validation itself, then reports
    // any validation or upload errors in the dashboard status region.
    const uploadButton = getElement('resource-upload-button');
    if (uploadButton && uploadButton.dataset.clickHandlerAttached !== 'true') {
      uploadButton.addEventListener('click', event => {
        event.preventDefault();
        void uploadResource(event);
      });
      uploadButton.dataset.clickHandlerAttached = 'true';
    }
    const fileInput = getElement('resource-file');
    if (fileInput && fileInput.dataset.selectionHandlerAttached !== 'true') {
      fileInput.addEventListener('change', renderSelectedFiles);
      fileInput.dataset.selectionHandlerAttached = 'true';
    }
    initializeResourceSourcePicker();
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
    if (window.clarivaIsCourseRep !== true) loadAdminOverview();

    const overviewRefresh = window.clarivaIsCourseRep === true ? null : getElement('admin-overview-refresh');
    if (overviewRefresh && overviewRefresh.dataset.handlerAttached !== 'true') {
      overviewRefresh.addEventListener('click', loadAdminOverview);
      overviewRefresh.dataset.handlerAttached = 'true';
    }
  }

  // Do not initialize dashboard data until the shared authentication guard
  // has completed. Optional third-party libraries load independently.
  const ready = window.clarivaPageReady;
  if (ready && typeof ready.then === 'function') {
    ready.then(() => initializeAdminDashboard()).catch(error => {
      console.error('Admin dashboard initialization was blocked:', error);
    });
  } else {
    void initializeAdminDashboard();
  }
})();
