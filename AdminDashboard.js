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

  const ALLOWED_TYPES = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx']
  };

  let resources = [];

  function getElement(id) {
    return document.getElementById(id);
  }

  function setStatus(message, type = 'info') {
    const status = getElement('resource-upload-status');
    if (!status) return;

    status.textContent = message;
    status.dataset.state = type;
  }

  function setUploading(isUploading) {
    const button = getElement('resource-upload-button');
    if (!button) return;

    button.disabled = isUploading;
    button.textContent = isUploading ? 'Uploading...' : 'Upload Resource';
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
        list.appendChild(
          document.createTextNode(
            'Try changing your search or filter selections.'
          )
        );
      }

      return;
    }

    list.className = 'admin-resource-list';

    const resultCount = createTextElement(
      'p',
      'admin-muted',
      `Showing ${filteredResources.length} of ${resources.length} resources`
    );

    list.appendChild(resultCount);

    filteredResources.forEach(resource => {
      const card = document.createElement('article');

      card.className = 'admin-panel';
      card.style.marginBottom = '16px';
      card.style.padding = '20px';

      const title = createTextElement(
        'h3',
        '',
        resource.title || 'Untitled resource'
      );

      title.style.color = 'var(--deep-ink)';
      title.style.marginBottom = '8px';

      card.appendChild(title);

      const course = [
        resource.course_code,
        resource.course_title
      ].filter(Boolean).join(' — ');

      if (course) {
        card.appendChild(
          createTextElement('p', 'admin-muted', course)
        );
      }

      if (resource.description) {
        card.appendChild(
          createTextElement('p', 'admin-muted', resource.description)
        );
      }

      const details = [
        resource.department,
        resource.level ? `${resource.level} Level` : null,
        resource.semester
          ? `Semester ${resource.semester}`
          : null,
        resource.resource_type,
        resource.file_name,
        formatFileSize(resource.file_size),
        `Downloads: ${Number(resource.download_count || 0)}`,
        `Uploaded: ${formatDate(resource.created_at)}`
      ].filter(Boolean);

      const metadata = createTextElement(
        'p',
        'admin-muted',
        details.join(' • ')
      );

      card.appendChild(metadata);

      const statusDetails = [];

      statusDetails.push(
        resource.visibility === false ? 'Hidden' : 'Visible'
      );

      if (resource.featured) {
        statusDetails.push('Featured');
      }

      card.appendChild(
        createTextElement(
          'p',
          'admin-muted',
          statusDetails.join(' • ')
        )
      );

      const actions = document.createElement('div');
      actions.className = 'admin-actions';

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'admin-button';
      openButton.textContent = 'Open File';

      openButton.addEventListener('click', () => {
        openResourceFile(resource, openButton);
      });

      actions.appendChild(openButton);
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

    button.disabled = true;
    button.textContent = 'Preparing file...';

    try {
      const { data, error } = await supabaseClient
        .storage
        .from(BUCKET_NAME)
        .createSignedUrl(resource.file_url, 300);

      if (error) {
        throw error;
      }

      if (!data?.signedUrl) {
        throw new Error('Supabase did not return a file link.');
      }

      const openedWindow = window.open(
        data.signedUrl,
        '_blank',
        'noopener,noreferrer'
      );

      if (!openedWindow) {
        window.location.href = data.signedUrl;
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

  async function uploadResource(event) {
    event.preventDefault();

    const form = getElement('resource-upload-form');

    if (!form) return;
    if (!form.reportValidity()) return;

    const fileInput = getElement('resource-file');
    const file = fileInput?.files?.[0];

    let uploadedPath = null;

    setUploading(true);
    setStatus('Checking your account and validating the document...');

    try {
      validateFile(file);

      const user = await getAuthorizedUploader();

      const title = getElement('resource-title').value.trim();
      const description = getElement('resource-description').value.trim();
      const department = getElement('resource-department').value.trim();
      const level = Number(getElement('resource-level').value);
      const semester = Number(getElement('resource-semester').value);
      const courseCode = getElement('resource-course-code').value.trim();
      const courseTitle = getElement('resource-course-title').value.trim();
      const resourceType = getElement('resource-type').value;

      if (!title || !level || !semester || !resourceType) {
        throw new Error('Please complete all required resource details.');
      }

      const safeName = sanitizeFileName(file.name);
      const uniqueName = `${crypto.randomUUID()}-${safeName}`;
      const storagePath = `resources/${level}/${semester}/${uniqueName}`;

      setStatus('Uploading document to secure storage...');

      const { error: uploadError } = await supabaseClient
        .storage
        .from(BUCKET_NAME)
        .upload(storagePath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false
        });

      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      uploadedPath = storagePath;

      setStatus('Document uploaded. Saving resource details...');

      const resourceRecord = {
        title,
        description: description || null,
        department: department || null,
        level,
        semester,
        course_code: courseCode || null,
        course_title: courseTitle || null,
        resource_type: resourceType,
        file_url: storagePath,
        file_name: file.name,
        file_size: file.size,
        uploaded_by: user.id,
        visibility: true,
        featured: false
      };

      const { error: insertError } = await supabaseClient
        .from('Resources')
        .insert(resourceRecord);

      if (insertError) {
        throw new Error(
          `Resource details could not be saved: ${insertError.message}`
        );
      }

      uploadedPath = null;

      form.reset();

      setStatus('Resource uploaded successfully. Refreshing the resource list...', 'success');

      await loadResources();

      setStatus('Resource uploaded successfully.', 'success');

      document.dispatchEvent(
        new CustomEvent('clariva:resource-uploaded')
      );

    } catch (error) {
      console.error('Clariva resource upload error:', error);

      if (uploadedPath) {
        const { error: cleanupError } = await supabaseClient
          .storage
          .from(BUCKET_NAME)
          .remove([uploadedPath]);

        if (cleanupError) {
          console.error('Uploaded file cleanup failed:', cleanupError);
        }
      }

      setStatus(
        error.message || 'An unexpected upload error occurred.',
        'error'
      );

    } finally {
      setUploading(false);
    }
  }

  /* ============================================================
     DASHBOARD INITIALIZATION
     ============================================================ */

  function initializeAdminDashboard() {
    const form = getElement('resource-upload-form');

    if (form && form.dataset.uploadHandlerAttached !== 'true') {
      form.addEventListener('submit', uploadResource);
      form.dataset.uploadHandlerAttached = 'true';
    }

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
  }

  window.addEventListener(
  'load',
  initializeAdminDashboard
);
})();
