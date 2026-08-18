(function () {
  'use strict';

  var STORAGE_KEY = 'prompts';
  var THEME_KEY = 'theme';
  var PREVIEW_WORDS = 12;
  var MAX_RATING = 5;

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
      return Array.isArray(parsed) ? parsed.map(withRating) : [];
    } catch (err) {
      return [];
    }
  }

  /* Prompts saved before ratings existed have no `rating` — read them as 0
     rather than migrating storage. */
  function withRating(prompt) {
    var rating = Math.round(prompt.rating);
    if (!(rating >= 1 && rating <= MAX_RATING)) rating = 0;
    prompt.rating = rating;
    return prompt;
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

  /* ---------- Rating ---------- */

  function createStar(prompt, value, wrap) {
    var star = document.createElement('button');
    star.type = 'button';
    star.className = 'star';
    star.setAttribute('role', 'radio');
    star.setAttribute('aria-label', value + (value === 1 ? ' star' : ' stars'));

    star.addEventListener('click', function () {
      setRating(prompt, prompt.rating === value ? 0 : value, wrap);
    });
    star.addEventListener('mouseenter', function () {
      paintStars(wrap, value);
    });

    return star;
  }

  function createRating(prompt) {
    var wrap = document.createElement('div');
    wrap.className = 'rating';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'Rate this prompt');

    for (var value = 1; value <= MAX_RATING; value++) {
      wrap.appendChild(createStar(prompt, value, wrap));
    }

    wrap.addEventListener('mouseleave', function () {
      paintStars(wrap, prompt.rating);
    });
    wrap.addEventListener('keydown', function (event) {
      handleRatingKeys(event, prompt, wrap);
    });

    syncRating(wrap, prompt.rating);
    return wrap;
  }

  /* Fill stars up to `upTo` — used for hover preview and for reverting. */
  function paintStars(wrap, upTo) {
    var stars = wrap.querySelectorAll('.star');
    for (var i = 0; i < stars.length; i++) {
      var filled = i + 1 <= upTo;
      stars[i].classList.toggle('star-filled', filled);
      stars[i].textContent = filled ? '\u2605' : '\u2606';
    }
  }

  /* Reflect the stored rating: fill, checked state and roving tabindex. */
  function syncRating(wrap, rating) {
    paintStars(wrap, rating);
    var stars = wrap.querySelectorAll('.star');
    for (var i = 0; i < stars.length; i++) {
      var value = i + 1;
      stars[i].setAttribute('aria-checked', String(value === rating));
      stars[i].tabIndex = (value === rating || (rating === 0 && value === 1)) ? 0 : -1;
    }
  }

  function handleRatingKeys(event, prompt, wrap) {
    var next;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.min(MAX_RATING, prompt.rating + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.max(0, prompt.rating - 1);
        break;
      case 'Home':
        next = 1;
        break;
      case 'End':
        next = MAX_RATING;
        break;
      default:
        return;
    }

    event.preventDefault();
    setRating(prompt, next, wrap);
    wrap.querySelectorAll('.star')[next > 0 ? next - 1 : 0].focus();
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
    card.appendChild(createRating(prompt));
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
      content: content,
      rating: 0
    });
    savePrompts(prompts);
    render();
  }

  /* Updates the card in place — a full render() would tear down the star the
     user is hovering or has focused. */
  function setRating(prompt, rating, wrap) {
    prompt.rating = rating;

    var prompts = loadPrompts();
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].id === prompt.id) {
        prompts[i].rating = rating;
        savePrompts(prompts);
        break;
      }
    }

    syncRating(wrap, rating);
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
