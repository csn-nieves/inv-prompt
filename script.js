(function () {
  'use strict';

  var STORAGE_KEY = 'prompts';
  var THEME_KEY = 'theme';
  var PREVIEW_WORDS = 12;

  var form = document.getElementById('prompt-form');
  var titleInput = document.getElementById('prompt-title');
  var contentInput = document.getElementById('prompt-content');
  var listEl = document.getElementById('prompt-list');
  var emptyEl = document.getElementById('empty-state');
  var themeToggle = document.getElementById('theme-toggle');

  /* ---------- Storage ---------- */

  function loadPrompts() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function savePrompts(prompts) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  }

  /* ---------- Rendering ---------- */

  function makePreview(content) {
    var words = content.trim().split(/\s+/);
    if (words.length <= PREVIEW_WORDS) return words.join(' ');
    return words.slice(0, PREVIEW_WORDS).join(' ') + '...';
  }

  function createCard(prompt) {
    var card = document.createElement('article');
    card.className = 'prompt-card';

    var title = document.createElement('h3');
    title.textContent = prompt.title;

    var preview = document.createElement('p');
    preview.className = 'prompt-preview';
    preview.textContent = makePreview(prompt.content);

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function () {
      deletePrompt(prompt.id);
    });

    card.appendChild(title);
    card.appendChild(preview);
    card.appendChild(deleteBtn);
    return card;
  }

  function render() {
    var prompts = loadPrompts();
    listEl.innerHTML = '';
    emptyEl.hidden = prompts.length > 0;

    prompts.forEach(function (prompt) {
      listEl.appendChild(createCard(prompt));
    });
  }

  /* ---------- Actions ---------- */

  function addPrompt(title, content) {
    var prompts = loadPrompts();
    prompts.unshift({
      id: String(Date.now()) + String(Math.random()).slice(2, 8),
      title: title,
      content: content
    });
    savePrompts(prompts);
    render();
  }

  function deletePrompt(id) {
    var prompts = loadPrompts().filter(function (prompt) {
      return prompt.id !== id;
    });
    savePrompts(prompts);
    render();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var title = titleInput.value.trim();
    var content = contentInput.value.trim();
    if (!title || !content) return;

    addPrompt(title, content);
    form.reset();
    titleInput.focus();
  });

  /* ---------- Theme ---------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
    localStorage.setItem(THEME_KEY, theme);
  }

  function initTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
      applyTheme(saved);
      return;
    }
    var prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }

  themeToggle.addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  initTheme();
  render();
})();
