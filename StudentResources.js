// Clariva student Resource Library
// Student access is restricted by verified account status and academic level.
// Department and semester are descriptive metadata, not access restrictions.

(() => {
  'use strict';

  const BUCKET_NAME = 'clariva-resources';
  const SIGNED_URL_TTL_SECONDS = 300;
  const OFFLINE_DB_NAME = 'clariva-offline-library-v1';
  const OFFLINE_STORE_NAME = 'documents';

  let client = null;
  let resources = [];
  let currentUserId = null;
  let currentUserRole = '';
  let activeLevel = null;
  let offlineDbPromise = null;
  let activePdfObjectUrl = null;
  let activePdf = null;
  let activePdfPage = 1;
  let pdfScale = 1;
  let pdfRenderTask = null;

  const getElement = id => document.getElementById(id);

  function setLibraryStatus(message, state = 'info') {
    const status = getElement('student-library-status');
    if (!status) return;

    status.textContent = message;
    status.dataset.state = state;
    status.hidden = !message;
  }

  function makeTextElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text || '';
    return element;
  }

  function openOfflineDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('This browser does not support offline library storage.'));
    }
    if (!offlineDbPromise) {
      offlineDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
            database.createObjectStore(OFFLINE_STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Offline storage could not be opened.'));
      }).catch(error => {
        offlineDbPromise = null;
        throw error;
      });
    }
    return offlineDbPromise;
  }

  function offlineDocumentKey(resourceId) {
    return String(currentUserId || '') + ':' + String(resourceId || '');
  }

  async function getOfflineDocument(resourceId) {
    if (!currentUserId || !resourceId) return null;
    const database = await openOfflineDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_STORE_NAME, 'readonly');
      const request = transaction.objectStore(OFFLINE_STORE_NAME).get(offlineDocumentKey(resourceId));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Offline save could not be checked.'));
    });
  }

  async function writeOfflineDocument(resource, blob) {
    const database = await openOfflineDatabase();
    const record = {
      key: offlineDocumentKey(resource.id),
      userId: currentUserId,
      resourceId: resource.id,
      title: resource.title || resource.file_name || 'Learning resource',
      fileName: resource.file_name || 'resource.pdf',
      metadata: {
        id: resource.id,
        title: resource.title,
        description: resource.description,
        department: resource.department,
        level: resource.level,
        semester: resource.semester,
        course_code: resource.course_code,
        course_title: resource.course_title,
        resource_type: resource.resource_type,
        file_url: resource.file_url,
        file_name: resource.file_name,
        file_size: resource.file_size,
        featured: resource.featured,
        created_at: resource.created_at
      },
      blob,
      savedAt: new Date().toISOString()
    };
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_STORE_NAME, 'readwrite');
      transaction.objectStore(OFFLINE_STORE_NAME).put(record);
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () => reject(transaction.error || new Error('The document could not be saved on this device.'));
      transaction.onabort = () => reject(transaction.error || new Error('The offline save was interrupted.'));
    });
  }

  async function deleteOfflineDocument(resourceId) {
    const database = await openOfflineDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_STORE_NAME, 'readwrite');
      transaction.objectStore(OFFLINE_STORE_NAME).delete(offlineDocumentKey(resourceId));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('The offline copy could not be removed.'));
    });
  }

  async function getOfflineResourcesForUser(userId) {
    if (!userId) return [];
    const database = await openOfflineDatabase();
    return new Promise((resolve, reject) => {
      const records = [];
      const transaction = database.transaction(OFFLINE_STORE_NAME, 'readonly');
      const request = transaction.objectStore(OFFLINE_STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value?.userId === userId && cursor.value?.metadata) {
          records.push(cursor.value.metadata);
        }
        cursor.continue();
      };
      transaction.oncomplete = () => {
        records.sort((left, right) =>
          Number(left.level) - Number(right.level) ||
          Number(left.semester) - Number(right.semester) ||
          String(left.title || '').localeCompare(String(right.title || ''))
        );
        resolve(records);
      };
      transaction.onerror = () => reject(transaction.error || new Error('Saved offline resources could not be loaded.'));
    });
  }

  async function clearOfflineDocumentsForUser(userId) {
    if (!userId || !('indexedDB' in window)) return;
    const database = await openOfflineDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(OFFLINE_STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value?.userId === userId) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Offline files could not be cleared.'));
    });
  }

  window.clarivaClearOfflineSaves = clearOfflineDocumentsForUser;

  async function saveResourceOffline(resource, button) {
    if (!currentUserId || currentUserRole !== 'student') {
      setLibraryStatus('Offline Saves are available to verified student accounts.', 'error');
      return;
    }
    if (!navigator.onLine) {
      setLibraryStatus('Connect to the internet before saving this resource for offline reading.', 'error');
      return;
    }
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const { data, error } = await client.storage.from(BUCKET_NAME)
        .createSignedUrl(resource.file_url, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('A secure file link could not be created.');
      const response = await fetch(data.signedUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('The document could not be retrieved. Try again.');
      const blob = await response.blob();
      if (!blob.size) throw new Error('The document returned an empty file.');
      await writeOfflineDocument(resource, blob);
      const { error: saveError } = await client.rpc('save_offline_resource', {
        resource_id_input: resource.id
      });
      if (saveError) {
        await deleteOfflineDocument(resource.id);
        throw saveError;
      }
      button.dataset.saved = 'true';
      button.textContent = 'Saved offline · Remove';
      setLibraryStatus('Saved for offline reading on this device. It is available while you remain signed in to this account. Browser storage can be cleared by your device settings.', 'success');
    } catch (error) {
      console.error('Clariva offline save failed:', error);
      button.textContent = originalText;
      setLibraryStatus(window.clarivaFriendlyError?.(error, 'Unable to save this document offline. Check your connection and device storage.') || 'Unable to save this document offline. Check your connection and device storage.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function removeOfflineSave(resource, button) {
    if (!navigator.onLine) {
      setLibraryStatus('Connect to the internet before removing an offline save.', 'error');
      return;
    }
    button.disabled = true;
    try {
      const { error } = await client.rpc('remove_offline_resource_save', {
        resource_id_input: resource.id
      });
      if (error) throw error;
      await deleteOfflineDocument(resource.id);
      button.dataset.saved = 'false';
      button.textContent = 'Save for offline';
      setLibraryStatus('Offline save removed from this device.', 'success');
    } catch (error) {
      console.error('Clariva offline save removal failed:', error);
      setLibraryStatus(window.clarivaFriendlyError?.(error, 'Unable to remove this offline save. Try again.') || 'Unable to remove this offline save. Try again.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function getResourceSearchText(resource) {
    return [
      resource.title,
      resource.description,
      resource.department,
      resource.course_code,
      resource.course_title,
      resource.resource_type,
      resource.file_name
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '';

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function getResourceAnchorId(resource) {
    const safeId = String(resource.id || resource.file_name || resource.title || 'resource')
      .replace(/[^a-zA-Z0-9_-]/g, '-');
    return 'student-resource-' + safeId;
  }

  function createResourceCard(resource) {
    const card = document.createElement('article');
    card.className = 'student-resource-card';
    card.id = getResourceAnchorId(resource);
    card.tabIndex = -1;

    const metaParts = [
      resource.course_code,
      resource.department,
      resource.resource_type,
      resource.semester ? `Semester ${resource.semester}` : ''
    ].filter(Boolean);

    card.appendChild(makeTextElement(
      'p',
      'student-resource-meta',
      metaParts.join(' · ') || 'Learning resource'
    ));

    card.appendChild(makeTextElement(
      'h3',
      '',
      resource.title || resource.file_name || 'Untitled resource'
    ));

    if (resource.description) {
      card.appendChild(makeTextElement(
        'p',
        'student-resource-description',
        resource.description
      ));
    }

    const details = [
      resource.course_title,
      formatFileSize(resource.file_size)
    ].filter(Boolean);

    if (details.length) {
      card.appendChild(makeTextElement(
        'p',
        'student-resource-description',
        details.join(' · ')
      ));
    }

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'student-resource-open';
    openButton.textContent = 'Open resource';
    openButton.disabled = !resource.file_url;
    openButton.addEventListener('click', () => openResource(resource, openButton));

    card.appendChild(openButton);

    const isPdfResource = String(resource.file_name || '').toLowerCase().endsWith('.pdf');
    if (currentUserRole === 'student' && isPdfResource && resource.file_url) {
      const offlineButton = document.createElement('button');
      offlineButton.type = 'button';
      offlineButton.className = 'student-resource-open student-resource-offline';
      offlineButton.textContent = 'Checking offline status…';
      offlineButton.disabled = true;
      offlineButton.addEventListener('click', () => {
        if (offlineButton.dataset.saved === 'true') {
          void removeOfflineSave(resource, offlineButton);
        } else {
          void saveResourceOffline(resource, offlineButton);
        }
      });
      getOfflineDocument(resource.id).then(saved => {
        offlineButton.dataset.saved = saved ? 'true' : 'false';
        offlineButton.textContent = saved ? 'Saved offline · Remove' : 'Save for offline';
        offlineButton.disabled = false;
      }).catch(() => {
        offlineButton.textContent = 'Offline save unavailable';
        offlineButton.disabled = true;
      });
      card.appendChild(offlineButton);
    }
    return card;
  }

  function renderResourceCards(container, items, emptyMessage) {
    if (!container) return;

    container.replaceChildren();

    if (!items.length) {
      container.appendChild(makeTextElement(
        'p',
        'student-library-status',
        emptyMessage
      ));
      return;
    }

    items.forEach(resource => {
      container.appendChild(createResourceCard(resource));
    });
  }

  let activeSemester = null;
  let lastSemesterTrigger = null;
  let lastLevelTrigger = null;

  function getFilteredResources() {
    const search = (getElement('resource-search')?.value || '').trim().toLowerCase();
    const type = getElement('resource-type-filter')?.value || '';

    return resources.filter(resource => {
      const matchesLevel = activeLevel !== null &&
        Number(resource.level) === Number(activeLevel);
      const matchesSemester = activeSemester !== null &&
        Number(resource.semester) === Number(activeSemester);
      const matchesSearch = !search || getResourceSearchText(resource).includes(search);
      const matchesType = !type || resource.resource_type === type;
      return matchesLevel && matchesSemester && matchesSearch && matchesType;
    });
  }

  function renderFeaturedResourceLinks(container, items, emptyMessage) {
    if (!container) return;

    container.replaceChildren();

    if (!items.length) {
      container.appendChild(makeTextElement(
        'p',
        'student-library-status',
        emptyMessage
      ));
      return;
    }

    items.forEach(resource => {
      const link = document.createElement('a');
      link.className = 'student-featured-link';
      link.href = '#' + getResourceAnchorId(resource);
      link.textContent = resource.title || resource.file_name || 'Untitled resource';
      link.setAttribute('aria-label', 'Jump to ' + link.textContent + ' in all resources');
      container.appendChild(link);
    });
  }

  function renderResources() {
    if (activeSemester === null) return;

    const filtered = getFilteredResources();
    const featured = filtered.filter(resource => resource.featured === true);
    const semesterLabel = Number(activeSemester) === 1 ? 'First Semester' : 'Second Semester';
    const semesterTotal = resources.filter(resource =>
      Number(resource.level) === Number(activeLevel) &&
      Number(resource.semester) === Number(activeSemester)
    ).length;

    const count = getElement('semester-overlay-count');
    if (count) {
      count.textContent = semesterTotal + ' resource' + (semesterTotal === 1 ? '' : 's') + ' available';
    }

    renderFeaturedResourceLinks(
      getElement('featured-resources'),
      featured,
      'There are no featured resources for this semester at the moment.'
    );

    renderResourceCards(
      getElement('all-resources'),
      filtered,
      semesterTotal
        ? 'No resources match your search or selected filter.'
        : 'No resources have been published for ' + semesterLabel + ' yet.'
    );
  }

  function updateLevelChoices(studentLevel) {
    const grid = getElement('student-level-grid');
    if (!grid) return;
    grid.replaceChildren();
    const availableLevels = [...new Set(resources
      .map(resource => Number(resource.level))
      .filter(level => Number.isInteger(level) && level >= 100 && level <= studentLevel && level <= 500))]
      .sort((a, b) => a - b);

    if (!availableLevels.length) {
      const empty = makeTextElement('p', 'student-library-status', 'No published resources are available for your academic level or earlier levels yet.');
      grid.appendChild(empty);
      return;
    }

    availableLevels.forEach(level => {
      const count = resources.filter(resource => Number(resource.level) === level).length;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'semester-choice';
      button.dataset.levelChoice = String(level);
      button.setAttribute('aria-haspopup', 'dialog');
      button.append(
        makeTextElement('span', 'semester-choice-title', level + ' Level Resources'),
        makeTextElement('span', 'semester-choice-count', count + ' resource' + (count === 1 ? '' : 's') + ' available')
      );
      button.addEventListener('click', () => openLevel(level, button));
      grid.appendChild(button);
    });
  }

  function updateSemesterCounts() {
    [1, 2].forEach(semester => {
      const count = resources.filter(resource =>
        Number(resource.level) === Number(activeLevel) &&
        Number(resource.semester) === semester
      ).length;
      const node = getElement('semester-count-' + semester);
      if (node) node.textContent = count + ' resource' + (count === 1 ? '' : 's') + ' available';
    });
  }

  function openLevel(level, trigger = null) {
    const safeLevel = Number(level);
    if (!resources.some(resource => Number(resource.level) === safeLevel)) return;
    activeLevel = safeLevel;
    activeSemester = null;
    lastLevelTrigger = trigger || lastLevelTrigger;
    const overlay = getElement('semester-resource-overlay');
    const title = getElement('semester-overlay-title');
    if (title) title.textContent = safeLevel + ' Level Resources';
    getElement('semester-picker-panel').hidden = false;
    getElement('semester-resource-content').hidden = true;
    const back = getElement('semester-overlay-back');
    if (back) back.textContent = '← Back to levels';
    updateSemesterCounts();
    overlay.hidden = false;
    document.body.classList.add('semester-overlay-open');
    syncSemesterOverlayOffset();
    back?.focus();
  }

  function openSemester(semester, trigger = null) {
    const safeSemester = Number(semester);
    if (![1, 2].includes(safeSemester) || activeLevel === null) return;

    activeSemester = safeSemester;
    lastSemesterTrigger = trigger || lastSemesterTrigger;
    const title = getElement('semester-overlay-title');
    const label = safeSemester === 1 ? 'First Semester' : 'Second Semester';
    if (title) title.textContent = activeLevel + ' Level · ' + label;
    getElement('semester-picker-panel').hidden = true;
    getElement('semester-resource-content').hidden = false;
    const back = getElement('semester-overlay-back');
    if (back) back.textContent = '← Back to semesters';
    const search = getElement('resource-search');
    const typeFilter = getElement('resource-type-filter');
    if (search) search.value = '';
    if (typeFilter) typeFilter.value = '';
    renderResources();
    back?.focus();
  }

  function handleSemesterOverlayBack() {
    if (!getElement('semester-resource-content')?.hidden) {
      activeSemester = null;
      getElement('semester-resource-content').hidden = true;
      getElement('semester-picker-panel').hidden = false;
      const title = getElement('semester-overlay-title');
      if (title) title.textContent = activeLevel + ' Level Resources';
      const back = getElement('semester-overlay-back');
      if (back) back.textContent = '← Back to levels';
      updateSemesterCounts();
      back?.focus();
      return;
    }
    closeSemesterOverlay();
  }

  function closeSemesterOverlay() {
    const overlay = getElement('semester-resource-overlay');
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    activeLevel = null;
    activeSemester = null;
    getElement('semester-picker-panel').hidden = false;
    getElement('semester-resource-content').hidden = true;
    document.body.classList.remove('semester-overlay-open');
    lastLevelTrigger?.focus();
  }

  function syncSemesterOverlayOffset() {
    const header = getElement('header');
    if (!header) return;
    const height = Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty(
      '--clariva-library-header-height',
      height + 'px'
    );
  }

  function initializeSemesterNavigation() {
    document.querySelectorAll('[data-semester-choice]').forEach(button => {
      button.addEventListener('click', () => {
        openSemester(button.dataset.semesterChoice, button);
      });
    });

    document.querySelectorAll('[data-open-semester]').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        openSemester(link.dataset.openSemester);
      });
    });

    getElement('semester-overlay-back')?.addEventListener('click', handleSemesterOverlayBack);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !getElement('semester-resource-overlay')?.hidden) {
        closeSemesterOverlay();
      }
    });

    window.addEventListener('resize', syncSemesterOverlayOffset);
    syncSemesterOverlayOffset();
  }

  function populateResourceTypeFilter() {
    const filter = getElement('resource-type-filter');
    if (!filter) return;

    const selectedValue = filter.value;
    const types = [...new Set(
      resources.map(resource => resource.resource_type).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    filter.replaceChildren(new Option('All resource types', ''));

    types.forEach(type => {
      filter.add(new Option(type, type));
    });

    filter.value = types.includes(selectedValue) ? selectedValue : '';
  }

  function updatePdfControls() {
    const count = activePdf?.numPages || 0;
    const pageCount = getElement('pdf-reader-page-count');
    const previous = getElement('pdf-reader-prev');
    const next = getElement('pdf-reader-next');

    if (pageCount) pageCount.textContent = count ? `Page ${activePdfPage} / ${count}` : 'Page — / —';
    if (previous) previous.disabled = !count || activePdfPage <= 1;
    if (next) next.disabled = !count || activePdfPage >= count;
    const overlayPrevious = getElement('pdf-reader-overlay-prev');
    const overlayNext = getElement('pdf-reader-overlay-next');
    if (overlayPrevious) overlayPrevious.disabled = !count || activePdfPage <= 1;
    if (overlayNext) overlayNext.disabled = !count || activePdfPage >= count;
  }

  async function renderPdfPage() {
    if (!activePdf) return;

    const canvas = getElement('pdf-reader-canvas');
    const message = getElement('pdf-reader-message');
    const viewport = getElement('pdf-reader-viewport');
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
      const renderScale = fitScale * pdfScale;
      const pageViewport = page.getViewport({ scale: renderScale });
      const outputScale = window.devicePixelRatio || 1;

      canvas.width = Math.floor(pageViewport.width * outputScale);
      canvas.height = Math.floor(pageViewport.height * outputScale);
      canvas.style.width = `${Math.floor(pageViewport.width)}px`;
      canvas.style.height = `${Math.floor(pageViewport.height)}px`;

      message.hidden = true;
      canvas.hidden = false;

      pdfRenderTask = page.render({
        canvasContext: context,
        viewport: pageViewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
      });
      await pdfRenderTask.promise;
      pdfRenderTask = null;
      updatePdfControls();
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') {
        console.error('PDF page rendering error:', error);
        message.textContent = 'This page could not be displayed. Please close the viewer and try again.';
        message.hidden = false;
        canvas.hidden = true;
      }
    }
  }

  async function showPdfReader(signedUrl, title) {
    const reader = getElement('pdf-reader');
    const message = getElement('pdf-reader-message');
    const canvas = getElement('pdf-reader-canvas');

    if (!window.pdfjsLib) {
      throw new Error('The document viewer could not be loaded. Please refresh and try again.');
    }

    reader.hidden = false;
    document.body.classList.add('pdf-reader-open');
    getElement('pdf-reader-title').textContent = title || 'Learning resource';
    message.textContent = 'Loading document…';
    message.hidden = false;
    canvas.hidden = true;
    activePdf = null;
    activePdfPage = 1;
    pdfScale = 1;
    updatePdfControls();

    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      activePdf = await window.pdfjsLib.getDocument({
        url: signedUrl,
        disableAutoFetch: false,
        disableStream: false,
        disableRange: false,
        rangeChunkSize: 65536
      }).promise;
      await renderPdfPage();
    } catch (error) {
      closePdfReader();
      throw new Error('This PDF could not be displayed in Clariva. Please try again later.');
    }
  }

  function closePdfReader() {
    const reader = getElement('pdf-reader');
    if (pdfRenderTask) {
      try { pdfRenderTask.cancel(); } catch (_) {}
      pdfRenderTask = null;
    }
    if (activePdf) {
      activePdf.destroy();
      activePdf = null;
    }
    reader.hidden = true;
    document.body.classList.remove('pdf-reader-open');
    if (activePdfObjectUrl) {
      URL.revokeObjectURL(activePdfObjectUrl);
      activePdfObjectUrl = null;
    }
  }

  async function recordResourceView(resourceId) {
    if (!currentUserId || !resourceId) return;

    try {
      const { error } = await client.rpc('record_resource_view', {
        resource_id_input: resourceId,
        source_page_input: 'undergraduates'
      });

      if (error) {
        // View tracking must never prevent a student from reading a resource.
        console.warn('Clariva resource-view tracking was unavailable:', error);
      }
    } catch (error) {
      console.warn('Clariva resource-view tracking error:', error);
    }
  }

  async function openResource(resource, button) {
    if (!resource.file_url) {
      setLibraryStatus('This resource does not have an attached file.', 'error');
      return;
    }

    const fileName = resource.file_name || '';
    const isPdf = fileName.toLowerCase().endsWith('.pdf') ||
      String(resource.resource_type || '').toLowerCase().includes('pdf');

    if (!isPdf) {
      setLibraryStatus('This resource format is not yet supported by the in-page viewer.', 'error');
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing viewer…';

    try {
      // Storage RLS independently verifies the signed-in student's level.
      let documentUrl = null;
      if (!navigator.onLine) {
        const cached = await getOfflineDocument(resource.id);
        if (!cached?.blob) throw new Error('This resource is not saved for offline reading on this device.');
        activePdfObjectUrl = URL.createObjectURL(cached.blob);
        documentUrl = activePdfObjectUrl;
      } else {
        try {
          const { data, error } = await client.storage.from(BUCKET_NAME)
            .createSignedUrl(resource.file_url, SIGNED_URL_TTL_SECONDS);
          if (error) throw error;
          if (!data?.signedUrl) throw new Error('Supabase did not return a secure file link.');
          documentUrl = data.signedUrl;
        } catch (onlineError) {
          const cached = await getOfflineDocument(resource.id);
          if (!cached?.blob) throw onlineError;
          activePdfObjectUrl = URL.createObjectURL(cached.blob);
          documentUrl = activePdfObjectUrl;
          setLibraryStatus('The connection is unavailable. Opening the saved offline copy.', 'info');
        }
      }

      await showPdfReader(documentUrl, resource.title || fileName);
      if (navigator.onLine) await recordResourceView(resource.id);
    } catch (error) {
      console.error('Clariva resource opening error:', error);
      setLibraryStatus(
        window.clarivaFriendlyError?.(error, 'Unable to open this resource. Try again.') || 'Unable to open this resource. Try again.',
        'error'
      );
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function initializePdfReaderControls() {
    getElement('pdf-reader-close')?.addEventListener('click', closePdfReader);
    const goToPreviousPage = async () => {
      if (activePdf && activePdfPage > 1) { activePdfPage -= 1; await renderPdfPage(); }
    };
    const goToNextPage = async () => {
      if (activePdf && activePdfPage < activePdf.numPages) { activePdfPage += 1; await renderPdfPage(); }
    };
    getElement('pdf-reader-overlay-prev')?.addEventListener('click', goToPreviousPage);
    getElement('pdf-reader-overlay-next')?.addEventListener('click', goToNextPage);
    getElement('pdf-reader-prev')?.addEventListener('click', async () => {
      if (activePdf && activePdfPage > 1) {
        activePdfPage -= 1;
        await renderPdfPage();
      }
    });
    getElement('pdf-reader-next')?.addEventListener('click', async () => {
      if (activePdf && activePdfPage < activePdf.numPages) {
        activePdfPage += 1;
        await renderPdfPage();
      }
    });
    getElement('pdf-reader-zoom-in')?.addEventListener('click', async () => {
      pdfScale = Math.min(2, pdfScale + 0.15);
      await renderPdfPage();
    });
    getElement('pdf-reader-zoom-out')?.addEventListener('click', async () => {
      pdfScale = Math.max(0.6, pdfScale - 0.15);
      await renderPdfPage();
    });
    document.addEventListener('keydown', event => {
      if (getElement('pdf-reader').hidden) return;
      if (event.key === 'Escape') closePdfReader();
      if (event.key === 'ArrowLeft' && activePdfPage > 1) {
        activePdfPage -= 1;
        renderPdfPage();
      }
      if (event.key === 'ArrowRight' && activePdf && activePdfPage < activePdf.numPages) {
        activePdfPage += 1;
        renderPdfPage();
      }
    });
    window.addEventListener('resize', () => {
      if (!getElement('pdf-reader').hidden && activePdf) renderPdfPage();
    });
  }

  async function loadResources() {
    setLibraryStatus('Loading your resource library...');

    try {
      // Reuse the shared client initialized by script.js. Creating another
      // client with the same auth storage key can trigger GoTrueClient warnings.
      if (typeof supabaseClient === 'undefined' || !supabaseClient) {
        throw new Error('The shared authentication service is unavailable. Please refresh the page.');
      }

      client = supabaseClient;

      if (window.clarivaOfflineMode === true) {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const offlineUser = sessionData?.session?.user;
        const cachedProfile = window.clarivaCachedProfile;
        if (!offlineUser || !cachedProfile || cachedProfile.Verified !== true ||
            String(cachedProfile.Role || '').toLowerCase() !== 'student') {
          throw new Error('Offline access is available only for a previously verified student account on this device.');
        }
        currentUserId = offlineUser.id;
        currentUserRole = 'student';
        const offlineLevel = Number.parseInt(cachedProfile.Level, 10);
        if (!Number.isInteger(offlineLevel) || offlineLevel <= 0) {
          throw new Error('Your saved academic profile is unavailable for offline access.');
        }
        resources = await getOfflineResourcesForUser(currentUserId);
        populateResourceTypeFilter();
        updateLevelChoices(offlineLevel);
        setLibraryStatus(resources.length
          ? 'Offline library: showing ' + resources.length + ' PDF resource' + (resources.length === 1 ? '' : 's') + ' saved for this account on this device.'
          : 'No PDF resources have been saved for offline reading on this device yet.');
        return;
      }

      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;

      const user = userData?.user;
      currentUserId = user?.id || null;
      if (!user) {
        window.location.replace('index.html#step-1');
        return;
      }

      const { data: profile, error: profileError } = await client
        .from('students')
        .select('Level, Verified, Role')
        .eq('user_id', user.id)
        .single();

      if (profileError || !profile) {
        throw new Error('Your student profile could not be verified. Please sign in again.');
      }

      const role = String(profile.Role || '').toLowerCase();
      const isPrivileged = ['admin', 'owner'].includes(role);
      if (profile.Verified !== true || (role !== 'student' && !isPrivileged)) {
        window.location.replace('index.html#step-1');
        return;
      }

      const studentLevel = Number.parseInt(profile.Level, 10);
      currentUserRole = role;
      if (!Number.isInteger(studentLevel) || studentLevel <= 0) {
        throw new Error('Your academic level is missing from your profile. Please contact an administrator.');
      }

      // Students can revisit their current level and any earlier level.
      // RLS independently enforces the same rule for both metadata and files.
      const resourceQuery = client
        .from('Resources')
        .select('id, title, description, department, level, semester, course_code, course_title, resource_type, file_url, file_name, file_size, featured, created_at')
        .eq('visibility', true)
        .lte('level', studentLevel);

      const { data, error } = await resourceQuery
        .order('featured', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      resources = data || [];
      populateResourceTypeFilter();
      updateLevelChoices(studentLevel);

      setLibraryStatus(
        resources.length
          ? `Showing ${resources.length} published resource${resources.length === 1 ? '' : 's'} from Level 100 through Level ${studentLevel}. Choose an academic level, then a semester.`
          : `No published resources are available for Level 100 through Level ${studentLevel} yet.`
      );
    } catch (error) {
      console.error('Clariva Resource Library loading error:', error);
      setLibraryStatus(
        window.clarivaFriendlyError?.(error, 'Unable to load resources. Refresh and try again.') || 'Unable to load resources. Refresh and try again.',
        'error'
      );
    }
  }

  function initializeResourceLibrary() {
    const search = getElement('resource-search');
    const filter = getElement('resource-type-filter');

    search?.addEventListener('input', renderResources);
    filter?.addEventListener('change', renderResources);
    initializeSemesterNavigation();
    initializePdfReaderControls();

    loadResources();
  }

  const ready = window.clarivaPageReady;
  if (ready && typeof ready.then === 'function') {
    ready.then(() => initializeResourceLibrary()).catch(error => {
      console.error('Student library initialization was blocked:', error);
    });
  } else {
    void initializeResourceLibrary();
  }
})();
