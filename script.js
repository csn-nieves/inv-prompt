(function () {
  'use strict';

  var STORAGE_KEY = 'prompts';
  var BACKUP_KEY = 'prompts.backup';
  var THEME_KEY = 'theme';

  /* Written into every export and checked on every import. Bump it only when
     the shape of an export file changes; older files stay readable. */
  var SCHEMA_VERSION = 1;
  var APP_ID = 'prompt-library';
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
  var exportBtn = document.getElementById('export-btn');
  var importBtn = document.getElementById('import-btn');
  var importFile = document.getElementById('import-file');
  var statusEl = document.getElementById('library-status');
  var importDialog = document.getElementById('import-dialog');
  var dialogSummary = document.getElementById('import-dialog-summary');
  var keepMineBtn = document.getElementById('merge-keep-existing');
  var useTheirsBtn = document.getElementById('merge-keep-imported');
  var dialogForm = document.getElementById('import-dialog-form');

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

  /* ---------- Statistics ---------- */

  function ratedPrompts(prompts) {
    return prompts.filter(function (prompt) {
      return prompt.rating > 0;
    });
  }

  /* Unrated prompts are excluded rather than counted as zero, which would drag
     the average down for prompts nobody has judged yet. */
  function averageRating(prompts) {
    var rated = ratedPrompts(prompts);
    if (!rated.length) return 0;

    var total = rated.reduce(function (sum, prompt) {
      return sum + prompt.rating;
    }, 0);

    return Math.round((total / rated.length) * 10) / 10;
  }

  /* A bare object would inherit `constructor` and friends, and a prompt whose
     model is literally named "constructor" would then count as pre-existing. */
  function tally(values) {
    var counts = Object.create(null);
    values.forEach(function (value) {
      counts[value] = (counts[value] || 0) + 1;
    });
    return counts;
  }

  /* Ties break alphabetically, so the same library always exports the same
     statistics. */
  function mostUsedModel(prompts) {
    if (!prompts.length) return null;

    var counts = tally(prompts.map(function (prompt) {
      return prompt.metadata.model;
    }));

    return Object.keys(counts).sort().reduce(function (best, model) {
      return best === null || counts[model] > counts[best] ? model : best;
    }, null);
  }

  function statistics(prompts) {
    return {
      totalPrompts: prompts.length,
      ratedPrompts: ratedPrompts(prompts).length,
      averageRating: averageRating(prompts),
      mostUsedModel: mostUsedModel(prompts)
    };
  }

  /* ---------- Integrity checks ---------- */

  function requireNonEmptyString(value, label) {
    if (typeof value !== 'string') {
      throw new TypeError(label + ' must be a string, received ' + describe(value) + '.');
    }
    if (!value.trim()) throw new Error(label + ' must not be empty.');
    return value;
  }

  function validateNote(note, at) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
      throw new TypeError(at + ' must be an object.');
    }
    requireNonEmptyString(note.id, at + '.id');
    if (typeof note.text !== 'string') {
      throw new TypeError(at + '.text must be a string, received ' + describe(note.text) + '.');
    }
    ['createdAt', 'updatedAt'].forEach(function (field) {
      if (typeof note[field] !== 'number' || !isFinite(note[field])) {
        throw new TypeError(at + '.' + field + ' must be a timestamp in milliseconds, received ' +
          describe(note[field]) + '.');
      }
    });
  }

  /* Every error names the record it came from, so a rejected file points at the
     entry to fix rather than just failing. */
  function validatePromptRecord(prompt, index) {
    var at = 'prompts[' + index + ']';

    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      throw new TypeError(at + ' must be an object, received ' + describe(prompt) + '.');
    }

    requireNonEmptyString(prompt.id, at + '.id');
    requireNonEmptyString(prompt.title, at + '.title');
    requireNonEmptyString(prompt.content, at + '.content');

    if (typeof prompt.rating !== 'number' || prompt.rating !== Math.round(prompt.rating) ||
        prompt.rating < 0 || prompt.rating > MAX_RATING) {
      throw new RangeError(at + '.rating must be a whole number from 0 to ' + MAX_RATING +
        ', received ' + JSON.stringify(prompt.rating) + '.');
    }

    if (!Array.isArray(prompt.notes)) {
      throw new TypeError(at + '.notes must be an array, received ' + describe(prompt.notes) + '.');
    }
    prompt.notes.forEach(function (note, noteIndex) {
      validateNote(note, at + '.notes[' + noteIndex + ']');
    });

    try {
      validateMetadata(prompt.metadata);
    } catch (err) {
      throw new Error(at + '.metadata: ' + err.message);
    }

    return prompt;
  }

  function assertUniqueIds(prompts, subject) {
    var seenAt = Object.create(null);

    prompts.forEach(function (prompt, index) {
      if (prompt.id in seenAt) {
        throw new Error(subject + ' contains two prompts sharing the id "' + prompt.id +
          '" (prompts[' + seenAt[prompt.id] + '] and prompts[' + index + ']).');
      }
      seenAt[prompt.id] = index;
    });
  }

  /* ---------- Export ---------- */

  function buildExport() {
    var prompts = loadPrompts().sort(byCreatedAtDesc);

    prompts.forEach(validatePromptRecord);
    assertUniqueIds(prompts, 'The library');

    return {
      app: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      statistics: statistics(prompts),
      prompts: prompts
    };
  }

  /* 2026-08-18T04:40:12.483Z -> 2026-08-18-044012, which sorts by name in a
     downloads folder. */
  function fileStamp(iso) {
    return iso.slice(0, 19).replace('T', '-').replace(/:/g, '');
  }

  function downloadJson(data, filename) {
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)],
      { type: 'application/json' }));
    var link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    /* Revoked on the next tick — revoking synchronously can cancel the download
       before the browser has read the blob. */
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }

  function exportLibrary() {
    try {
      var data = buildExport();
      if (!data.prompts.length) {
        showStatus('Nothing to export yet — the library is empty.', 'info');
        return;
      }

      downloadJson(data, APP_ID + '-' + fileStamp(data.exportedAt) + '.json');
      showStatus('Exported ' + countOf(data.prompts.length, 'prompt') + '.', 'success');
    } catch (err) {
      showStatus('Export failed. ' + err.message, 'error');
    }
  }

  /* ---------- Import ---------- */

  function parseImport(text) {
    var data;

    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('The file is not valid JSON. ' + err.message);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('Expected an export object at the top level, found ' +
        (Array.isArray(data) ? 'an array' : describe(data)) + '.');
    }

    if (data.app !== undefined && data.app !== APP_ID) {
      throw new Error('This file came from "' + data.app + '", not ' + APP_ID + '.');
    }

    validateSchemaVersion(data.schemaVersion);
    validateIsoDate(data.exportedAt, 'exportedAt');

    if (!Array.isArray(data.prompts)) {
      throw new TypeError('prompts must be an array, received ' + describe(data.prompts) + '.');
    }

    data.prompts.forEach(validatePromptRecord);
    assertUniqueIds(data.prompts, 'The file');

    return {
      schemaVersion: data.schemaVersion,
      exportedAt: data.exportedAt,
      prompts: data.prompts.map(normalize)
    };
  }

  /* Older files are readable; newer ones are not, because this build cannot
     know what a later version added. */
  function validateSchemaVersion(version) {
    if (typeof version !== 'number' || version !== Math.round(version) || version < 1) {
      throw new TypeError('schemaVersion must be a whole number of at least 1, received ' +
        JSON.stringify(version) + '.');
    }
    if (version > SCHEMA_VERSION) {
      throw new RangeError('The file uses schema version ' + version + ', and this app reads up to ' +
        SCHEMA_VERSION + '. Update the app before importing it.');
    }
  }

  function idSet(prompts) {
    var ids = Object.create(null);
    prompts.forEach(function (prompt) {
      ids[prompt.id] = true;
    });
    return ids;
  }

  function countConflicts(existing, incoming) {
    var ids = idSet(existing);
    return incoming.filter(function (prompt) {
      return ids[prompt.id];
    }).length;
  }

  /* Existing order is preserved and new prompts are appended; `render` sorts by
     createdAt anyway, so this only decides which copy of a duplicate wins. */
  function mergePrompts(existing, incoming, keepImported) {
    var merged = existing.slice();
    var indexById = Object.create(null);

    merged.forEach(function (prompt, index) {
      indexById[prompt.id] = index;
    });

    incoming.forEach(function (prompt) {
      if (!(prompt.id in indexById)) {
        indexById[prompt.id] = merged.push(prompt) - 1;
      } else if (keepImported) {
        merged[indexById[prompt.id]] = prompt;
      }
    });

    return merged;
  }

  /* Writes the library, then reads it back. The previous contents are copied to
     a backup key first and restored if any part of that fails, so a rejected
     import cannot leave a half-written library behind. */
  function applyImport(prompts) {
    var backup = localStorage.getItem(STORAGE_KEY);

    try {
      localStorage.setItem(BACKUP_KEY, backup === null ? '[]' : backup);
      savePrompts(prompts);

      var written = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(written) || written.length !== prompts.length) {
        throw new Error('The library did not read back as written.');
      }
    } catch (err) {
      rollback(backup);
      throw err;
    }
  }

  function rollback(backup) {
    try {
      if (backup === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, backup);
    } catch (err) {
      /* Restoring is the last resort; there is nothing further to fall back to,
         and the caller still reports the original failure. */
      console.error('Rollback failed: ' + err.message);
    }
  }

  function readFile(file, onText, onError) {
    var reader = new FileReader();

    reader.onload = function () {
      onText(String(reader.result));
    };
    reader.onerror = function () {
      onError(new Error('Could not read "' + file.name + '".'));
    };

    reader.readAsText(file);
  }

  function importFromFile(file) {
    readFile(file, function (text) {
      var data;

      try {
        data = parseImport(text);
      } catch (err) {
        showStatus('Import failed, nothing changed. ' + err.message, 'error');
        return;
      }

      if (!data.prompts.length) {
        showStatus('"' + file.name + '" is a valid export but holds no prompts.', 'info');
        return;
      }

      var existing = loadPrompts();
      if (!existing.length) {
        finishImport(data.prompts, 'replace', 0);
        return;
      }

      var conflicts = countConflicts(existing, data.prompts);
      askImportChoice(data.prompts.length, conflicts, function (choice) {
        if (choice !== 'replace' && choice !== 'merge-keep-existing' &&
            choice !== 'merge-keep-imported') {
          showStatus('Import cancelled. Nothing changed.', 'info');
          return;
        }

        var next = choice === 'replace'
          ? data.prompts
          : mergePrompts(existing, data.prompts, choice === 'merge-keep-imported');

        finishImport(next, choice, conflicts);
      });
    }, function (err) {
      showStatus('Import failed, nothing changed. ' + err.message, 'error');
    });
  }

  function finishImport(prompts, choice, conflicts) {
    try {
      applyImport(prompts);
    } catch (err) {
      showStatus('Import failed and your library was restored unchanged. ' + err.message, 'error');
      return;
    }

    render();
    showStatus(describeImport(prompts.length, choice, conflicts), 'success');
  }

  function describeImport(total, choice, conflicts) {
    var kept = countOf(conflicts, 'conflict');

    if (choice === 'replace') {
      return 'Replaced the library with ' + countOf(total, 'prompt') +
        '. The previous library is saved under "' + BACKUP_KEY + '".';
    }
    if (!conflicts) {
      return 'Merged. The library now holds ' + countOf(total, 'prompt') + '.';
    }

    return 'Merged, keeping ' + (choice === 'merge-keep-imported' ? 'the imported' : 'your') +
      ' copy of ' + kept + '. The library now holds ' + countOf(total, 'prompt') + '.';
  }

  /* ---------- Import dialog ---------- */

  /* Holds the callback waiting on the open dialog. One at a time: the dialog is
     modal, so a second import cannot start before this one is answered. */
  var pendingChoice = null;
  var lastClicked = null;

  function askImportChoice(incoming, conflicts, onChoice) {
    dialogSummary.textContent = summarizeImport(incoming, conflicts);

    /* With no duplicates there is only one way to merge, so the second button
       has nothing to distinguish it. */
    useTheirsBtn.hidden = conflicts === 0;
    keepMineBtn.textContent = conflicts ? 'Merge, keep mine' : 'Merge';

    pendingChoice = onChoice;
    lastClicked = null;
    importDialog.showModal();
  }

  /* Answers the open dialog exactly once — Escape can arrive as both `keydown`
     and `cancel`, and clearing the callback first makes the second one a no-op. */
  function resolveChoice(choice) {
    var callback = pendingChoice;
    pendingChoice = null;

    if (importDialog.open) importDialog.close();
    if (callback) callback(choice);
  }

  /* The choice is read from the form's submit event rather than the dialog's
     `close` event: `close` does not reach listeners in every browser build,
     while a submit handler is dispatched the same way everywhere. */
  dialogForm.addEventListener('submit', function (event) {
    var submitter = event.submitter || lastClicked;
    resolveChoice(submitter ? submitter.value : 'cancel');
  });

  /* `event.submitter` is unavailable in older browsers, so remember the button
     that was pressed. */
  dialogForm.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('.dialog-btn');
    if (button) lastClicked = button;
  });

  importDialog.addEventListener('cancel', function () {
    resolveChoice('cancel');
  });

  importDialog.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') resolveChoice('cancel');
  });

  function summarizeImport(incoming, conflicts) {
    var opening = 'This file holds ' + countOf(incoming, 'prompt') + '. ';

    if (!conflicts) {
      return opening + 'Nothing in it clashes with what you already have.';
    }

    return opening + countOf(conflicts, 'of them') +
      ' already in your library under the same id. Choose which copy to keep.';
  }

  function countOf(count, noun) {
    if (noun === 'of them') return count + (count === 1 ? ' is' : ' are');
    return count + ' ' + noun + (count === 1 ? '' : 's');
  }

  /* ---------- Status line ---------- */

  function showStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = 'library-status status-' + kind;
    statusEl.hidden = !message;
  }

  exportBtn.addEventListener('click', exportLibrary);

  importBtn.addEventListener('click', function () {
    importFile.click();
  });

  importFile.addEventListener('change', function () {
    var file = importFile.files && importFile.files[0];

    /* Cleared so that picking the same file twice in a row still fires a
       change event. The File reference above stays valid. */
    importFile.value = '';
    if (file) importFromFile(file);
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

  window.promptLibrary = {
    buildExport: buildExport,
    parseImport: parseImport,
    statistics: statistics,
    mergePrompts: mergePrompts,
    SCHEMA_VERSION: SCHEMA_VERSION
  };

  initTheme();
  render();
})();
