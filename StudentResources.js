// Clariva student Resource Library
// Student access is restricted by verified account status and academic level.
// Department and semester are descriptive metadata, not access restrictions.

(() => {
  'use strict';

  const BUCKET_NAME = 'clariva-resources';
  const SIGNED_URL_TTL_SECONDS = 300;

  let client = null;
  let resources = [];
  let currentUserId = null;
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

  function createResourceCard(resource) {
    const card = document.createElement('article');
    card.className = 'student-resource-card';

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

  function getFilteredResources() {
    const search = (getElement('resource-search')?.value || '').trim().toLowerCase();
    const type = getElement('resource-type-filter')?.value || '';

    return resources.filter(resource => {
      const matchesSearch = !search || getResourceSearchText(resource).includes(search);
      const matchesType = !type || resource.resource_type === type;
      return matchesSearch && matchesType;
    });
  }

  function renderResources() {
    const filtered = getFilteredResources();
    const featured = filtered.filter(resource => resource.featured === true);

    renderResourceCards(
      getElement('featured-resources'),
      featured,
      'There are no featured resources available at the moment.'
    );

    renderResourceCards(
      getElement('all-resources'),
      filtered,
      resources.length
        ? 'No resources match your search or selected filter.'
        : 'No resources have been published for your level yet.'
    );
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
        disableAutoFetch: true
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
      const { data, error } = await client
        .storage
        .from(BUCKET_NAME)
        .createSignedUrl(resource.file_url, SIGNED_URL_TTL_SECONDS);

      if (error) throw error;
      if (!data?.signedUrl) {
        throw new Error('Supabase did not return a secure file link.');
      }

      await showPdfReader(data.signedUrl, resource.title || fileName);
      await recordResourceView(resource.id);
    } catch (error) {
      console.error('Clariva resource opening error:', error);
      setLibraryStatus(
        error.message || 'Unable to open this resource. Please try again.',
        'error'
      );
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function initializePdfReaderControls() {
    getElement('pdf-reader-close')?.addEventListener('click', closePdfReader);
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
      if (!isPrivileged && (!Number.isInteger(studentLevel) || studentLevel <= 0)) {
        throw new Error('Your academic level is missing from your profile. Please contact an administrator.');
      }

      // Students are limited to their academic level. Verified administrators
      // can inspect all published resources from the student-facing library.
      let resourceQuery = client
        .from('Resources')
        .select('id, title, description, department, level, semester, course_code, course_title, resource_type, file_url, file_name, file_size, featured, created_at')
        .eq('visibility', true);

      if (!isPrivileged) resourceQuery = resourceQuery.eq('level', studentLevel);

      const { data, error } = await resourceQuery
        .order('featured', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      resources = data || [];
      populateResourceTypeFilter();
      renderResources();

      setLibraryStatus(
        isPrivileged
          ? (resources.length
              ? `Administrator view: showing all ${resources.length} published resources.`
              : 'No published resources are available yet.')
          : (resources.length
              ? `Showing ${resources.length} resource${resources.length === 1 ? '' : 's'} for Level ${studentLevel}. Department and semester do not limit your access.`
              : `No published resources are available for Level ${studentLevel} yet.`)
      );
    } catch (error) {
      console.error('Clariva Resource Library loading error:', error);
      setLibraryStatus(
        error.message || 'Unable to load resources. Please refresh the page.',
        'error'
      );
    }
  }

  function initializeResourceLibrary() {
    const search = getElement('resource-search');
    const filter = getElement('resource-type-filter');

    search?.addEventListener('input', renderResources);
    filter?.addEventListener('change', renderResources);
    initializePdfReaderControls();

    loadResources();
  }

  window.addEventListener('load', initializeResourceLibrary, { once: true });
})();
