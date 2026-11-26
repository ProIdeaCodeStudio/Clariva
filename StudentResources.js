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
  let activeSemester = null;
  let pdfHistoryEntryActive = false;
  let offlineDbPromise = null;
  let activePdfObjectUrl = null;
  let activePdf = null;
  let activePdfPage = 1;
  let pdfScale = 1;
  let pdfRenderTask = null;

  const getElement = id => document.getElementById(id);

  function requireAcademicLevelConfirmation(level) {
    return new Promise(resolve => {
      let overlay = document.getElementById('clariva-academic-confirmation');
      if (!overlay) {
        const style = document.createElement('style');
        style.id = 'clariva-academic-confirmation-style';
        style.textContent = `
          #clariva-academic-confirmation{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:16px;background:rgba(17,16,8,.76);overflow:auto}
          #clariva-academic-confirmation[hidden]{display:none}
          #clariva-academic-confirmation .clariva-academic-card{width:min(540px,100%);max-height:94vh;overflow:auto;padding:clamp(20px,5vw,30px);border:1px solid #d8c9a8;border-radius:16px;background:#fffaf0;color:#211b12;font:14px/1.5 system-ui,sans-serif}
          #clariva-academic-confirmation h2{margin:0 0 10px;font:700 25px/1.2 Georgia,serif}
          #clariva-academic-confirmation p{margin:0 0 14px}
          #clariva-academic-confirmation .academic-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
          #clariva-academic-confirmation label{display:grid;gap:5px;font-weight:600;font-size:12px}
          #clariva-academic-confirmation select{width:100%;min-height:43px;padding:8px;border:1px solid #cbbd9f;border-radius:8px;background:white;color:#211b12;font:14px system-ui,sans-serif}
          #clariva-academic-confirmation .academic-full{grid-column:1/-1}
          #clariva-academic-confirmation button{width:100%;min-height:46px;margin-top:18px;border:0;border-radius:9px;background:#211b12;color:#fffaf0;font:600 14px system-ui,sans-serif;cursor:pointer}
          #clariva-academic-confirmation button:disabled{opacity:.6;cursor:wait}
          #clariva-academic-confirmation .academic-confirmation-status{min-height:20px;margin:12px 0 0;font-size:13px;color:#8b2c20}
          @media(max-width:420px){#clariva-academic-confirmation .academic-fields{grid-template-columns:1fr}}
        `;
        document.head.appendChild(style);
        overlay = document.createElement('section');
        overlay.id = 'clariva-academic-confirmation';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'clariva-academic-confirmation-title');
        const monthOptions = ['January','February','March','April','May','June','July','August','September','October','November','December']
          .map((name, index) => '<option value="' + (index + 1) + '">' + name + '</option>').join('');
        const year = new Date().getFullYear();
        const yearOptions = Array.from({length: year - 2000 + 11}, (_, index) => 2000 + index)
          .map(value => '<option value="' + value + '">' + value + '</option>').join('');
        overlay.innerHTML = `
          <div class="clariva-academic-card">
            <p class="features-label">One-time account confirmation</p>
            <h2 id="clariva-academic-confirmation-title">Confirm your academic profile</h2>
            <p>Check your current academic level. If this is not your level, select the correct one below. You must also provide the month and year you started this level and your expected completion month and year.</p>
            <div class="academic-fields">
              <label class="academic-full" for="clariva-academic-level-select">Your academic level
                <select id="clariva-academic-level-select">
                  <option value="100">100 Level</option><option value="200">200 Level</option>
                  <option value="300">300 Level</option><option value="400">400 Level</option><option value="500">500 Level</option>
                </select>
              </label>
              <label for="clariva-level-start-month">Started — month<select id="clariva-level-start-month"><option value="">Select month</option>${monthOptions}</select></label>
              <label for="clariva-level-start-year">Started — year<select id="clariva-level-start-year"><option value="">Select year</option>${yearOptions}</select></label>
              <label for="clariva-level-end-month">Expected completion — month<select id="clariva-level-end-month"><option value="">Select month</option>${monthOptions}</select></label>
              <label for="clariva-level-end-year">Expected completion — year<select id="clariva-level-end-year"><option value="">Select year</option>${yearOptions}</select></label>
            </div>
            <button id="clariva-academic-confirm-button" type="button">Confirm academic profile</button>
            <p class="academic-confirmation-status" id="clariva-academic-confirm-status" role="status" aria-live="polite"></p>
          </div>`;
        document.body.appendChild(overlay);
      }

      const levelSelect = overlay.querySelector('#clariva-academic-level-select');
      const button = overlay.querySelector('#clariva-academic-confirm-button');
      const status = overlay.querySelector('#clariva-academic-confirm-status');
      levelSelect.value = String(level);
      status.textContent = '';
      overlay.hidden = false;
      button.disabled = false;
      button.onclick = async () => {
        const startMonth = Number(overlay.querySelector('#clariva-level-start-month').value);
        const startYear = Number(overlay.querySelector('#clariva-level-start-year').value);
        const endMonth = Number(overlay.querySelector('#clariva-level-end-month').value);
        const endYear = Number(overlay.querySelector('#clariva-level-end-year').value);
        if (!startMonth || !startYear || !endMonth || !endYear) {
          status.textContent = 'Select both the start date and expected completion date.';
          return;
        }
        if (new Date(startYear, startMonth - 1, 1) > new Date(endYear, endMonth - 1, 1)) {
          status.textContent = 'Expected completion cannot be earlier than the level start date.';
          return;
        }
        button.disabled = true;
        status.textContent = 'Saving your academic profile…';
        try {
          const selectedLevel = levelSelect.value;
          const { data: confirmedAt, error } = await client.rpc('confirm_academic_level', {
            p_level: selectedLevel,
            p_start_month: startMonth,
            p_start_year: startYear,
            p_expected_completion_month: endMonth,
            p_expected_completion_year: endYear
          });
          if (error) throw error;
          if (window.clarivaCachedProfile) {
            Object.assign(window.clarivaCachedProfile, {
              Level: selectedLevel,
              academic_level_confirmed_at: confirmedAt || new Date().toISOString(),
              academic_level_started_month: startMonth,
              academic_level_started_year: startYear,
              expected_level_completion_month: endMonth,
              expected_level_completion_year: endYear
            });
          }
          try {
            const cacheKey = 'clariva-offline-profile-v1:' + currentUserId;
            const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
            if (cached) {
              Object.assign(cached, {
                Level: selectedLevel,
                academic_level_confirmed_at: confirmedAt || new Date().toISOString(),
                academic_level_started_month: startMonth,
                academic_level_started_year: startYear,
                expected_level_completion_month: endMonth,
                expected_level_completion_year: endYear,
                cachedAt: Date.now()
              });
              localStorage.setItem(cacheKey, JSON.stringify(cached));
            }
          } catch (cacheError) {
            console.warn('Clariva could not refresh the offline confirmation cache:', cacheError);
          }
          try {
            const { data: courseRepAccess } = await client.rpc('is_active_course_rep');
            window.clarivaIsCourseRep = courseRepAccess === true;
            if (window.clarivaIsCourseRep) {
              const { data: permissions, error: permissionsError } = await client.rpc('get_active_course_rep_permissions');
              window.clarivaCourseRepPermissions = !permissionsError && Array.isArray(permissions) ? permissions : [];
              window.clarivaIsCourseRep = window.clarivaCourseRepPermissions.length > 0;
              const courseRepLink = getElement('clariva-course-rep-dashboard-link');
              if (courseRepLink) courseRepLink.hidden = !window.clarivaIsCourseRep;
            }
          } catch (courseRepError) {
            console.warn('Clariva course representative access refresh failed:', courseRepError);
          }
          overlay.hidden = true;
          resolve(selectedLevel);
        } catch (error) {
          console.error('Clariva academic-level confirmation error:', error);
          status.textContent = window.clarivaFriendlyError?.(error, error.message || 'Your academic profile could not be saved. Please try again.') || error.message || 'Your academic profile could not be saved. Please try again.';
          button.disabled = false;
        }
      };
    });
  }

  function setLibraryStatus(message, state = 'info') {
    const savedStatus = getElement('saved-offline-section') && !getElement('saved-offline-section').hidden
      ? getElement('saved-offline-status') : null;
    const status = savedStatus || getElement('student-library-status');
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
      let result = null;
      request.onsuccess = () => { result = request.result || null; };
      request.onerror = () => reject(request.error || new Error('Offline save could not be checked.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Offline save could not be checked.'));
      transaction.onabort = () => reject(transaction.error || new Error('Offline save lookup was interrupted.'));
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

  async function saveResourceOffline(resource, button) {
    if (!currentUserId || !['student', 'admin', 'owner'].includes(currentUserRole)) {
      setLibraryStatus('Offline Saves are available to verified accounts.', 'error');
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
      // Download the Storage object directly. This does not depend on the PDF
      // having been opened first or on a previously generated viewer URL.
      const storagePath = String(resource.file_url || '').trim();
      if (!storagePath) throw new Error('This resource does not have a downloadable file.');
      const { data: blob, error } = await client.storage.from(BUCKET_NAME).download(storagePath);
      if (error) throw error;
      if (!(blob instanceof Blob) || !blob.size) {
        throw new Error('The document download was empty or incomplete. Please try again.');
      }
      await writeOfflineDocument(resource, blob);
      if (currentUserRole === 'student') {
        const { error: saveError } = await client.rpc('save_offline_resource', {
          resource_id_input: resource.id
        });
        if (saveError) {
          await deleteOfflineDocument(resource.id);
          throw saveError;
        }
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
      if (currentUserRole === 'student') {
        const { error } = await client.rpc('remove_offline_resource_save', {
          resource_id_input: resource.id
        });
        if (error) throw error;
      }
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
    openButton.disabled = false;
    openButton.addEventListener('click', () => openResource(resource, openButton));

    card.appendChild(openButton);

    const isPdfResource = String(resource.file_name || '').toLowerCase().endsWith('.pdf') ||
      String(resource.resource_type || '').toLowerCase().includes('pdf');
    if (['student', 'admin', 'owner'].includes(currentUserRole) && isPdfResource && resource.id) {
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
        offlineButton.textContent = saved
          ? (navigator.onLine ? 'Saved offline · Remove' : 'Saved offline')
          : 'Save for offline';
        offlineButton.disabled = !navigator.onLine;
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

  function saveLibraryViewState() {
    try {
      sessionStorage.setItem('clariva-library-view-v1', JSON.stringify({
        level: activeLevel,
        semester: activeSemester
      }));
    } catch (_) {}
  }

  function restoreLibraryViewState() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('clariva-library-view-v1') || 'null'); } catch (_) {}
    if (!saved || !resources.some(resource => Number(resource.level) === Number(saved.level))) return;
    openLevel(saved.level);
    if ([1, 2].includes(Number(saved.semester))) openSemester(saved.semester);
  }

  function openLevel(level, trigger = null) {
    const safeLevel = Number(level);
    if (!resources.some(resource => Number(resource.level) === safeLevel)) return;
    activeLevel = safeLevel;
    activeSemester = null;
    saveLibraryViewState();
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
    saveLibraryViewState();
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
      saveLibraryViewState();
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
    saveLibraryViewState();
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

  function showPdfInOfflineFrame(documentUrl, title) {
    const reader = getElement('pdf-reader');
    const message = getElement('pdf-reader-message');
    const canvas = getElement('pdf-reader-canvas');
    const offlineFrame = getElement('pdf-reader-offline-frame');
    if (pdfRenderTask) {
      try { pdfRenderTask.cancel(); } catch (_) {}
      pdfRenderTask = null;
    }
    if (activePdf) {
      try { activePdf.destroy(); } catch (_) {}
      activePdf = null;
    }
    reader.hidden = false;
    document.body.classList.add('pdf-reader-open');
    getElement('pdf-reader-title').textContent = title || 'Learning resource';
    message.hidden = true;
    canvas.hidden = true;
    offlineFrame.hidden = false;
    offlineFrame.src = documentUrl;
    activePdfPage = 1;
    updatePdfControls();
  }

  async function showPdfReader(documentUrl, title) {
    const reader = getElement('pdf-reader');
    const message = getElement('pdf-reader-message');
    const canvas = getElement('pdf-reader-canvas');
    const offlineFrame = getElement('pdf-reader-offline-frame');
    const isLocalBlob = String(documentUrl).startsWith('blob:');

    if (!window.pdfjsLib && !isLocalBlob) {
      throw new Error('The document viewer could not be loaded. Please refresh and try again.');
    }
    if (!pdfHistoryEntryActive) {
      history.pushState({ ...(history.state || {}), clarivaPdfReader: true }, '', window.location.href);
      pdfHistoryEntryActive = true;
    }
    if (!window.pdfjsLib && isLocalBlob) {
      showPdfInOfflineFrame(documentUrl, title);
      return;
    }

    offlineFrame.hidden = true;
    offlineFrame.removeAttribute('src');
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
      const source = isLocalBlob
        ? { data: new Uint8Array(await (await fetch(documentUrl)).arrayBuffer()) }
        : { url: documentUrl };
      activePdf = await window.pdfjsLib.getDocument({
        ...source,
        disableAutoFetch: false,
        disableStream: false,
        disableRange: false,
        rangeChunkSize: 65536
      }).promise;
      await renderPdfPage();
    } catch (error) {
      if (isLocalBlob) {
        // A saved PDF must remain readable when the PDF.js worker is unavailable offline.
        showPdfInOfflineFrame(documentUrl, title);
        return;
      }
      closePdfReader();
      throw new Error('This PDF could not be displayed in Clariva. Please try again later.');
    }
  }

  function closePdfReader(fromPopState = false) {
    const reader = getElement('pdf-reader');
    if (!fromPopState && pdfHistoryEntryActive && history.state?.clarivaPdfReader) {
      history.back();
      return;
    }
    pdfHistoryEntryActive = false;
    if (pdfRenderTask) {
      try { pdfRenderTask.cancel(); } catch (_) {}
      pdfRenderTask = null;
    }
    if (activePdf) {
      activePdf.destroy();
      activePdf = null;
    }
    reader.hidden = true;
    const offlineFrame = getElement('pdf-reader-offline-frame');
    if (offlineFrame) { offlineFrame.hidden = true; offlineFrame.removeAttribute('src'); }
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
    const fileName = resource.file_name || '';
    const cachedCopy = await getOfflineDocument(resource.id).catch(() => null);
    if (!resource.file_url && !cachedCopy?.blob) {
      setLibraryStatus('This resource does not have an attached file.', 'error');
      return;
    }
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
      if (cachedCopy?.blob) {
        if (activePdfObjectUrl) URL.revokeObjectURL(activePdfObjectUrl);
        activePdfObjectUrl = URL.createObjectURL(cachedCopy.blob);
        documentUrl = activePdfObjectUrl;
      } else if (!navigator.onLine) {
        throw new Error('This resource is not saved for offline reading on this device.');
      } else {
        try {
          if (!client) throw new Error('Connect to the internet and sign in to retrieve this resource.');
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
      if (navigator.onLine && !cachedCopy?.blob) await recordResourceView(resource.id);
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
    getElement('pdf-reader-close')?.addEventListener('click', () => closePdfReader());
    window.addEventListener('popstate', () => {
      if (!getElement('pdf-reader')?.hidden) closePdfReader(true);
      else pdfHistoryEntryActive = false;
    });
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
      const savedView = new URLSearchParams(window.location.search).get('saved') === '1';
      if (window.clarivaOfflineMode === true) {
        const offlineUser = window.clarivaOfflineUser;
        const cachedProfile = window.clarivaCachedProfile;
        const role = String(cachedProfile?.Role || '').toLowerCase();
        if (!offlineUser?.id || cachedProfile?.Verified !== true || !['student', 'admin', 'owner'].includes(role) || (role === 'student' && !cachedProfile?.academic_level_confirmed_at)) {
          throw new Error('Offline access requires a previously verified account on this device.');
        }
        currentUserId = offlineUser.id;
        currentUserRole = role;
        document.querySelector('.student-library-section')?.setAttribute('hidden', '');
        getElement('saved-offline-section').hidden = false;
        resources = await getOfflineResourcesForUser(currentUserId);
        renderResourceCards(getElement('saved-offline-resources'), resources, 'No PDF resources have been saved on this device yet.');
        getElement('saved-offline-status').textContent = resources.length
          ? resources.length + ' saved PDF resource' + (resources.length === 1 ? '' : 's') + ' available offline.'
          : 'No PDF resources have been saved for offline reading on this device yet.';
        return;
      }

      if (typeof supabaseClient === 'undefined' || !supabaseClient) {
        throw new Error('The shared authentication service is unavailable. Please refresh the page.');
      }
      client = supabaseClient;
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
        .select('Level, Verified, Role, academic_level_confirmed_at')
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

      currentUserRole = role;
      if (role === 'student' && !profile.academic_level_confirmed_at) {
        const storedLevel = String(profile.Level || '');
        if (!['100', '200', '300', '400', '500'].includes(storedLevel)) {
          throw new Error('Your academic level is missing or invalid. Please contact a Clariva administrator.');
        }
        const confirmed = await requireAcademicLevelConfirmation(storedLevel);
        if (!confirmed) return;
        profile.Level = confirmed;
      }
      if (savedView) {
        document.querySelector('.student-library-section')?.setAttribute('hidden', '');
        getElement('saved-offline-section').hidden = false;
        resources = await getOfflineResourcesForUser(currentUserId);
        renderResourceCards(getElement('saved-offline-resources'), resources, 'No PDF resources have been saved on this device yet.');
        getElement('saved-offline-status').textContent = resources.length
          ? resources.length + ' saved PDF resource' + (resources.length === 1 ? '' : 's') + ' stored on this device.'
          : 'No PDF resources have been saved for offline reading on this device yet.';
        return;
      }
      const studentLevel = isPrivileged ? 500 : Number.parseInt(profile.Level, 10);
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
      restoreLibraryViewState();

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
