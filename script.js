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
      return Array.isArray(parsed) ? parsed.map(normalize) : [];
    } catch (err) {
      return [];
    }
  }

  function normalize(prompt) {
    return withNotes(withRating(prompt));
  }

  /* Prompts saved before ratings existed have no `rating` — read them as 0
     rather than migrating storage. */
  function withRating(prompt) {
    var rating = Math.round(prompt.rating);
    if (!(rating >= 1 && rating <= MAX_RATING)) rating = 0;
    prompt.rating = rating;
    return prompt;
  }

  /* Same idea for notes: an older prompt without a `notes` array reads as one
     with no notes. */
  function withNotes(prompt) {
    if (!Array.isArray(prompt.notes)) prompt.notes = [];
    return prompt;
  }

  function makeId() {
    return String(Date.now()) + String(Math.random()).slice(2, 8);
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

  /* ---------- Notes ---------- */

  function createNotes(prompt) {
    var section = document.createElement('section');
    section.className = 'notes';
    section.setAttribute('aria-label', 'Notes');
    section.setAttribute('data-prompt-id', prompt.id);

    var list = document.createElement('ul');
    list.className = 'note-list';

    section.appendChild(list);
    section.appendChild(createNoteForm(prompt, list));
    renderNotes(prompt, list);
    return section;
  }

  function renderNotes(prompt, list) {
    list.innerHTML = '';
    prompt.notes.forEach(function (note) {
      list.appendChild(createNote(prompt, note, list));
    });
  }

  function createNote(prompt, note, list) {
    var item = document.createElement('li');
    item.className = 'note';
    item.setAttribute('data-note-id', note.id);

    var text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = note.text;

    var time = document.createElement('time');
    time.className = 'note-time';
    time.dateTime = new Date(note.updatedAt).toISOString();
    time.textContent = new Date(note.updatedAt).toLocaleString();

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'note-btn';
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit note');
    editBtn.addEventListener('click', function () {
      startEdit(prompt, note, item, list);
    });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'note-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete note');
    deleteBtn.addEventListener('click', function () {
      if (window.confirm('Delete this note?')) deleteNote(prompt, note.id, list);
    });

    var actions = document.createElement('div');
    actions.className = 'note-actions';
    actions.appendChild(time);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(text);
    item.appendChild(actions);
    return item;
  }

  /* Swaps the note for an editor in place. Cancel just re-renders the list, so
     the note comes back from storage unchanged. */
  function startEdit(prompt, note, item, list) {
    var form = document.createElement('form');
    form.className = 'note-edit';

    var input = document.createElement('textarea');
    input.className = 'note-input';
    input.rows = 2;
    input.value = note.text;
    input.setAttribute('aria-label', 'Edit note');

    var saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'note-btn';
    saveBtn.textContent = 'Save';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'note-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () {
      renderNotes(prompt, list);
    });

    var actions = document.createElement('div');
    actions.className = 'note-actions';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      updateNote(prompt, note, text, list);
    });

    form.appendChild(input);
    form.appendChild(actions);

    item.innerHTML = '';
    item.appendChild(form);
    input.focus();
  }

  function createNoteForm(prompt, list) {
    var form = document.createElement('form');
    form.className = 'note-form';

    var input = document.createElement('textarea');
    input.className = 'note-input';
    input.rows = 2;
    input.placeholder = 'Add a note...';
    input.setAttribute('aria-label', 'New note');

    var addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.className = 'note-btn';
    addBtn.textContent = 'Add Note';

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      addNote(prompt, text, list);
      form.reset();
      input.focus();
    });

    form.appendChild(input);
    form.appendChild(addBtn);
    return form;
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
    card.appendChild(createNotes(prompt));
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
      id: makeId(),
      title: title,
      content: content,
      rating: 0,
      notes: []
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

  function addNote(prompt, text, list) {
    var now = Date.now();
    prompt.notes.push({ id: makeId(), text: text, createdAt: now, updatedAt: now });
    saveNotes(prompt);
    renderNotes(prompt, list);
  }

  function updateNote(prompt, note, text, list) {
    note.text = text;
    note.updatedAt = Date.now();
    saveNotes(prompt);
    renderNotes(prompt, list);
  }

  function deleteNote(prompt, id, list) {
    prompt.notes = prompt.notes.filter(function (note) {
      return note.id !== id;
    });
    saveNotes(prompt);
    renderNotes(prompt, list);
  }

  /* Notes belong to one prompt, so a change rewrites only that prompt's entry
     and re-renders its list — a full render() would tear down open editors on
     every other card. */
  function saveNotes(prompt) {
    var prompts = loadPrompts();
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].id === prompt.id) {
        prompts[i].notes = prompt.notes;
        savePrompts(prompts);
        break;
      }
    }
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
