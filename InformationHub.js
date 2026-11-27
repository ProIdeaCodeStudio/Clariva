(() => {
  'use strict';

  const views = {
    author: {
      label: 'About the Author',
      html: `
        <p class="features-label">The person behind Clariva</p>
        <h1>Built with purpose.<br>Driven by possibility.</h1>
        <div class="leadership-role">FOUNDER &amp; CHIEF EXECUTIVE OFFICER</div>
        <h2>Promise Olutola</h2>
        <p>Promise Olutola is a Nigerian student founder and multidisciplinary creative working at the intersection of engineering, design, and digital technology. As Founder and CEO of Clariva, he is guided by a simple conviction: the right learning resources can make academic progress clearer and more achievable.</p>
        <p>He approaches ideas with curiosity and an engineering mindset—questioning assumptions, exploring possibilities independently, and connecting different disciplines to build practical solutions. He is also the founder of Pro Idea, a creative venture focused on brand identity and digital communication.</p>
        <p>Currently studying Electrical and Electronics Engineering at the Federal University of Technology, Akure (FUTA), Promise continues to develop Clariva around clarity, accessibility, and the needs of students.</p>`
    },
    about: {
      label: 'About Clariva',
      html: `
        <p class="features-label">About Clariva</p>
        <h1>A clearer way to learn.</h1>
        <p>Clariva is an educational platform built to help undergraduate students find and use academic learning resources with greater clarity. It brings together curated study materials, past questions, CBT practice, and AI-assisted study support in one accessible learning environment.</p>
        <p>Designed around the needs of students, Clariva organises resources by academic level, semester, course, and resource type. Its goal is to make useful learning materials easier to discover, understand, and revisit throughout a student's academic journey.</p>`
    },
    contact: {
      label: 'Contact',
      html: `
        <p class="features-label">Get in touch</p>
        <h1>Contact Clariva</h1>
        <p>For enquiries about Clariva, its resources, partnerships, or technical assistance, use the contact channels below.</p>
        <div class="clariva-info-contact-list">
          <a href="mailto:Proidea2025@gmail.com">Email: Proidea2025@gmail.com</a>
          <a href="https://wa.me/2349133264060" target="_blank" rel="noopener noreferrer">WhatsApp: 09133240600</a>
        </div>`
    }
  };

  let overlay;
  let content;
  let activeView = null;
  let previousOverflow = '';
  let lastFocusedElement = null;

  function buildHub() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'clariva-info-overlay';
    overlay.id = 'clariva-information-hub';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="clariva-info-dialog" role="dialog" aria-modal="true"
        aria-labelledby="clariva-info-title" tabindex="-1">
        <div class="clariva-info-topbar">
          <div class="clariva-info-brand" id="clariva-info-title">Clariva Information</div>
          <button class="clariva-info-close" type="button" aria-label="Close information panel">×</button>
        </div>
        <nav class="clariva-info-tabs" aria-label="Clariva information">
          <button type="button" data-view="author">About the Author</button>
          <button type="button" data-view="about">About Clariva</button>
          <button type="button" data-view="contact">Contact</button>
        </nav>
        <div class="clariva-info-content" aria-live="polite"></div>
      </section>`;
    document.body.appendChild(overlay);
    content = overlay.querySelector('.clariva-info-content');
    overlay.querySelector('.clariva-info-close').addEventListener('click', closeHub);
    overlay.querySelectorAll('[data-view]').forEach(button => {
      button.addEventListener('click', () => showView(button.dataset.view, true));
    });
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeHub();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !overlay.hidden) closeHub();
    });
  }

  function showView(view, updateHistory) {
    if (!views[view]) view = 'about';
    buildHub();
    activeView = view;
    content.innerHTML = views[view].html;
    overlay.querySelectorAll('[data-view]').forEach(button => {
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (updateHistory) {
      const state = { ...(history.state || {}), clarivaInfoHub: true, clarivaInfoView: view };
      history.replaceState(state, '', location.href);
    }
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    overlay.querySelector('.clariva-info-dialog').focus({ preventScroll: true });
  }

  function openHub(view, trigger) {
    buildHub();
    if (overlay.hidden) {
      const sourceMenu = trigger?.closest('nav');
      lastFocusedElement = sourceMenu?.id === 'clariva-landing-menu'
        ? document.getElementById('clariva-landing-menu-toggle')
        : sourceMenu?.id === 'clariva-nav-menu'
          ? document.getElementById('clariva-menu-toggle')
          : trigger || document.activeElement;
      history.pushState({ ...(history.state || {}), clarivaInfoHub: true, clarivaInfoView: view }, '', location.href);
      previousOverflow = document.body.style.overflow;
      showView(view, false);
    } else {
      showView(view, true);
    }
  }

  function hideHub() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    activeView = null;
    document.body.style.overflow = previousOverflow;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus({ preventScroll: true });
    }
    lastFocusedElement = null;
  }

  function closeHub() {
    if (history.state?.clarivaInfoHub) history.back();
    else hideHub();
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-clariva-info]');
    if (!trigger) return;
    event.preventDefault();
    const menu = trigger.closest('nav');
    if (menu?.id === 'clariva-landing-menu') {
      menu.hidden = true;
      document.getElementById('clariva-landing-menu-toggle')?.setAttribute('aria-expanded', 'false');
    } else if (menu?.id === 'clariva-nav-menu') {
      menu.hidden = true;
      document.getElementById('clariva-menu-toggle')?.setAttribute('aria-expanded', 'false');
    }
    openHub(trigger.dataset.clarivaInfo, trigger);
  });

  window.addEventListener('popstate', event => {
    if (event.state?.clarivaInfoHub) {
      if (overlay?.hidden) {
        previousOverflow = document.body.style.overflow;
        showView(event.state.clarivaInfoView || activeView || 'about', false);
      } else {
        showView(event.state.clarivaInfoView || activeView || 'about', false);
      }
    } else {
      hideHub();
    }
  });
})();
