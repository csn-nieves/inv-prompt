(function () {
  'use strict';

  var STORAGE_KEY = 'prompts';
  var THEME_KEY = 'theme';
  var PREVIEW_WORDS = 12;
  var MAX_RATING = 5;
  var MAX_MODEL_LENGTH = 100;
  var DEFAULT_MODEL = 'unspecified';
  var CODE_MULTIPLIER = 1.3;
  var HIGH_CONFIDENCE_MAX = 1000;
  var MEDIUM_CONFIDENCE_MAX = 5000;

  /* Date#toISOString output, and the only date format this app stores. */
  var ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  /* Rough "does this read as source code" test — declarations, statement
     terminators, arrows or tags. Only used to pick the token multiplier, so a
     wrong guess costs an estimate, not correctness. */
  var CODE_HINTS = /(^|\n)\s*(function|const|let|var|class|def|import|#include|<\?php)\b|[{};]\s*(\n|$)|=>|<\/?[a-z][a-z0-9-]*>/;

  var form = document.getElementById('prompt-form');
  var titleInput = document.getElementById('prompt-title');
  var contentInput = document.getElementById('prompt-content');
  var modelInput = document.getElementById('prompt-model');
  var formError = document.getElementById('form-error');
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
    return withMetadata(withNotes(withRating(prompt)));
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

  /* ---------- Metadata ---------- */

  /* Splits `text` into whitespace-separated words. An empty or blank string has
     no words, which `''.split(/\s+/)` would report as one. */
  function countWords(text) {
    var trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function confidenceFor(tokens) {
    if (tokens < HIGH_CONFIDENCE_MAX) return 'high';
    if (tokens <= MEDIUM_CONFIDENCE_MAX) return 'medium';
    return 'low';
  }

  /* Two independent estimates of the same text: a word-based floor and a
     character-based ceiling. Code packs more tokens into the same text — more
     punctuation, fewer dictionary words — so both bounds scale up for it.
     Confidence is read off the upper bound, the value that decides whether a
     prompt is at risk of overflowing a context window. */
  function estimateTokens(text, isCode) {
    if (typeof text !== 'string') {
      throw new TypeError('estimateTokens: text must be a string, received ' + typeof text);
    }

    var multiplier = isCode ? CODE_MULTIPLIER : 1;
    var min = Math.round(0.75 * countWords(text) * multiplier);
    var max = Math.round(0.25 * text.length * multiplier);

    return { min: min, max: max, confidence: confidenceFor(max) };
  }

  function looksLikeCode(text) {
    return CODE_HINTS.test(text);
  }

  function validateModelName(modelName) {
    if (typeof modelName !== 'string') {
      throw new TypeError('Model name must be a string, received ' + typeof modelName);
    }

    var trimmed = modelName.trim();
    if (!trimmed) throw new Error('Model name must not be empty.');
    if (trimmed.length > MAX_MODEL_LENGTH) {
      throw new RangeError('Model name must be at most ' + MAX_MODEL_LENGTH +
        ' characters, received ' + trimmed.length + '.');
    }

    return trimmed;
  }

  /* Accepts only the exact shape Date#toISOString produces — a looser check
     would let `new Date('2026-1-1')` through on some browsers and not others. */
  function validateIsoDate(value, field) {
    if (typeof value !== 'string' || !ISO_8601.test(value) || isNaN(Date.parse(value))) {
      throw new TypeError(field + ' must be an ISO 8601 string ' +
        '(YYYY-MM-DDTHH:mm:ss.sssZ), received ' + JSON.stringify(value) + '.');
    }
    return value;
  }

  /* `typeof null` is 'object', so describe the value rather than its type. */
  function describe(value) {
    return value === null ? 'null' : typeof value;
  }

  function validateTokenEstimate(estimate) {
    if (!estimate || typeof estimate !== 'object') {
      throw new TypeError('tokenEstimate must be an object, received ' + describe(estimate) + '.');
    }
    if (typeof estimate.min !== 'number' || !isFinite(estimate.min) || estimate.min < 0 ||
        typeof estimate.max !== 'number' || !isFinite(estimate.max) || estimate.max < 0) {
      throw new TypeError('tokenEstimate.min and tokenEstimate.max must be non-negative numbers.');
    }
    if (estimate.confidence !== 'high' && estimate.confidence !== 'medium' &&
        estimate.confidence !== 'low') {
      throw new TypeError("tokenEstimate.confidence must be 'high', 'medium' or 'low', " +
        'received ' + JSON.stringify(estimate.confidence) + '.');
    }

    return { min: estimate.min, max: estimate.max, confidence: estimate.confidence };
  }

  function validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      throw new TypeError('Metadata must be an object, received ' + describe(metadata) + '.');
    }

    var createdAt = validateIsoDate(metadata.createdAt, 'createdAt');
    var updatedAt = validateIsoDate(metadata.updatedAt, 'updatedAt');
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      throw new RangeError('updatedAt (' + updatedAt + ') must not be earlier than createdAt (' +
        createdAt + ').');
    }

    return {
      model: validateModelName(metadata.model),
      createdAt: createdAt,
      updatedAt: updatedAt,
      tokenEstimate: validateTokenEstimate(metadata.tokenEstimate)
    };
  }

  function trackModel(modelName, content) {
    var model = validateModelName(modelName);
    if (typeof content !== 'string') {
      throw new TypeError('trackModel: content must be a string, received ' + typeof content);
    }

    var now = new Date().toISOString();
    return {
      model: model,
      createdAt: now,
      updatedAt: now,
      tokenEstimate: estimateTokens(content, looksLikeCode(content))
    };
  }

  /* Stamps `updatedAt` with the current time. A clock that has moved backwards
     since the prompt was created would produce a metadata object that fails its
     own validation, so it is rejected rather than stored. */
  function updateTimestamps(metadata) {
    var valid = validateMetadata(metadata);
    var updatedAt = new Date().toISOString();

    if (Date.parse(updatedAt) < Date.parse(valid.createdAt)) {
      throw new RangeError('updateTimestamps: updatedAt (' + updatedAt +
        ') is earlier than createdAt (' + valid.createdAt + '). Check the system clock.');
    }

    valid.updatedAt = updatedAt;
    return valid;
  }

  /* Ids start with a Date.now() stamp, so a prompt saved before metadata
     existed still knows when it was created. */
  function createdAtFromId(id) {
    var match = /^(\d{13})/.exec(String(id));
    if (!match) return null;

    var date = new Date(Number(match[1]));
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  /* Read-time default, like `withRating` and `withNotes`: a prompt with missing
     or corrupt metadata reads as one with freshly derived metadata instead of
     breaking the card. */
  function withMetadata(prompt) {
    try {
      prompt.metadata = validateMetadata(prompt.metadata);
    } catch (err) {
      prompt.metadata = backfillMetadata(prompt);
    }
    return prompt;
  }

  function backfillMetadata(prompt) {
    var content = typeof prompt.content === 'string' ? prompt.content : '';
    var metadata = trackModel(DEFAULT_MODEL, content);
    var created = createdAtFromId(prompt.id);

    if (created) {
      metadata.createdAt = created;
      metadata.updatedAt = created;
    }

    return metadata;
  }

  /* ---------- Rendering ---------- */

  function makePreview(content) {
    var words = content.trim().split(/\s+/);
    if (words.length <= PREVIEW_WORDS) return words.join(' ');
    return words.slice(0, PREVIEW_WORDS).join(' ') + '...';
  }

  /* ---------- Metadata display ---------- */

  function createMetadata(prompt) {
    var wrap = document.createElement('dl');
    wrap.className = 'meta';
    renderMetadata(prompt, wrap);
    return wrap;
  }

  function appendMetaRow(wrap, label, valueEl) {
    var term = document.createElement('dt');
    term.className = 'meta-label';
    term.textContent = label;

    var detail = document.createElement('dd');
    detail.className = 'meta-value';
    detail.appendChild(valueEl);

    wrap.appendChild(term);
    wrap.appendChild(detail);
  }

  function createTimeEl(iso) {
    var time = document.createElement('time');
    time.dateTime = iso;
    time.textContent = new Date(iso).toLocaleString();
    return time;
  }

  function createTokenBadge(estimate) {
    var badge = document.createElement('span');
    badge.className = 'token-badge token-' + estimate.confidence;
    badge.title = estimate.confidence + ' confidence';

    var range = document.createElement('span');
    range.className = 'token-range';
    range.textContent = estimate.min.toLocaleString() + '\u2013' +
      estimate.max.toLocaleString() + ' tokens';

    var note = document.createElement('span');
    note.className = 'token-confidence';
    note.textContent = estimate.confidence;

    badge.appendChild(range);
    badge.appendChild(note);
    return badge;
  }

  /* Rebuilt in place rather than re-rendering the card, so a rating or note
     change can refresh the timestamp without tearing down focus. */
  function renderMetadata(prompt, wrap) {
    wrap.innerHTML = '';

    try {
      var metadata = validateMetadata(prompt.metadata);
      var model = document.createElement('span');
      model.className = 'meta-model';
      model.textContent = metadata.model;

      appendMetaRow(wrap, 'Model', model);
      appendMetaRow(wrap, 'Created', createTimeEl(metadata.createdAt));
      appendMetaRow(wrap, 'Updated', createTimeEl(metadata.updatedAt));
      appendMetaRow(wrap, 'Tokens', createTokenBadge(metadata.tokenEstimate));
    } catch (err) {
      var message = document.createElement('span');
      message.className = 'meta-error';
      message.textContent = 'Metadata unavailable: ' + err.message;
      wrap.appendChild(message);
    }
  }

  /* ---------- Rating ---------- */

  function createStar(prompt, value, wrap, touch) {
    var star = document.createElement('button');
    star.type = 'button';
    star.className = 'star';
    star.setAttribute('role', 'radio');
    star.setAttribute('aria-label', value + (value === 1 ? ' star' : ' stars'));

    star.addEventListener('click', function () {
      setRating(prompt, prompt.rating === value ? 0 : value, wrap, touch);
    });
    star.addEventListener('mouseenter', function () {
      paintStars(wrap, value);
    });

    return star;
  }

  function createRating(prompt, touch) {
    var wrap = document.createElement('div');
    wrap.className = 'rating';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'Rate this prompt');

    for (var value = 1; value <= MAX_RATING; value++) {
      wrap.appendChild(createStar(prompt, value, wrap, touch));
    }

    wrap.addEventListener('mouseleave', function () {
      paintStars(wrap, prompt.rating);
    });
    wrap.addEventListener('keydown', function (event) {
      handleRatingKeys(event, prompt, wrap, touch);
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

  function handleRatingKeys(event, prompt, wrap, touch) {
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
    setRating(prompt, next, wrap, touch);
    wrap.querySelectorAll('.star')[next > 0 ? next - 1 : 0].focus();
  }

  /* ---------- Notes ---------- */

  function createNotes(prompt, touch) {
    var section = document.createElement('section');
    section.className = 'notes';
    section.setAttribute('aria-label', 'Notes');
    section.setAttribute('data-prompt-id', prompt.id);

    var list = document.createElement('ul');
    list.className = 'note-list';

    section.appendChild(list);
    section.appendChild(createNoteForm(prompt, list, touch));
    renderNotes(prompt, list, touch);
    return section;
  }

  function renderNotes(prompt, list, touch) {
    list.innerHTML = '';
    prompt.notes.forEach(function (note) {
      list.appendChild(createNote(prompt, note, list, touch));
    });
  }

  function createNote(prompt, note, list, touch) {
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
      startEdit(prompt, note, item, list, touch);
    });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'note-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete note');
    deleteBtn.addEventListener('click', function () {
      if (window.confirm('Delete this note?')) deleteNote(prompt, note.id, list, touch);
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
  function startEdit(prompt, note, item, list, touch) {
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
      renderNotes(prompt, list, touch);
    });

    var actions = document.createElement('div');
    actions.className = 'note-actions';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      updateNote(prompt, note, text, list, touch);
    });

    form.appendChild(input);
    form.appendChild(actions);

    item.innerHTML = '';
    item.appendChild(form);
    input.focus();
  }

  function createNoteForm(prompt, list, touch) {
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
      addNote(prompt, text, list, touch);
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

    var meta = createMetadata(prompt);
    var touch = function () {
      touchPrompt(prompt, meta);
    };

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function () {
      deletePrompt(prompt.id);
    });

    card.appendChild(title);
    card.appendChild(preview);
    card.appendChild(meta);
    card.appendChild(createRating(prompt, touch));
    card.appendChild(createNotes(prompt, touch));
    card.appendChild(deleteBtn);
    return card;
  }

  /* Newest first. Metadata is normalized on load, so every prompt has a
     parseable createdAt by the time this runs. */
  function byCreatedAtDesc(a, b) {
    return Date.parse(b.metadata.createdAt) - Date.parse(a.metadata.createdAt);
  }

  function render() {
    var prompts = loadPrompts().sort(byCreatedAtDesc);
    listEl.innerHTML = '';
    emptyEl.hidden = prompts.length > 0;

    prompts.forEach(function (prompt) {
      listEl.appendChild(createCard(prompt));
    });
  }

  /* ---------- Actions ---------- */

  function addPrompt(title, content, model) {
    var prompts = loadPrompts();
    prompts.unshift({
      id: makeId(),
      title: title,
      content: content,
      rating: 0,
      notes: [],
      metadata: trackModel(model, content)
    });
    savePrompts(prompts);
    render();
  }

  /* Any edit to a prompt restamps `updatedAt`. A clock problem should not cost
     the user the edit itself, which is already saved, so a rejected stamp is
     logged and the previous timestamp stands. */
  function touchPrompt(prompt, metaEl) {
    try {
      prompt.metadata = updateTimestamps(prompt.metadata);
      saveMetadata(prompt);
    } catch (err) {
      console.error('Could not update timestamps: ' + err.message);
    }

    renderMetadata(prompt, metaEl);
  }

  /* Updates the card in place — a full render() would tear down the star the
     user is hovering or has focused. */
  function setRating(prompt, rating, wrap, touch) {
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
    touch();
  }

  function addNote(prompt, text, list, touch) {
    var now = Date.now();
    prompt.notes.push({ id: makeId(), text: text, createdAt: now, updatedAt: now });
    saveNotes(prompt);
    renderNotes(prompt, list, touch);
    touch();
  }

  function updateNote(prompt, note, text, list, touch) {
    note.text = text;
    note.updatedAt = Date.now();
    saveNotes(prompt);
    renderNotes(prompt, list, touch);
    touch();
  }

  function deleteNote(prompt, id, list, touch) {
    prompt.notes = prompt.notes.filter(function (note) {
      return note.id !== id;
    });
    saveNotes(prompt);
    renderNotes(prompt, list, touch);
    touch();
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

  function saveMetadata(prompt) {
    var prompts = loadPrompts();
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].id === prompt.id) {
        prompts[i].metadata = prompt.metadata;
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

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var title = titleInput.value.trim();
    var content = contentInput.value.trim();
    if (!title || !content) return;

    /* An empty model field is a blank, not a mistake — it stands in for
       "not recorded". Anything actually typed has to validate. */
    var model = modelInput.value.trim() || DEFAULT_MODEL;

    try {
      addPrompt(title, content, model);
    } catch (err) {
      showFormError(err.message);
      modelInput.focus();
      return;
    }

    showFormError('');
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

  /* The metadata functions are the reusable part of this file — exposed so
     other scripts, and the console, can call them without a build step. */
  window.promptMetadata = {
    trackModel: trackModel,
    updateTimestamps: updateTimestamps,
    estimateTokens: estimateTokens
  };

  initTheme();
  render();
})();
