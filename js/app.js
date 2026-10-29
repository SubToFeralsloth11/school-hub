/* School Hub UI. Plain DOM + template strings; all state lives in localStorage. */
(function () {
  'use strict';

  var C = window.Core;
  var G = window.Graph;
  var h = C.esc;

  var COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
  var TASK_TYPES = { assignment: 'Assignment', exam: 'Exam / test', homework: 'Homework', project: 'Project', other: 'Other' };
  var TASK_STATUS = { todo: 'To do', doing: 'In progress', done: 'Done' };
  var MAIL_STATUS = { 'new': 'New', reply: 'Needs reply', waiting: 'Waiting on them', done: 'Done' };
  var REPEAT = { none: 'Does not repeat', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
  var GROUPS = [['overdue', 'Overdue'], ['today', 'Today'], ['soon', 'Next 7 days'], ['later', 'Later'], ['none', 'No date']];
  var VIEWS = ['today', 'notes', 'reminders', 'school', 'email', 'settings'];
  var SYNC_EVERY = 10 * 60 * 1000;

  var main = document.getElementById('view');
  var dialog = document.getElementById('modal');
  var modalForm = document.getElementById('modal-form');
  var state = load();
  var ui = {
    notesQuery: '', schoolTab: 'tasks', taskSubject: '', taskFilter: 'open', showDoneReminders: false,
    mailFilter: 'open', mailQuery: '', eqOnly: false, syncing: false
  };
  var modal = null;

  /* ---------- storage ---------- */

  function load() {
    try { return C.migrate(JSON.parse(localStorage.getItem(C.STORAGE_KEY))); }
    catch (e) { return C.defaultState(); }
  }

  function save() {
    try { localStorage.setItem(C.STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — browser storage is full or blocked.', { error: true }); }
  }

  function commit() { save(); render(); }

  function find(collection, id) {
    return state[collection].filter(function (x) { return x.id === id; })[0];
  }

  function remove(collection, id) {
    state[collection] = state[collection].filter(function (x) { return x.id !== id; });
  }

  function subjectOf(id) { return id ? find('subjects', id) : null; }

  /* ---------- small helpers ---------- */

  function toast(message, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' error' : '');
    el.setAttribute('role', opts.error ? 'alert' : 'status');
    var text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    if (opts.action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', function () { opts.action.run(); el.remove(); });
      el.appendChild(btn);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', function () { el.remove(); });
    el.appendChild(close);
    document.getElementById('toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, opts.sticky ? 20000 : 5000);
  }

  function options(map, selected) {
    return Object.keys(map).map(function (k) {
      return '<option value="' + h(k) + '"' + (k === selected ? ' selected' : '') + '>' + h(map[k]) + '</option>';
    }).join('');
  }

  function subjectOptions(selected, emptyLabel) {
    return '<option value="">' + h(emptyLabel) + '</option>' + state.subjects.map(function (s) {
      return '<option value="' + h(s.id) + '"' + (s.id === selected ? ' selected' : '') + '>' + h(s.name) + '</option>';
    }).join('');
  }

  function colorPicker(name, selected, allowNone) {
    var list = allowNone ? [''].concat(COLORS) : COLORS;
    return '<div class="colors" role="radiogroup" aria-label="Colour">' + list.map(function (c, i) {
      var style = c ? 'background:' + c : 'background:var(--surface-2);border-style:dashed;border-color:var(--border)';
      return '<label title="' + (c || 'No colour') + '"><input type="radio" name="' + name + '" value="' + c + '"' +
        ((selected || '') === c || (!selected && !allowNone && i === 0) ? ' checked' : '') + '><span style="' + style + '"></span></label>';
    }).join('') + '</div>';
  }

  function field(label, control) {
    return '<label class="field"><span>' + h(label) + '</span>' + control + '</label>';
  }

  function duePill(value, done) {
    if (!value) return '';
    var status = done ? 'done' : C.dueStatus(value);
    return '<span class="pill ' + status + '">' + h(C.formatDue(value)) + '</span>';
  }

  function subjectChip(subject) {
    if (!subject) return '';
    return '<span class="row" style="gap:5px"><i class="dot" style="background:' + h(subject.color) + '"></i>' + h(subject.name) + '</span>';
  }

  function empty(text) { return '<div class="empty">' + text + '</div>'; }

  function greeting() {
    var hr = new Date().getHours();
    var part = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    return part + (state.settings.name ? ', ' + state.settings.name : '');
  }

  function download(filename, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function readFiles(files) {
    return Promise.all(Array.prototype.map.call(files, function (file) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve({ name: file.name, text: String(reader.result) }); };
        reader.onerror = function () { resolve({ name: file.name, text: null }); };
        reader.readAsText(file);
      });
    }));
  }

  /* ---------- modal ---------- */

  function openModal(opts) {
    modal = opts;
    document.getElementById('modal-title').textContent = opts.title;
    document.getElementById('modal-body').innerHTML = opts.body;
    document.getElementById('modal-save').textContent = opts.saveLabel || 'Save';
    document.getElementById('modal-delete').hidden = !opts.onDelete;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    var first = dialog.querySelector('.modal-body [autofocus], .modal-body input, .modal-body textarea, .modal-body select');
    // Avoid popping the keyboard on phones when just viewing an item.
    if (first && (opts.focus !== false) && window.matchMedia('(pointer: fine)').matches) first.focus();
  }

  function closeModal() {
    modal = null;
    if (dialog.open) dialog.close();
  }

  modalForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!modal) return;
    var data = new FormData(modalForm);
    var values = {};
    data.forEach(function (v, k) { values[k] = typeof v === 'string' ? v.trim() : v; });
    modalForm.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { values[cb.name] = cb.checked; });
    var result = modal.onSave(values);
    if (result === false) return;
    closeModal();
    commit();
  });

  // Close on a backdrop click, but not when a text selection that started inside the dialog ends outside it.
  var pressedOnBackdrop = false;
  dialog.addEventListener('mousedown', function (e) { pressedOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) closeModal();
    else if (e.target === dialog && pressedOnBackdrop) closeModal();
  });
  dialog.addEventListener('close', function () { modal = null; });
  document.getElementById('modal-delete').addEventListener('click', function () {
    if (modal && modal.onDelete && confirm(modal.deleteText || 'Delete this?')) {
      modal.onDelete();
      closeModal();
      commit();
    }
  });

  function requireText(value, label) {
    if (value) return true;
    toast(label + ' is required.', { error: true });
    var input = modalForm.querySelector('[name="title"], [name="name"], [name="subject"]');
    if (input) input.focus();
    return false;
  }

  /* ---------- editors ---------- */

  function editNote(id) {
    var n = id ? find('notes', id) : null;
    openModal({
      title: n ? 'Edit note' : 'New note',
      body: field('Title', '<input type="text" name="title" maxlength="200" autofocus value="' + h(n && n.title) + '">') +
        field('Note', '<textarea name="body" rows="8">' + h(n && n.body) + '</textarea>') +
        field('Tags (comma separated)', '<input type="text" name="tags" value="' + h(n && (n.tags || []).join(', ')) + '" placeholder="maths, revision">') +
        '<div class="field"><span class="muted small" style="display:block;font-weight:600;margin-bottom:6px">Colour</span>' + colorPicker('color', n && n.color, true) + '</div>' +
        '<label class="check"><input type="checkbox" name="pinned"' + (n && n.pinned ? ' checked' : '') + '> Pin to Today</label>',
      onSave: function (v) {
        if (!v.title && !v.body) { toast('Write a title or some text first.', { error: true }); return false; }
        var now = new Date().toISOString();
        var data = {
          title: v.title, body: v.body, color: v.color || '', pinned: v.pinned,
          tags: v.tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean), updated: now
        };
        if (n) Object.assign(n, data);
        else state.notes.push(Object.assign({ id: C.uid(), created: now }, data));
      },
      onDelete: n && function () { remove('notes', n.id); },
      deleteText: 'Delete this note?'
    });
  }

  function editReminder(id) {
    var r = id ? find('reminders', id) : null;
    var defaultDue = new Date(Date.now() + 3600000);
    defaultDue.setMinutes(0, 0, 0);
    openModal({
      title: r ? 'Edit reminder' : 'New reminder',
      body: field('Remind me to', '<input type="text" name="title" maxlength="200" autofocus value="' + h(r && r.title) + '">') +
        '<div class="field-grid">' +
        field('When', '<input type="datetime-local" name="due" value="' + h(C.toLocalInput(r ? r.due : defaultDue)) + '">') +
        field('Repeat', '<select name="repeat">' + options(REPEAT, (r && r.repeat) || 'none') + '</select>') +
        '</div>' +
        field('Notes', '<textarea name="notes" rows="3">' + h(r && r.notes) + '</textarea>') +
        (r ? '<label class="check"><input type="checkbox" name="done"' + (r.done ? ' checked' : '') + '> Done</label>' : ''),
      onSave: function (v) {
        if (!requireText(v.title, 'Reminder')) return false;
        var due = v.due ? new Date(v.due).toISOString() : '';
        var data = { title: v.title, due: due, repeat: v.repeat, notes: v.notes };
        if (r) {
          Object.assign(r, data);
          r.done = Boolean(v.done);
        } else {
          state.reminders.push(Object.assign({ id: C.uid(), done: false, created: new Date().toISOString() }, data));
        }
      },
      onDelete: r && function () { remove('reminders', r.id); },
      deleteText: 'Delete this reminder?'
    });
  }

  function editTask(id, preset) {
    var t = id ? find('tasks', id) : null;
    openModal({
      title: t ? 'Edit school task' : 'New school task',
      body: field('Task', '<input type="text" name="title" maxlength="200" autofocus value="' + h(t && t.title) + '" placeholder="Science report">') +
        '<div class="field-grid">' +
        field('Subject', '<select name="subjectId">' + subjectOptions(t ? t.subjectId : (preset && preset.subjectId) || ui.taskSubject, 'No subject') + '</select>') +
        field('Type', '<select name="type">' + options(TASK_TYPES, (t && t.type) || 'assignment') + '</select>') +
        field('Due', '<input type="date" name="due" value="' + h(t ? C.toDateInput(t.due) : '') + '">') +
        field('Status', '<select name="status">' + options(TASK_STATUS, (t && t.status) || 'todo') + '</select>') +
        '</div>' +
        field('Mark / result', '<input type="text" name="mark" value="' + h(t && t.mark) + '" placeholder="18/20, 85%, A">') +
        field('Notes', '<textarea name="notes" rows="3">' + h(t && t.notes) + '</textarea>') +
        (state.subjects.length ? '' : '<p class="muted small">Tip: add your subjects on the School → Subjects tab to colour-code tasks.</p>'),
      onSave: function (v) {
        if (!requireText(v.title, 'Task')) return false;
        var data = { title: v.title, subjectId: v.subjectId, type: v.type, due: v.due, status: v.status, mark: v.mark, notes: v.notes };
        if (t) Object.assign(t, data);
        else state.tasks.push(Object.assign({ id: C.uid(), created: new Date().toISOString() }, data));
      },
      onDelete: t && function () { remove('tasks', t.id); },
      deleteText: 'Delete this task?'
    });
  }

  function editSubject(id) {
    var s = id ? find('subjects', id) : null;
    var nextColor = COLORS[state.subjects.length % COLORS.length];
    openModal({
      title: s ? 'Edit subject' : 'New subject',
      body: field('Subject', '<input type="text" name="name" maxlength="80" autofocus value="' + h(s && s.name) + '" placeholder="English">') +
        '<div class="field-grid">' +
        field('Teacher', '<input type="text" name="teacher" value="' + h(s && s.teacher) + '">') +
        field('Room', '<input type="text" name="room" value="' + h(s && s.room) + '">') +
        '</div>' +
        '<div class="field"><span class="muted small" style="display:block;font-weight:600;margin-bottom:6px">Colour</span>' + colorPicker('color', s ? s.color : nextColor, false) + '</div>',
      onSave: function (v) {
        if (!requireText(v.name, 'Subject name')) return false;
        var data = { name: v.name, teacher: v.teacher, room: v.room, color: v.color || COLORS[0] };
        if (s) Object.assign(s, data);
        else state.subjects.push(Object.assign({ id: C.uid() }, data));
      },
      onDelete: s && function () {
        state.tasks.forEach(function (t) { if (t.subjectId === s.id) t.subjectId = ''; });
        state.emails.forEach(function (e) { if (e.subjectId === s.id) e.subjectId = ''; });
        remove('subjects', s.id);
      },
      deleteText: 'Delete this subject? Its tasks are kept but no longer linked to it.'
    });
  }

  function emailTrackingFields(e) {
    return '<div class="field-grid">' +
      field('Status', '<select name="status">' + options(MAIL_STATUS, e ? e.status : 'new') + '</select>') +
      field('Follow up by', '<input type="date" name="followUp" value="' + h(e ? C.toDateInput(e.followUp) : '') + '">') +
      '</div>' +
      field('Subject / class', '<select name="subjectId">' + subjectOptions(e ? e.subjectId : '', 'Not linked') + '</select>') +
      field('My notes', '<textarea name="note" rows="3">' + h(e && e.note) + '</textarea>');
  }

  function editEmail(id) {
    var e = find('emails', id);
    if (!e) return;
    var reply = 'mailto:' + encodeURIComponent(e.from) + '?subject=' + encodeURIComponent('Re: ' + (e.subject || ''));
    var links = [];
    if (e.webLink) links.push('<a class="btn small" href="' + h(e.webLink) + '" target="_blank" rel="noopener">Open in Outlook ↗</a>');
    if (e.from) links.push('<a class="btn small" href="' + h(reply) + '">Reply ✉</a>');
    openModal({
      title: e.subject || '(no subject)',
      focus: false,
      body: '<p class="small" style="margin:0 0 8px"><b>' + h(e.fromName || e.from || 'Unknown sender') + '</b>' +
        (e.from && e.fromName !== e.from ? ' <span class="muted">&lt;' + h(e.from) + '&gt;</span>' : '') +
        '<br><span class="muted">' + h(e.date ? new Date(e.date).toLocaleString() : '') + ' · ' + h(sourceLabel(e.source)) + '</span></p>' +
        (e.preview ? '<pre class="mail-body">' + h(e.preview) + '</pre>' : '') +
        (links.length ? '<div class="row" style="margin-bottom:14px">' + links.join('') + '</div>' : '') +
        emailTrackingFields(e),
      onSave: function (v) {
        Object.assign(e, { status: v.status, followUp: v.followUp, subjectId: v.subjectId, note: v.note });
      },
      onDelete: function () { remove('emails', e.id); },
      deleteText: e.source === 'outlook' ? 'Stop tracking this email? (It stays in Outlook; the next sync will add it back as New if it is still in your latest 50.)' : 'Stop tracking this email?'
    });
  }

  function sourceLabel(source) {
    return { outlook: 'Synced from Outlook', eml: 'Imported .eml', pasted: 'Pasted', manual: 'Added by hand' }[source] || 'Added by hand';
  }

  function addEmailManually() {
    openModal({
      title: 'Track an email',
      body: field('From (email address)', '<input type="email" name="from" autofocus placeholder="teacher@eq.edu.au">') +
        field('Sender name', '<input type="text" name="fromName">') +
        field('Subject', '<input type="text" name="subject">') +
        field('Received', '<input type="datetime-local" name="date" value="' + h(C.toLocalInput(new Date())) + '">') +
        field('What it says', '<textarea name="preview" rows="3"></textarea>') +
        emailTrackingFields(null),
      onSave: function (v) {
        if (!requireText(v.subject || v.from, 'A subject or sender')) return false;
        state.emails.push(C.newEmail({
          source: 'manual', from: v.from.toLowerCase(), fromName: v.fromName || v.from, subject: v.subject,
          date: v.date ? new Date(v.date).toISOString() : new Date().toISOString(), preview: v.preview,
          status: v.status, followUp: v.followUp, subjectId: v.subjectId, note: v.note
        }));
      }
    });
  }

  function pasteEmail() {
    openModal({
      title: 'Paste an email',
      saveLabel: 'Add email',
      body: '<p class="muted small" style="margin-top:0">In Outlook open the email, select everything from the <b>From:</b> line down, copy, and paste it here. The raw source of a message (View → message source) also works.</p>' +
        field('Email text', '<textarea name="raw" rows="10" autofocus placeholder="From: Teacher &lt;teacher@eq.edu.au&gt;&#10;Sent: Tuesday, 28 October 2026 9:14 AM&#10;To: ' + h(state.settings.email) + '&#10;Subject: Assignment&#10;&#10;Message…"></textarea>') +
        emailTrackingFields(null),
      onSave: function (v) {
        var parsed = C.parseEmail(v.raw);
        if (!parsed.valid) {
          toast('Couldn’t find From: or Subject: lines. Copy from the From: line down.', { error: true });
          return false;
        }
        var email = C.newEmail({
          source: 'pasted', from: parsed.from, fromName: parsed.fromName, subject: parsed.subject,
          date: parsed.date || new Date().toISOString(), preview: parsed.preview,
          status: v.status, followUp: v.followUp, subjectId: v.subjectId, note: v.note
        });
        if (C.isDuplicateEmail(state.emails, email)) { toast('That email is already being tracked.', { error: true }); return false; }
        state.emails.push(email);
        toast('Tracking “' + (email.subject || '(no subject)') + '”');
      }
    });
  }

  function importEml(files) {
    if (!files || !files.length) return;
    readFiles(files).then(function (results) {
      var added = 0, skipped = 0, failed = 0;
      results.forEach(function (f) {
        if (f.text == null) { failed++; return; }
        var parsed = C.parseEmail(f.text);
        if (!parsed.valid) { failed++; return; }
        var email = C.newEmail({
          source: 'eml', from: parsed.from, fromName: parsed.fromName, subject: parsed.subject,
          date: parsed.date || new Date().toISOString(), preview: parsed.preview
        });
        if (C.isDuplicateEmail(state.emails, email)) { skipped++; return; }
        state.emails.push(email);
        added++;
      });
      commit();
      var parts = ['Imported ' + added + ' email' + (added === 1 ? '' : 's')];
      if (skipped) parts.push(skipped + ' already tracked');
      if (failed) parts.push(failed + ' not readable as email');
      toast(parts.join(', ') + '.', { error: added === 0 && failed > 0 });
    });
  }

  /* ---------- Outlook sync ---------- */

  function graphConfig() {
    return { clientId: state.settings.msClientId, tenant: state.settings.msTenant || 'organizations', email: state.settings.email };
  }

  function outlookReady() {
    return G.canRun() && Boolean(state.settings.msClientId);
  }

  function syncOutlook(quiet) {
    if (ui.syncing) return;
    if (!outlookReady()) {
      if (!quiet) {
        toast(G.canRun() ? 'Connect Outlook in Settings first.' : 'Outlook sync only works on the GitHub Pages version of the app.', { error: true });
        location.hash = '#settings';
      }
      return;
    }
    if (!G.signedIn()) {
      if (!quiet) G.signIn(graphConfig()).catch(function (err) { toast(err.message, { error: true }); });
      return;
    }
    ui.syncing = true;
    refresh();
    G.fetchInbox(graphConfig(), 50).then(function (res) {
      var merged = C.mergeGraphMessages(state.emails, res.messages);
      state.emails = merged.emails;
      state.settings.lastSync = new Date().toISOString();
      ui.syncing = false;
      save();
      refresh();
      if (res.account && res.account !== state.settings.email.toLowerCase()) {
        toast('Signed in as ' + res.account + ', not ' + state.settings.email + '.', { error: true, sticky: true });
      }
      if (!quiet || merged.added) toast(merged.added ? merged.added + ' new email' + (merged.added === 1 ? '' : 's') + ' from Outlook.' : 'Outlook is up to date.');
    }).catch(function (err) {
      ui.syncing = false;
      refresh();
      if (!quiet || !G.signedIn()) toast(err.message, { error: true, sticky: true });
    });
  }

  /* ---------- reminders firing ---------- */

  function checkReminders() {
    var due = C.dueReminders(state.reminders, new Date());
    if (!due.length) return;
    due.forEach(function (r) {
      r.notifiedFor = r.due;
      var firedFor = r.due;
      toast('⏰ ' + r.title, { sticky: true, action: { label: 'Done', run: function () {
        // Only if it is still this occurrence and not already ticked off elsewhere.
        var current = find('reminders', r.id);
        if (current && !current.done && current.due === firedFor) completeReminder(r.id);
      } } });
      if (window.Notification && Notification.permission === 'granted') {
        try { new Notification('Reminder', { body: r.title, icon: 'icon.svg', tag: r.id }); }
        catch (e) { /* Android Chrome needs a service worker for notifications; the toast above still shows. */ }
      }
    });
    save();
    refresh();
  }

  function completeReminder(id) {
    var r = find('reminders', id);
    if (!r) return;
    if (!r.done && r.repeat && r.repeat !== 'none' && r.due) {
      r.due = C.nextRepeat(r.due, r.repeat, new Date());
      toast('Next one: ' + C.formatDue(r.due));
    } else {
      r.done = !r.done;
      r.doneAt = r.done ? new Date().toISOString() : null;
    }
    commit();
  }

  function toggleTask(id) {
    var t = find('tasks', id);
    if (!t) return;
    t.status = t.status === 'done' ? 'todo' : 'done';
    commit();
  }

  /* ---------- views ---------- */

  function itemRow(opts) {
    return '<div class="item' + (opts.done ? ' is-done' : '') + (opts.unread ? ' unread' : '') + '" role="button" tabindex="0" data-action="' + opts.action + '" data-id="' + h(opts.id) + '">' +
      (opts.lead || '') +
      '<div class="main"><div class="title">' + h(opts.title) + '</div>' +
      (opts.meta ? '<div class="meta">' + opts.meta + '</div>' : '') +
      (opts.extra || '') + '</div>' + (opts.trail || '') + '</div>';
  }

  function reminderRow(r) {
    return itemRow({
      action: 'edit-reminder', id: r.id, title: r.title, done: r.done,
      lead: '<input type="checkbox" class="tick" data-change="toggle-reminder" data-id="' + h(r.id) + '"' + (r.done ? ' checked' : '') + ' aria-label="Mark done">',
      meta: duePill(r.due, r.done) + (r.repeat && r.repeat !== 'none' ? '<span>↻ ' + h(REPEAT[r.repeat]) + '</span>' : '') +
        (r.notes ? '<span>' + h(r.notes.slice(0, 80)) + '</span>' : '')
    });
  }

  function taskRow(t) {
    var s = subjectOf(t.subjectId);
    return itemRow({
      action: 'edit-task', id: t.id, title: t.title, done: t.status === 'done',
      lead: '<input type="checkbox" class="tick" data-change="toggle-task" data-id="' + h(t.id) + '"' + (t.status === 'done' ? ' checked' : '') + ' aria-label="Mark done">',
      meta: subjectChip(s) + '<span>' + h(TASK_TYPES[t.type] || 'Task') + '</span>' + duePill(t.due, t.status === 'done') +
        (t.mark ? '<span class="pill">' + h(t.mark) + '</span>' : ''),
      trail: '<select class="inline" data-change="task-status" data-id="' + h(t.id) + '" aria-label="Status">' + options(TASK_STATUS, t.status || 'todo') + '</select>'
    });
  }

  function emailRow(e) {
    var s = subjectOf(e.subjectId);
    var initial = (e.fromName || e.from || '?').trim().charAt(0).toUpperCase();
    return itemRow({
      action: 'edit-email', id: e.id, title: e.subject || '(no subject)', done: e.status === 'done', unread: e.status === 'new',
      lead: '<span class="kind" aria-hidden="true">' + h(initial) + '</span>',
      meta: '<span>' + h(e.fromName || e.from || 'Unknown') + '</span><span>' + h(C.formatDue(e.date)) + '</span>' +
        (e.followUp && e.status !== 'done' ? '<span>Follow up ' + duePill(e.followUp) + '</span>' : '') + subjectChip(s),
      extra: e.preview ? '<div class="mail-preview">' + h(e.preview) + '</div>' : '',
      trail: '<select class="inline" data-change="email-status" data-id="' + h(e.id) + '" aria-label="Status">' + options(MAIL_STATUS, e.status) + '</select>'
    });
  }

  function noteCard(n) {
    return '<article class="card note" role="button" tabindex="0" data-action="edit-note" data-id="' + h(n.id) + '"' +
      (n.color ? ' style="--note:' + h(n.color) + '"' : '') + '>' +
      (n.title ? '<h3>' + (n.pinned ? '📌 ' : '') + h(n.title) + '</h3>' : '') +
      (n.body ? '<p>' + h(n.body) + '</p>' : '') +
      '<footer>' + (n.tags || []).map(function (t) { return '<span class="pill">' + h(t) + '</span>'; }).join('') +
      '<span class="grow"></span><span>' + h(C.formatDue(n.updated || n.created)) + '</span></footer></article>';
  }

  function grouped(items, dateOf, rowFn) {
    var now = new Date();
    return GROUPS.map(function (g) {
      var rows = items.filter(function (x) { return C.dueStatus(dateOf(x), now) === g[0]; });
      if (!rows.length) return '';
      return '<h2 class="section">' + g[1] + ' · ' + rows.length + '</h2><div class="list">' + rows.map(rowFn).join('') + '</div>';
    }).join('');
  }

  function byDate(field, dir) {
    return function (a, b) {
      var x = C.toDate(a[field]), y = C.toDate(b[field]);
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return (x - y) * (dir || 1);
    };
  }

  var views = {};

  views.today = function () {
    var now = new Date();
    var up = C.upcoming(state, now, 7);
    var count = function (s) { return up.filter(function (i) { return i.status === s; }).length; };
    var toReply = state.emails.filter(function (e) { return e.status === 'reply' || e.status === 'new'; });
    var pinned = state.notes.filter(function (n) { return n.pinned; });
    var icon = { reminder: '🔔', task: '📚', email: '✉️' };
    var action = { reminder: 'edit-reminder', task: 'edit-task', email: 'edit-email' };
    var list = up.map(function (i) {
      var t = i.kind === 'task' ? find('tasks', i.id) : null;
      return itemRow({
        action: action[i.kind], id: i.id, title: i.title,
        lead: '<span class="kind" aria-hidden="true">' + icon[i.kind] + '</span>',
        meta: '<span class="pill ' + i.status + '">' + h(C.formatDue(i.when, now)) + '</span>' +
          (t ? subjectChip(subjectOf(t.subjectId)) : '') + (i.kind === 'email' ? '<span>Email follow-up</span>' : '')
      });
    }).join('');
    return '<div class="page-head"><div><h1>' + h(greeting()) + '</h1><p class="sub">' +
      h(now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })) + '</p></div></div>' +
      '<div class="stats">' +
      '<div class="card stat' + (count('overdue') ? ' alert' : '') + '" role="button" tabindex="0" data-action="go" data-view="reminders"><b>' + count('overdue') + '</b><span>Overdue</span></div>' +
      '<div class="card stat" role="button" tabindex="0" data-action="go" data-view="reminders"><b>' + count('today') + '</b><span>Due today</span></div>' +
      '<div class="card stat" role="button" tabindex="0" data-action="go" data-view="school"><b>' + count('soon') + '</b><span>Next 7 days</span></div>' +
      '<div class="card stat" role="button" tabindex="0" data-action="go" data-view="email"><b>' + toReply.length + '</b><span>Emails to deal with</span></div>' +
      '</div>' +
      '<div class="quick"><button class="btn primary" data-action="new-reminder">＋ Reminder</button>' +
      '<button class="btn" data-action="new-task">＋ School task</button><button class="btn" data-action="new-note">＋ Note</button>' +
      '<button class="btn" data-action="go" data-view="email">✉ Emails</button></div>' +
      '<h2 class="section">Coming up</h2>' +
      (list ? '<div class="list">' + list + '</div>' : empty('Nothing due in the next week. Nice. 🎉')) +
      (pinned.length ? '<h2 class="section">Pinned notes</h2><div class="notes-grid">' + pinned.map(noteCard).join('') + '</div>' : '') +
      (toReply.length ? '<h2 class="section">Emails to deal with</h2><div class="list">' +
        toReply.sort(byDate('date', -1)).slice(0, 5).map(emailRow).join('') + '</div>' : '');
  };

  views.notes = function () {
    var list = state.notes.filter(function (n) { return C.matches(n, ui.notesQuery, ['title', 'body', 'tags']); })
      .sort(function (a, b) {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || ''));
      });
    return '<div class="page-head"><h1>Notes</h1><span class="grow"></span>' +
      '<input type="search" class="search" id="notes-search" data-input="notes-query" placeholder="Search notes  ( / )" value="' + h(ui.notesQuery) + '" aria-label="Search notes">' +
      '<button class="btn primary" data-action="new-note">＋ New note</button></div>' +
      (list.length ? '<div class="notes-grid">' + list.map(noteCard).join('') + '</div>' :
        empty(ui.notesQuery ? 'No notes match “' + h(ui.notesQuery) + '”.' : 'No notes yet. Press <b>＋ New note</b> (or <b>N</b>) to write one.'));
  };

  views.reminders = function () {
    var open = state.reminders.filter(function (r) { return !r.done; }).sort(byDate('due'));
    var done = state.reminders.filter(function (r) { return r.done; }).sort(byDate('doneAt', -1));
    var perm = window.Notification ? Notification.permission : 'unsupported';
    return '<div class="page-head"><h1>Reminders</h1><span class="grow"></span>' +
      (perm === 'default' ? '<button class="btn" data-action="enable-notifications">🔔 Turn on alerts</button>' : '') +
      '<button class="btn primary" data-action="new-reminder">＋ New reminder</button></div>' +
      '<form class="card row" style="padding:10px" data-submit="quick-reminder">' +
      '<input type="text" name="title" placeholder="Quick reminder…" aria-label="Reminder" style="flex:2 1 200px" required>' +
      '<input type="datetime-local" name="due" aria-label="When" style="flex:1 1 180px;width:auto">' +
      '<button class="btn primary" type="submit">Add</button></form>' +
      (open.length ? grouped(open, function (r) { return r.due; }, reminderRow) : '<div style="margin-top:16px">' + empty('No reminders. Add one above.') + '</div>') +
      (done.length ? '<h2 class="section"><button class="chip" data-action="toggle-done-reminders">' +
        (ui.showDoneReminders ? 'Hide' : 'Show') + ' done (' + done.length + ')</button></h2>' +
        (ui.showDoneReminders ? '<div class="list">' + done.map(reminderRow).join('') + '</div>' : '') : '');
  };

  views.school = function () {
    var tabs = '<div class="chips" role="tablist">' +
      '<button class="chip' + (ui.schoolTab === 'tasks' ? ' on' : '') + '" role="tab" data-action="school-tab" data-tab="tasks">Tasks & assessments</button>' +
      '<button class="chip' + (ui.schoolTab === 'subjects' ? ' on' : '') + '" role="tab" data-action="school-tab" data-tab="subjects">Subjects (' + state.subjects.length + ')</button></div>';
    if (ui.schoolTab === 'subjects') {
      var cards = state.subjects.map(function (s) {
        var openCount = state.tasks.filter(function (t) { return t.subjectId === s.id && t.status !== 'done'; }).length;
        var avg = C.subjectAverage(state.tasks, s.id);
        return '<article class="card subject" role="button" tabindex="0" data-action="edit-subject" data-id="' + h(s.id) + '" style="--subj:' + h(s.color) + '">' +
          '<h3>' + h(s.name) + '</h3><div class="muted small">' + h([s.teacher, s.room].filter(Boolean).join(' · ') || ' ') + '</div>' +
          '<div class="row" style="margin-top:10px;justify-content:space-between"><span class="small">' + openCount + ' open task' + (openCount === 1 ? '' : 's') + '</span>' +
          (avg !== null ? '<span class="avg" title="Average of marks you entered">' + Math.round(avg) + '%</span>' : '<span class="muted small">No marks yet</span>') +
          '</div></article>';
      }).join('');
      return '<div class="page-head"><h1>School</h1><span class="grow"></span><button class="btn primary" data-action="new-subject">＋ New subject</button></div>' +
        tabs + '<div style="margin-top:16px">' + (cards ? '<div class="subjects">' + cards + '</div>' : empty('Add your subjects (English, Maths, Science…) to colour-code tasks and see average marks.')) + '</div>';
    }
    var tasks = state.tasks.filter(function (t) {
      if (ui.taskSubject && t.subjectId !== ui.taskSubject) return false;
      if (ui.taskFilter === 'open') return t.status !== 'done';
      if (ui.taskFilter === 'done') return t.status === 'done';
      return true;
    });
    var body;
    if (!tasks.length) body = empty(state.tasks.length ? 'Nothing here with these filters.' : 'No school tasks yet. Add assignments, exams and homework with <b>＋ New task</b>.');
    else if (ui.taskFilter === 'open') body = grouped(tasks.sort(byDate('due')), function (t) { return t.due; }, taskRow);
    else body = '<div class="list" style="margin-top:16px">' + tasks.sort(byDate('due', -1)).map(taskRow).join('') + '</div>';
    return '<div class="page-head"><h1>School</h1><span class="grow"></span><button class="btn primary" data-action="new-task">＋ New task</button></div>' +
      tabs +
      '<div class="row" style="margin-top:12px"><div class="chips">' +
      [['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(function (f) {
        return '<button class="chip' + (ui.taskFilter === f[0] ? ' on' : '') + '" data-action="task-filter" data-filter="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div><span class="grow"></span>' +
      '<select data-change="task-subject" aria-label="Filter by subject" style="width:auto;min-width:160px">' + subjectOptions(ui.taskSubject, 'All subjects') + '</select></div>' +
      body;
  };

  views.email = function () {
    var q = ui.mailQuery;
    var pool = state.emails.filter(function (e) { return !ui.eqOnly || /(^|\.)eq\.edu\.au$/.test(C.emailDomain(e.from)); });
    var list = pool.filter(function (e) {
      if (ui.mailFilter === 'open' && e.status === 'done') return false;
      if (ui.mailFilter !== 'open' && ui.mailFilter !== 'all' && e.status !== ui.mailFilter) return false;
      return C.matches(e, q, ['subject', 'from', 'fromName', 'preview', 'note']);
    }).sort(byDate('date', -1));
    var notice = '';
    if (!G.canRun()) {
      notice = '<div class="notice">You opened this file straight from your computer, so Outlook sync is off here (Microsoft sign-in needs the web version). ' +
        'Import <b>.eml</b> files or paste emails instead, or use the GitHub Pages link.</div>';
    } else if (!state.settings.msClientId) {
      notice = '<div class="notice">Want emails from <b>' + h(state.settings.email) + '</b> to appear automatically? <a href="#settings">Connect Outlook in Settings</a>. ' +
        'Until then, import <b>.eml</b> files or paste emails.</div>';
    }
    var syncLabel = ui.syncing ? 'Syncing…' : !G.canRun() ? '⟳ Outlook sync (web version)' : outlookReady() && G.signedIn() ? '⟳ Sync Outlook' : '⟳ Connect Outlook';
    return '<div class="page-head"><div><h1>Email</h1><p class="sub">Tracking mail for <b>' + h(state.settings.email) + '</b>' +
      (state.settings.lastSync ? ' · synced ' + h(C.formatDue(state.settings.lastSync)) : '') + '</p></div></div>' +
      notice +
      '<div class="mail-tools">' +
      '<button class="btn primary" data-action="sync"' + (ui.syncing ? ' disabled' : '') + '>' + syncLabel + '</button>' +
      '<label class="btn" tabindex="0">⬆ Import .eml<input type="file" id="eml-input" accept=".eml,message/rfc822" multiple hidden></label>' +
      '<button class="btn" data-action="paste-email">📋 Paste email</button>' +
      '<button class="btn" data-action="add-email">＋ Add by hand</button>' +
      '<a class="btn" href="https://outlook.office.com/mail/" target="_blank" rel="noopener">Open Outlook ↗</a>' +
      '</div>' +
      '<div class="row" style="margin-bottom:6px"><div class="chips scroll-chips">' +
      [['open', 'Open'], ['new', 'New'], ['reply', 'Needs reply'], ['waiting', 'Waiting'], ['done', 'Done'], ['all', 'All']].map(function (f) {
        var n = f[0] === 'all' ? pool.length : pool.filter(function (e) { return f[0] === 'open' ? e.status !== 'done' : e.status === f[0]; }).length;
        return '<button class="chip' + (ui.mailFilter === f[0] ? ' on' : '') + '" data-action="mail-filter" data-filter="' + f[0] + '">' + f[1] + ' ' + n + '</button>';
      }).join('') +
      '<button class="chip' + (ui.eqOnly ? ' on' : '') + '" data-action="toggle-eq" title="Only show mail sent from Education Queensland addresses">From @eq.edu.au only</button>' +
      '</div><span class="grow"></span>' +
      '<input type="search" class="search" id="mail-search" data-input="mail-query" placeholder="Search emails  ( / )" value="' + h(q) + '" aria-label="Search emails"></div>' +
      (list.length ? '<div class="list" style="margin-top:12px">' + list.map(emailRow).join('') + '</div>' :
        '<div style="margin-top:12px">' + empty(state.emails.length ? 'No emails match these filters.' :
          'No emails tracked yet.<br>Sync Outlook, drop <b>.eml</b> files here, or paste an email.') + '</div>') +
      '<p class="muted small" style="margin-top:18px">Tip: in Outlook on the web, open a message → ⋯ → <b>Download</b> (or drag it to your desktop) to get an .eml file.</p>';
  };

  views.settings = function () {
    var s = state.settings;
    var perm = window.Notification ? Notification.permission : 'unsupported';
    var permText = { granted: 'On', denied: 'Blocked in your browser settings', 'default': 'Off', unsupported: 'Not supported in this browser' }[perm];
    var signed = G.signedIn();
    return '<div class="page-head"><h1>Settings</h1></div><div class="settings">' +
      '<form class="card" data-submit="profile"><h3>You</h3>' +
      '<div class="field-grid">' + field('Your name', '<input type="text" name="name" value="' + h(s.name) + '" autocomplete="given-name">') +
      field('School email', '<input type="email" name="email" value="' + h(s.email) + '" required>') + '</div>' +
      '<button class="btn primary" type="submit">Save</button></form>' +

      '<section class="card"><h3>Look & alerts</h3><div class="field-grid">' +
      field('Theme', '<select data-change="theme">' + options({ system: 'Match device', light: 'Light', dark: 'Dark' }, s.theme) + '</select>') +
      '<div class="field"><span class="muted small" style="display:block;font-weight:600;margin-bottom:5px">Reminder alerts</span>' +
      '<div class="row"><span>' + h(permText) + '</span>' + (perm === 'default' ? '<button class="btn small" data-action="enable-notifications">Turn on</button>' : '') + '</div></div>' +
      '</div><p class="muted small" style="margin:0">Reminders pop up inside the app while it is open. With alerts on, your computer also shows a notification.</p></section>' +

      '<form class="card" data-submit="outlook"><h3>Outlook email (' + h(s.email) + ')</h3>' +
      '<p class="small" style="margin-top:0">Status: <b>' + (!G.canRun() ? 'unavailable when opened from a file — use the GitHub Pages version' : signed ? 'signed in' : s.msClientId ? 'ready to sign in' : 'not set up') + '</b></p>' +
      '<details' + (s.msClientId ? '' : ' open') + '><summary class="small" style="cursor:pointer;font-weight:600">How to connect (one-time, ~5 minutes)</summary><ol class="small">' +
      '<li>Open this app from its GitHub Pages address (not the file on your computer).</li>' +
      '<li>Go to <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Microsoft Entra → App registrations</a> and choose <b>New registration</b>.</li>' +
      '<li>Name it <b>School Hub</b>; for account types pick <b>Accounts in any organizational directory</b>.</li>' +
      '<li>Under <b>Redirect URI</b> choose <b>Single-page application (SPA)</b> and enter: <code>' + h(G.canRun() ? G.redirectUri() : 'https://<your-username>.github.io/school-hub/') + '</code></li>' +
      '<li>Register, then copy the <b>Application (client) ID</b> into the box below and press Save.</li>' +
      '<li>Press <b>Sign in</b> and log in with ' + h(s.email) + '.</li></ol>' +
      '<p class="small muted">School accounts can block apps that an IT admin hasn’t approved. If Microsoft says <i>“Need admin approval”</i>, ask school IT, or keep using .eml import / paste on the Email page — those always work.</p></details>' +
      '<div class="field-grid">' + field('Application (client) ID', '<input type="text" name="msClientId" value="' + h(s.msClientId) + '" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false">') +
      field('Tenant', '<input type="text" name="msTenant" value="' + h(s.msTenant) + '" spellcheck="false">') + '</div>' +
      '<div class="row"><button class="btn" type="submit">Save</button>' +
      (signed ? '<button class="btn" type="button" data-action="sync">Sync now</button><button class="btn danger" type="button" data-action="sign-out">Sign out</button>'
        : '<button class="btn primary" type="button" data-action="sign-in"' + (outlookReady() ? '' : ' disabled') + '>Sign in</button>') +
      '</div></form>' +

      '<section class="card"><h3>Your data</h3><p class="small muted" style="margin-top:0">Everything is stored only in this browser on this device. ' +
      'Export a backup to move it to another device (e.g. laptop → phone) and import it there.</p>' +
      '<div class="row"><button class="btn" data-action="export">⬇ Export backup</button>' +
      '<label class="btn" tabindex="0">⬆ Import backup<input type="file" id="backup-input" accept=".json,application/json" hidden></label>' +
      '<span class="grow"></span><button class="btn danger" data-action="erase">Erase everything</button></div>' +
      '<p class="small muted" style="margin-bottom:0">' + state.notes.length + ' notes · ' + state.reminders.length + ' reminders · ' + state.tasks.length + ' tasks · ' +
      state.subjects.length + ' subjects · ' + state.emails.length + ' emails</p></section>' +
      '<p class="small muted">Keyboard: <b>N</b> new item · <b>/</b> search · <b>1–6</b> switch page · <b>Esc</b> close</p>' +
      '</div>';
  };

  /* ---------- render ---------- */

  function currentView() {
    var v = location.hash.replace('#', '');
    return VIEWS.indexOf(v) === -1 ? 'today' : v;
  }

  function applyTheme() {
    if (state.settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', state.settings.theme);
  }

  /* Stable key for a form control across re-renders (id, or form + field name). */
  function fieldKey(el) {
    if (el.id) return '#' + el.id;
    if (!el.name) return null;
    var form = el.closest('form[data-submit]');
    return (form ? form.getAttribute('data-submit') : '') + ':' + el.name;
  }

  function findField(key) {
    var fields = main.querySelectorAll('input, textarea, select');
    for (var i = 0; i < fields.length; i++) if (fieldKey(fields[i]) === key) return fields[i];
    return null;
  }

  function render() {
    var view = currentView();
    var active = document.activeElement;
    var focusKey = active && main.contains(active) ? fieldKey(active) : null;
    var selection = null;
    try { selection = focusKey ? { start: active.selectionStart, end: active.selectionEnd } : null; } catch (e) { selection = null; }
    main.innerHTML = views[view]();
    document.querySelectorAll('.nav a').forEach(function (a) {
      var on = a.getAttribute('data-view') === view;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var fresh = state.emails.filter(function (e) { return e.status === 'new'; }).length;
    var badge = document.getElementById('email-badge');
    badge.hidden = !fresh;
    badge.textContent = fresh > 99 ? '99+' : String(fresh);
    document.title = (view === 'today' ? '' : view.charAt(0).toUpperCase() + view.slice(1) + ' · ') + 'School Hub';
    applyTheme();
    var el = focusKey && findField(focusKey);
    if (el) {
      el.focus();
      try { if (selection) el.setSelectionRange(selection.start, selection.end); } catch (e) { /* not a text input */ }
    }
  }

  /* Re-render for changes the user didn't make (reminder firing, sync, other tab),
     keeping anything the user has half-typed (fields whose value differs from what was rendered). */
  function refresh() {
    var typed = {};
    main.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea').forEach(function (el) {
      var key = fieldKey(el);
      if (key && el.value !== el.defaultValue) typed[key] = el.value;
    });
    var active = document.activeElement;
    var caret = null;
    try { caret = active && main.contains(active) ? [active.selectionStart, active.selectionEnd] : null; } catch (e) { caret = null; }
    render();
    Object.keys(typed).forEach(function (key) {
      var el = findField(key);
      if (el && el.value !== typed[key]) el.value = typed[key];
    });
    var focused = document.activeElement;
    if (caret && caret[0] != null && main.contains(focused)) {
      try { focused.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text input */ }
    }
  }

  function newForView() {
    var v = currentView();
    if (v === 'notes') editNote();
    else if (v === 'school') { if (ui.schoolTab === 'subjects') editSubject(); else editTask(); }
    else if (v === 'email') pasteEmail();
    else editReminder();
  }

  /* ---------- events ---------- */

  var actions = {
    go: function (el) { location.hash = '#' + el.getAttribute('data-view'); },
    'new-note': function () { editNote(); },
    'new-reminder': function () { editReminder(); },
    'new-task': function () { editTask(); },
    'new-subject': function () { editSubject(); },
    'edit-note': function (el) { editNote(el.getAttribute('data-id')); },
    'edit-reminder': function (el) { editReminder(el.getAttribute('data-id')); },
    'edit-task': function (el) { editTask(el.getAttribute('data-id')); },
    'edit-subject': function (el) { editSubject(el.getAttribute('data-id')); },
    'edit-email': function (el) { editEmail(el.getAttribute('data-id')); },
    'toggle-done-reminders': function () { ui.showDoneReminders = !ui.showDoneReminders; render(); },
    'school-tab': function (el) { ui.schoolTab = el.getAttribute('data-tab'); render(); },
    'task-filter': function (el) { ui.taskFilter = el.getAttribute('data-filter'); render(); },
    'mail-filter': function (el) { ui.mailFilter = el.getAttribute('data-filter'); render(); },
    'toggle-eq': function () { ui.eqOnly = !ui.eqOnly; render(); },
    sync: function () { syncOutlook(false); },
    'sign-in': function () { G.signIn(graphConfig()).catch(function (err) { toast(err.message, { error: true }); }); },
    'sign-out': function () { G.signOut(); toast('Signed out of Outlook. Tracked emails are kept.'); render(); },
    'paste-email': pasteEmail,
    'add-email': addEmailManually,
    'enable-notifications': function () {
      if (!window.Notification) return;
      Notification.requestPermission().then(function (p) {
        toast(p === 'granted' ? 'Alerts are on.' : 'Alerts were not allowed. You will still see reminders inside the app.');
        render();
      });
    },
    export: function () {
      download('school-hub-backup-' + C.toDateInput(new Date()) + '.json', JSON.stringify(state, null, 2));
    },
    erase: function () {
      if (!confirm('Erase ALL notes, reminders, school tasks and tracked emails on this device? This cannot be undone.')) return;
      var keep = { email: state.settings.email, msClientId: state.settings.msClientId, msTenant: state.settings.msTenant };
      state = C.defaultState();
      Object.assign(state.settings, keep);
      commit();
      toast('Everything was erased.');
    }
  };

  main.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || !main.contains(el)) return;
    // Controls inside a clickable row act on their own, without opening the row.
    if (el.classList.contains('item') && e.target.closest('select, input, a, label, button')) return;
    var fn = actions[el.getAttribute('data-action')];
    if (fn) fn(el, e);
  });

  main.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action], label.btn')) {
      e.preventDefault();
      e.target.click();
    }
  });

  main.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'eml-input') { importEml(el.files); el.value = ''; return; }
    if (el.id === 'backup-input') { importBackup(el.files[0]); el.value = ''; return; }
    var kind = el.getAttribute('data-change');
    var id = el.getAttribute('data-id');
    if (kind === 'toggle-reminder') completeReminder(id);
    else if (kind === 'toggle-task') toggleTask(id);
    else if (kind === 'task-status') { find('tasks', id).status = el.value; commit(); }
    else if (kind === 'email-status') { find('emails', id).status = el.value; commit(); }
    else if (kind === 'task-subject') { ui.taskSubject = el.value; render(); }
    else if (kind === 'theme') { state.settings.theme = el.value; commit(); }
  });

  main.addEventListener('input', function (e) {
    var kind = e.target.getAttribute('data-input');
    if (kind === 'notes-query') { ui.notesQuery = e.target.value; render(); }
    else if (kind === 'mail-query') { ui.mailQuery = e.target.value; render(); }
  });

  main.addEventListener('submit', function (e) {
    var form = e.target;
    var kind = form.getAttribute('data-submit');
    if (!kind) return;
    e.preventDefault();
    var v = {};
    new FormData(form).forEach(function (val, k) { v[k] = String(val).trim(); });
    if (kind === 'quick-reminder') {
      if (!v.title) return;
      state.reminders.push({ id: C.uid(), title: v.title, due: v.due ? new Date(v.due).toISOString() : '', repeat: 'none', notes: '', done: false, created: new Date().toISOString() });
      commit();
      var input = main.querySelector('[data-submit="quick-reminder"] input[name="title"]');
      if (input) input.focus();
    } else if (kind === 'profile') {
      if (!/^[^\s@]+@[^\s@]+$/.test(v.email)) { toast('Enter a valid email address.', { error: true }); return; }
      state.settings.name = v.name;
      state.settings.email = v.email.toLowerCase();
      commit();
      toast('Saved.');
    } else if (kind === 'outlook') {
      if (v.msClientId && !/^[0-9a-f-]{36}$/i.test(v.msClientId)) { toast('The client ID should look like 00000000-0000-0000-0000-000000000000.', { error: true }); return; }
      if (v.msClientId !== state.settings.msClientId) G.signOut();
      state.settings.msClientId = v.msClientId;
      state.settings.msTenant = v.msTenant || 'organizations';
      commit();
      toast('Outlook settings saved.');
    }
  });

  function importBackup(file) {
    if (!file) return;
    readFiles([file]).then(function (res) {
      var parsed;
      try { parsed = JSON.parse(res[0].text); } catch (err) { toast('That file is not a School Hub backup.', { error: true }); return; }
      if (!parsed || typeof parsed !== 'object' || !parsed.settings) { toast('That file is not a School Hub backup.', { error: true }); return; }
      if (!confirm('Replace everything on this device with the backup?')) return;
      state = C.migrate(parsed);
      commit();
      toast('Backup restored.');
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || dialog.open) return;
    var t = e.target;
    if (t.matches && t.matches('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newForView(); }
    else if (e.key === '/') {
      var search = main.querySelector('.search');
      if (search) { e.preventDefault(); search.focus(); }
    } else if (/^[1-6]$/.test(e.key)) { location.hash = '#' + VIEWS[+e.key - 1]; }
  });

  // Drag & drop .eml files anywhere on the Email page.
  var dragDepth = 0;
  var hint = document.getElementById('drop-hint');
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
  window.addEventListener('dragenter', function (e) { if (currentView() === 'email' && hasFiles(e)) { dragDepth++; hint.hidden = false; } });
  window.addEventListener('dragleave', function () { if (dragDepth > 0 && --dragDepth === 0) hint.hidden = true; });
  window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    hint.hidden = true;
    if (currentView() === 'email') importEml(e.dataTransfer.files);
    else toast('Go to the Email page to drop .eml files.');
  });

  window.addEventListener('hashchange', function () { closeModal(); render(); window.scrollTo(0, 0); });
  window.addEventListener('storage', function (e) { if (e.key === C.STORAGE_KEY) { state = load(); refresh(); } });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    checkReminders();
    if (outlookReady() && G.signedIn() && (!state.settings.lastSync || Date.now() - new Date(state.settings.lastSync) > SYNC_EVERY)) syncOutlook(true);
  });

  /* ---------- start ---------- */

  // Browsers refuse to load a manifest from file://, so only add it on the hosted site.
  if (location.protocol !== 'file:') {
    var manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = 'manifest.webmanifest';
    document.head.appendChild(manifest);
  }

  render();
  checkReminders();
  setInterval(checkReminders, 15000);
  setInterval(function () { if (document.visibilityState === 'visible' && outlookReady() && G.signedIn()) syncOutlook(true); }, SYNC_EVERY);
  G.handleRedirect().then(function (signedIn) {
    if (signedIn) { toast('Signed in to Outlook.'); syncOutlook(false); }
    else if (outlookReady() && G.signedIn()) syncOutlook(true);
  }).catch(function (err) { toast('Outlook sign-in failed: ' + err.message, { error: true, sticky: true }); render(); });

})();
