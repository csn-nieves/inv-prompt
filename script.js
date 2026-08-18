(function () {
  'use strict';

  const STORAGE_KEY = 'promptLibrary.prompts.v1';
  const THEME_KEY = 'promptLibrary.theme';

  const form = document.getElementById('prompt-form');
  const titleInput = document.getElementById('prompt-title');
  const contentInput = document.getElementById('prompt-content');
  const contentCount = document.getElementById('content-count');
  const errorEl = document.getElementById('form-error');
  const listEl = document.getElementById('prompt-list');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('prompt-count');
  const template = document.getElementById('prompt-card-template');
  const themeToggle = document.getElementById('theme-toggle');
  const themeLabel = themeToggle.querySelector('.theme-label');
  const toastEl = document.getElementById('toast');

  /* ---------- Storage ---------- */

  function loadPrompts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.filter(
        (p) => p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.content === 'string'
      );
    } catch (err) {
      console.warn('Could not read saved prompts:', err);
      return [];
    }
  }

  function savePrompts(prompts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
      return true;
    } catch (err) {
      console.error('Could not save prompts:', err);
      showError('Storage is full or unavailable — this prompt was not saved.');
      return false;
    }
  }

  let prompts = loadPrompts();

  /* ---------- Rendering ---------- */

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function createCard(prompt) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = prompt.id;

    card.querySelector('.card-title').textContent = prompt.title;
    card.querySelector('.card-content').textContent = prompt.content;

    const time = card.querySelector('.card-date');
    time.textContent = formatDate(prompt.createdAt);
    time.dateTime = prompt.createdAt;

    card.querySelector('[data-action="delete"]').setAttribute(
      'aria-label',
      `Delete prompt: ${prompt.title}`
    );

    return card;
  }

  function render() {
    listEl.replaceChildren(...prompts.map(createCard));

    const hasPrompts = prompts.length > 0;
    emptyEl.hidden = hasPrompts;
    listEl.hidden = !hasPrompts;
    countEl.textContent = String(prompts.length);
  }

  /* ---------- Feedback ---------- */

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('is-visible'));
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-visible');
      setTimeout(() => { toastEl.hidden = true; }, 200);
    }, 2200);
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  function newId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /* ---------- Create ---------- */

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearError();

    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title && !content) {
      showError('Add a title and prompt content before saving.');
      titleInput.focus();
      return;
    }
    if (!title) {
      showError('Give your prompt a title.');
      titleInput.focus();
      return;
    }
    if (!content) {
      showError('Prompt content cannot be empty.');
      contentInput.focus();
      return;
    }

    const prompt = {
      id: newId(),
      title,
      content,
      createdAt: new Date().toISOString()
    };

    const previous = prompts;
    prompts = [prompt, ...prompts];

    if (!savePrompts(prompts)) {
      prompts = previous;
      return;
    }

    render();
    form.reset();
    updateCharCount();
    titleInput.focus();
    showToast('Prompt saved');
  });

  form.addEventListener('reset', () => {
    clearError();
    setTimeout(updateCharCount, 0);
  });

  /* ---------- Delete & copy ---------- */

  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const card = button.closest('.card');
    const id = card && card.dataset.id;
    const prompt = prompts.find((p) => p.id === id);
    if (!prompt) return;

    if (button.dataset.action === 'delete') {
      if (!window.confirm(`Delete "${prompt.title}"? This cannot be undone.`)) return;

      const previous = prompts;
      prompts = prompts.filter((p) => p.id !== id);

      if (!savePrompts(prompts)) {
        prompts = previous;
        return;
      }

      card.classList.add('is-removing');
      setTimeout(render, 180);
      showToast('Prompt deleted');
      return;
    }

    if (button.dataset.action === 'copy') {
      copyText(prompt.content).then(
        () => showToast('Copied to clipboard'),
        () => showToast('Copy failed')
      );
    }
  });

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      ok ? resolve() : reject(new Error('copy command failed'));
    });
  }

  /* ---------- Character count ---------- */

  function updateCharCount() {
    const length = contentInput.value.length;
    contentCount.textContent = length === 0 ? '0' : `${length} characters`;
  }

  contentInput.addEventListener('input', updateCharCount);

  /* ---------- Theme ---------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeLabel.textContent = theme === 'dark' ? 'Light' : 'Dark';
    themeToggle.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (err) {
      console.warn('Theme preference unavailable:', err);
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light');
  }

  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      console.warn('Could not persist theme:', err);
    }
  });

  /* ---------- Init ---------- */

  initTheme();
  updateCharCount();
  render();
})();
