
/* ============================================================
   CLARIVA — ADMIN DASHBOARD
   Resource upload workflow
   Uses the existing Supabase client from script.js.
   ============================================================ */

(() => {
  'use strict';

  const BUCKET_NAME = 'clariva-resources';
  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const ALLOWED_TYPES = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx']
  };

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
        throw new Error(`Resource details could not be saved: ${insertError.message}`);
      }

      setStatus('Resource uploaded successfully.', 'success');
      form.reset();

      document.dispatchEvent(new CustomEvent('clariva:resource-uploaded'));

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

      setStatus(error.message || 'An unexpected upload error occurred.', 'error');

    } finally {
      setUploading(false);
    }
  }

  function initializeAdminUpload() {
    const form = getElement('resource-upload-form');

    if (!form || form.dataset.uploadHandlerAttached === 'true') {
      return;
    }

    form.addEventListener('submit', uploadResource);
    form.dataset.uploadHandlerAttached = 'true';
  }

  document.addEventListener('DOMContentLoaded', initializeAdminUpload);
})();
 
