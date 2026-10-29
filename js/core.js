/* School Hub core: pure data logic shared by the browser app and the Node tests.
   Classic script (no ES modules) so index.html also works when opened from file://. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'schoolhub:v1';
  var DEFAULT_EMAIL = 'tgrim43@eq.edu.au';
  var DAY = 86400000;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function defaultState() {
    return {
      version: 1,
      settings: {
        email: DEFAULT_EMAIL,
        name: '',
        msClientId: '',
        msTenant: 'organizations',
        theme: 'system',
        lastSync: null
      },
      notes: [],
      reminders: [],
      subjects: [],
      tasks: [],
      emails: []
    };
  }

  var COLLECTIONS = ['notes', 'reminders', 'subjects', 'tasks', 'emails'];

  /* Accept anything (old save, hand-edited backup, garbage) and return a valid state. */
  function migrate(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    var settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    Object.keys(base.settings).forEach(function (k) {
      if (settings[k] !== undefined && settings[k] !== null && typeof settings[k] === typeof base.settings[k]) {
        base.settings[k] = settings[k];
      } else if (k === 'lastSync' && typeof settings[k] === 'string') {
        base.settings[k] = settings[k];
      }
    });
    COLLECTIONS.forEach(function (name) {
      var list = Array.isArray(raw[name]) ? raw[name] : [];
      base[name] = list.filter(function (item) { return item && typeof item === 'object' && !Array.isArray(item); })
        .map(function (item) {
          var copy = Object.assign({}, item);
          if (typeof copy.id !== 'string' || !copy.id) copy.id = uid();
          return copy;
        });
    });
    return base;
  }

  /* ---------- dates ---------- */

  /* 'YYYY-MM-DD' is a local calendar day; anything else goes through Date. */
  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(value);
    return isNaN(d) ? null : d;
  }

  function isDateOnly(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dayDiff(date, now) {
    return Math.round((startOfDay(date) - startOfDay(now)) / DAY);
  }

  /* overdue | today | soon (within 7 days) | later | none */
  function dueStatus(value, now) {
    now = now || new Date();
    var d = toDate(value);
    if (!d) return 'none';
    var diff = dayDiff(d, now);
    if (diff < 0) return 'overdue';
    if (!isDateOnly(value) && d < now) return 'overdue';
    if (diff === 0) return 'today';
    if (diff <= 7) return 'soon';
    return 'later';
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toLocalInput(value) {
    var d = toDate(value);
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function toDateInput(value) {
    var d = toDate(value);
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function formatTime(d) {
    var h = d.getHours();
    return (h % 12 || 12) + ':' + pad(d.getMinutes()) + (h < 12 ? 'am' : 'pm');
  }

  /* Human label: "Today 3:30pm", "Tomorrow", "Fri 31 Oct", "2 days ago". */
  function formatDue(value, now) {
    now = now || new Date();
    var d = toDate(value);
    if (!d) return '';
    var diff = dayDiff(d, now);
    var time = isDateOnly(value) ? '' : ' ' + formatTime(d);
    if (diff === 0) return 'Today' + time;
    if (diff === 1) return 'Tomorrow' + time;
    if (diff === -1) return 'Yesterday' + time;
    if (diff < -1 && diff >= -6) return (-diff) + ' days ago';
    var label = WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (d.getFullYear() !== now.getFullYear()) label += ' ' + d.getFullYear();
    return label + time;
  }

  function addPeriod(d, repeat) {
    var n = new Date(d.getTime());
    if (repeat === 'daily') n.setDate(n.getDate() + 1);
    else if (repeat === 'weekly') n.setDate(n.getDate() + 7);
    else if (repeat === 'monthly') n.setMonth(n.getMonth() + 1);
    else return null;
    return n;
  }

  /* Next occurrence strictly after `now` (missed occurrences are skipped). */
  function nextRepeat(dueIso, repeat, now) {
    now = now || new Date();
    var d = toDate(dueIso);
    if (!d) return null;
    var next = addPeriod(d, repeat);
    if (!next) return null;
    while (next <= now) next = addPeriod(next, repeat);
    return next.toISOString();
  }

  /* ---------- school ---------- */

  /* "18/20" -> 90, "85%" -> 85, "85" -> 85; letter grades -> null. */
  function markPercent(mark) {
    if (mark == null) return null;
    var s = String(mark).trim();
    var frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
    if (frac) return +frac[2] > 0 ? (+frac[1] / +frac[2]) * 100 : null;
    var pct = /^(\d+(?:\.\d+)?)\s*%?$/.exec(s);
    if (pct && +pct[1] <= 100) return +pct[1];
    return null;
  }

  function subjectAverage(tasks, subjectId) {
    var marks = tasks.filter(function (t) { return t.subjectId === subjectId; })
      .map(function (t) { return markPercent(t.mark); })
      .filter(function (p) { return p !== null; });
    if (!marks.length) return null;
    return marks.reduce(function (a, b) { return a + b; }, 0) / marks.length;
  }

  /* ---------- aggregation ---------- */

  /* Everything open that is overdue or due within `days`, soonest first. */
  function upcoming(state, now, days) {
    now = now || new Date();
    days = days == null ? 7 : days;
    var items = [];
    function consider(kind, item, when, title) {
      var d = toDate(when);
      if (!d) return;
      if (dayDiff(d, now) > days) return;
      items.push({ kind: kind, id: item.id, title: title, when: when, date: d, status: dueStatus(when, now) });
    }
    state.reminders.forEach(function (r) { if (!r.done) consider('reminder', r, r.due, r.title); });
    state.tasks.forEach(function (t) { if (t.status !== 'done') consider('task', t, t.due, t.title); });
    state.emails.forEach(function (e) { if (e.status !== 'done') consider('email', e, e.followUp, e.subject || '(no subject)'); });
    items.sort(function (a, b) { return a.date - b.date; });
    return items;
  }

  /* Reminders whose time has come and that have not fired yet. */
  function dueReminders(reminders, now) {
    now = now || new Date();
    return reminders.filter(function (r) {
      var d = toDate(r.due);
      return !r.done && d && d <= now && r.notifiedFor !== r.due;
    });
  }

  function matches(item, query, fields) {
    if (!query) return true;
    var q = query.toLowerCase();
    return fields.some(function (f) {
      var v = item[f];
      if (Array.isArray(v)) v = v.join(' ');
      return v != null && String(v).toLowerCase().indexOf(q) !== -1;
    });
  }

  /* ---------- email ---------- */

  function parseAddress(value) {
    var s = String(value || '').trim();
    var angle = /^(.*?)<\s*([^>\s]+@[^>\s]+)\s*>\s*$/.exec(s);
    if (angle) {
      var name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
      return { name: name || angle[2], email: angle[2].toLowerCase() };
    }
    var bare = /[^\s<>"',;]+@[^\s<>"',;]+/.exec(s);
    if (bare) {
      var rest = s.replace(bare[0], '').replace(/[()"<>]/g, '').trim();
      return { name: rest || bare[0], email: bare[0].toLowerCase() };
    }
    return { name: s, email: '' };
  }

  function emailDomain(address) {
    var at = String(address || '').lastIndexOf('@');
    return at === -1 ? '' : String(address).slice(at + 1).toLowerCase();
  }

  function bytesFromBinary(bin) {
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
  }

  function decodeBytes(bytes, charset) {
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
    catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  function base64ToBinary(s) {
    var clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
    try { return atob(clean); } catch (e) { return ''; }
  }

  function qpToBinary(s, headerMode) {
    if (headerMode) s = s.replace(/_/g, ' ');
    return s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    });
  }

  /* RFC 2047 encoded words, e.g. =?utf-8?B?SGk=?= ; whitespace between adjacent words is dropped. */
  function decodeWords(value) {
    return String(value || '')
      .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
      .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g, function (_, charset, enc, text) {
        var bin = enc.toUpperCase() === 'B' ? base64ToBinary(text) : qpToBinary(text, true);
        return decodeBytes(bytesFromBinary(bin), charset);
      });
  }

  function parseHeaders(text) {
    var headers = {};
    var lines = text.split(/\r?\n/);
    var current = null;
    lines.forEach(function (line) {
      if (/^[ \t]/.test(line) && current) {
        headers[current] += ' ' + line.trim();
        return;
      }
      var m = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/.exec(line);
      if (m) {
        current = m[1].toLowerCase();
        if (headers[current] === undefined) headers[current] = m[2];
        else current = null; // keep the first occurrence, ignore continuation of repeats
      }
    });
    return headers;
  }

  function splitHeadBody(text) {
    var m = /\r?\n\r?\n/.exec(text);
    if (!m) return { head: text, body: '' };
    return { head: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
  }

  function headerParam(value, name) {
    var re = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i');
    var m = re.exec(value || '');
    return m ? (m[1] != null ? m[1] : m[2]) : '';
  }

  function stripHtml(html) {
    return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  function decodePart(headers, body) {
    var cte = (headers['content-transfer-encoding'] || '').trim().toLowerCase();
    var charset = headerParam(headers['content-type'], 'charset') || 'utf-8';
    if (cte === 'base64') return decodeBytes(bytesFromBinary(base64ToBinary(body)), charset);
    if (cte === 'quoted-printable') return decodeBytes(bytesFromBinary(qpToBinary(body)), charset);
    return body;
  }

  /* Returns { plain, html } text found in a MIME entity (recursing into multiparts). */
  function extractText(headers, body, depth) {
    var type = (headers['content-type'] || 'text/plain').toLowerCase();
    if (type.indexOf('multipart/') === 0 && depth < 6) {
      var boundary = headerParam(headers['content-type'], 'boundary');
      var out = { plain: '', html: '' };
      if (!boundary) return out;
      var parts = body.split('--' + boundary);
      for (var i = 1; i < parts.length; i++) {
        var part = parts[i];
        if (/^--/.test(part)) break;
        var hb = splitHeadBody(part.replace(/^\r?\n/, ''));
        var ph = parseHeaders(hb.head);
        if (/attachment/i.test(ph['content-disposition'] || '')) continue;
        var got = extractText(ph, hb.body, depth + 1);
        if (!out.plain && got.plain) out.plain = got.plain;
        if (!out.html && got.html) out.html = got.html;
      }
      return out;
    }
    if (type.indexOf('text/html') === 0) return { plain: '', html: decodePart(headers, body) };
    if (type.indexOf('text/') === 0) return { plain: decodePart(headers, body), html: '' };
    return { plain: '', html: '' };
  }

  /* Dates as found in .eml files and in text copied out of Outlook
     ("Tuesday, 28 October 2026 9:14 AM", "Tue 28/10/2026 9:14 AM"). */
  function parseLooseDate(value) {
    var s = String(value || '').trim();
    if (!s) return null;
    var d = new Date(s);
    if (!isNaN(d)) return d.toISOString();
    var cleaned = s.replace(/^[A-Za-z]+,?\s+/, '').replace(/\s+at\s+/i, ' ');
    var au = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?/.exec(cleaned);
    if (au) {
      var h = au[4] ? +au[4] : 0;
      if (au[6]) h = (h % 12) + (/p/i.test(au[6]) ? 12 : 0);
      d = new Date(+au[3], +au[2] - 1, +au[1], h, au[5] ? +au[5] : 0);
      return isNaN(d) ? null : d.toISOString();
    }
    d = new Date(cleaned);
    return isNaN(d) ? null : d.toISOString();
  }

  function preview(text, max) {
    max = max || 280;
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
  }

  /* Parses a raw .eml file or an email copied as text (From:/Sent:/Subject: block). */
  function parseEmail(text) {
    var src = String(text || '').replace(/^\uFEFF/, '').replace(/^\s+/, '');
    var hb = splitHeadBody(src);
    var headers = parseHeaders(hb.head);
    var from = parseAddress(decodeWords(headers.from || ''));
    var bodyText = extractText(headers, hb.body, 0);
    var body = bodyText.plain || (bodyText.html ? stripHtml(bodyText.html) : '');
    return {
      from: from.email,
      fromName: from.name,
      subject: decodeWords(headers.subject || '').trim(),
      date: parseLooseDate(headers.date || headers.sent) || null,
      preview: preview(body),
      valid: Boolean(headers.from || headers.subject)
    };
  }

  function newEmail(fields) {
    return Object.assign({
      id: uid(),
      source: 'manual',
      graphId: null,
      from: '',
      fromName: '',
      subject: '',
      date: new Date().toISOString(),
      preview: '',
      status: 'new',
      followUp: '',
      subjectId: '',
      webLink: '',
      note: ''
    }, fields);
  }

  /* Merge Microsoft Graph messages into tracked emails; keeps the user's tracking fields. */
  function mergeGraphMessages(emails, messages) {
    var byGraphId = {};
    emails.forEach(function (e) { if (e.graphId) byGraphId[e.graphId] = e; });
    var added = 0;
    var result = emails.slice();
    messages.forEach(function (m) {
      var addr = (m.from && m.from.emailAddress) || {};
      var fields = {
        from: String(addr.address || '').toLowerCase(),
        fromName: addr.name || addr.address || '',
        subject: m.subject || '',
        date: m.receivedDateTime || new Date().toISOString(),
        preview: preview(m.bodyPreview || ''),
        webLink: m.webLink || ''
      };
      var existing = byGraphId[m.id];
      if (existing) {
        Object.assign(existing, fields);
      } else {
        var e = newEmail(Object.assign({ source: 'outlook', graphId: m.id }, fields));
        byGraphId[m.id] = e;
        result.push(e);
        added++;
      }
    });
    return { emails: result, added: added };
  }

  /* Duplicate check for imported/pasted mail (same sender, subject and minute). */
  function isDuplicateEmail(emails, candidate) {
    var minute = function (iso) { var d = toDate(iso); return d ? Math.floor(d / 60000) : null; };
    return emails.some(function (e) {
      return e.from === candidate.from && e.subject === candidate.subject &&
        minute(e.date) === minute(candidate.date);
    });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_EMAIL: DEFAULT_EMAIL,
    uid: uid,
    esc: esc,
    defaultState: defaultState,
    migrate: migrate,
    toDate: toDate,
    isDateOnly: isDateOnly,
    dueStatus: dueStatus,
    formatDue: formatDue,
    toLocalInput: toLocalInput,
    toDateInput: toDateInput,
    nextRepeat: nextRepeat,
    markPercent: markPercent,
    subjectAverage: subjectAverage,
    upcoming: upcoming,
    dueReminders: dueReminders,
    matches: matches,
    parseAddress: parseAddress,
    emailDomain: emailDomain,
    decodeWords: decodeWords,
    parseLooseDate: parseLooseDate,
    parseEmail: parseEmail,
    newEmail: newEmail,
    mergeGraphMessages: mergeGraphMessages,
    isDuplicateEmail: isDuplicateEmail
  };
});
