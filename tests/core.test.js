'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

const now = new Date(2026, 9, 29, 10, 0); // Thu 29 Oct 2026, 10:00 local

test('migrate repairs garbage and keeps valid data', () => {
  assert.deepEqual(Core.migrate(null), Core.defaultState());
  assert.deepEqual(Core.migrate([1, 2]), Core.defaultState());
  const s = Core.migrate({
    settings: { email: 'x@eq.edu.au', theme: 5, unknown: 1 },
    notes: [{ title: 'a' }, null, 'str', [1], { id: 'keep', title: 'b' }],
    tasks: 'nope'
  });
  assert.equal(s.settings.email, 'x@eq.edu.au');
  assert.equal(s.settings.theme, 'system', 'wrong type falls back to default');
  assert.equal(s.settings.unknown, undefined);
  assert.equal(s.notes.length, 2);
  assert.ok(s.notes[0].id, 'missing id is assigned');
  assert.equal(s.notes[1].id, 'keep');
  assert.deepEqual(s.tasks, []);
});

test('default account is the EQ address', () => {
  assert.equal(Core.defaultState().settings.email, 'tgrim43@eq.edu.au');
});

test('dueStatus boundaries', () => {
  assert.equal(Core.dueStatus('', now), 'none');
  assert.equal(Core.dueStatus('2026-10-28', now), 'overdue');
  assert.equal(Core.dueStatus('2026-10-29', now), 'today', 'date-only today is not overdue later in the day');
  assert.equal(Core.dueStatus(new Date(2026, 9, 29, 9, 0).toISOString(), now), 'overdue', 'earlier today with a time is overdue');
  assert.equal(Core.dueStatus(new Date(2026, 9, 29, 18, 0).toISOString(), now), 'today');
  assert.equal(Core.dueStatus('2026-11-05', now), 'soon');
  assert.equal(Core.dueStatus('2026-11-06', now), 'later');
});

test('formatDue labels', () => {
  assert.equal(Core.formatDue('2026-10-29', now), 'Today');
  assert.equal(Core.formatDue('2026-10-30', now), 'Tomorrow');
  assert.equal(Core.formatDue(new Date(2026, 9, 29, 15, 30).toISOString(), now), 'Today 3:30pm');
  assert.equal(Core.formatDue('2026-10-26', now), '3 days ago');
  assert.equal(Core.formatDue('2026-11-13', now), 'Fri 13 Nov');
  assert.equal(Core.formatDue('2027-01-04', now), 'Mon 4 Jan 2027');
});

test('nextRepeat skips missed occurrences and rejects none', () => {
  const due = new Date(2026, 9, 20, 8, 0).toISOString();
  assert.equal(Core.nextRepeat(due, 'none', now), null);
  assert.equal(new Date(Core.nextRepeat(due, 'daily', now)).getTime(), new Date(2026, 9, 30, 8, 0).getTime());
  assert.equal(new Date(Core.nextRepeat(due, 'weekly', now)).getTime(), new Date(2026, 10, 3, 8, 0).getTime());
  assert.equal(new Date(Core.nextRepeat(due, 'monthly', now)).getTime(), new Date(2026, 10, 20, 8, 0).getTime());
});

test('markPercent and subjectAverage', () => {
  assert.equal(Core.markPercent('18/20'), 90);
  assert.equal(Core.markPercent('85%'), 85);
  assert.equal(Core.markPercent(' 72 '), 72);
  assert.equal(Core.markPercent('A'), null);
  assert.equal(Core.markPercent('5/0'), null);
  assert.equal(Core.markPercent('150'), null);
  const tasks = [
    { subjectId: 'm', mark: '18/20' }, { subjectId: 'm', mark: '70%' },
    { subjectId: 'm', mark: 'B' }, { subjectId: 'e', mark: '50' }
  ];
  assert.equal(Core.subjectAverage(tasks, 'm'), 80);
  assert.equal(Core.subjectAverage(tasks, 'x'), null);
});

test('upcoming merges open items within the window, soonest first', () => {
  const s = Core.defaultState();
  s.reminders = [
    { id: 'r1', title: 'late', due: new Date(2026, 9, 27, 9).toISOString(), done: false },
    { id: 'r2', title: 'finished', due: '2026-10-30', done: true },
    { id: 'r3', title: 'far', due: '2026-12-01', done: false }
  ];
  s.tasks = [{ id: 't1', title: 'essay', due: '2026-10-31', status: 'todo' }, { id: 't2', title: 'x', due: '2026-10-30', status: 'done' }];
  s.emails = [{ id: 'e1', subject: 'reply to Ms K', followUp: '2026-10-29', status: 'reply' }, { id: 'e2', subject: 'n', followUp: '', status: 'new' }];
  const list = Core.upcoming(s, now, 7);
  assert.deepEqual(list.map((i) => i.id), ['r1', 'e1', 't1']);
  assert.deepEqual(list.map((i) => i.status), ['overdue', 'today', 'soon']);
});

test('dueReminders fires once per due time', () => {
  const due = new Date(2026, 9, 29, 9, 0).toISOString();
  const r = { id: 'a', due, done: false };
  assert.equal(Core.dueReminders([r], now).length, 1);
  r.notifiedFor = due;
  assert.equal(Core.dueReminders([r], now).length, 0);
  r.due = new Date(2026, 9, 29, 9, 30).toISOString(); // rescheduled -> fires again
  assert.equal(Core.dueReminders([r], now).length, 1);
  assert.equal(Core.dueReminders([{ id: 'b', due: '2026-11-30', done: false }], now).length, 0);
});

test('matches searches strings and arrays case-insensitively', () => {
  const n = { title: 'Maths HW', body: 'page 4', tags: ['urgent'] };
  assert.ok(Core.matches(n, 'maths', ['title']));
  assert.ok(Core.matches(n, 'URG', ['tags']));
  assert.ok(!Core.matches(n, 'science', ['title', 'body', 'tags']));
  assert.ok(Core.matches(n, '', ['title']));
});

test('parseAddress variants', () => {
  assert.deepEqual(Core.parseAddress('"Smith, John" <JSmith@eq.edu.au>'), { name: 'Smith, John', email: 'jsmith@eq.edu.au' });
  assert.deepEqual(Core.parseAddress('Smith, John <jsmith@eq.edu.au>'), { name: 'Smith, John', email: 'jsmith@eq.edu.au' });
  assert.deepEqual(Core.parseAddress('jsmith@eq.edu.au'), { name: 'jsmith@eq.edu.au', email: 'jsmith@eq.edu.au' });
  assert.deepEqual(Core.parseAddress('jsmith@eq.edu.au (John)'), { name: 'John', email: 'jsmith@eq.edu.au' });
  assert.equal(Core.emailDomain('a@EQ.edu.au'), 'eq.edu.au');
});

test('decodeWords handles base64, Q-encoding and adjacent words', () => {
  assert.equal(Core.decodeWords('=?UTF-8?B?QXNzZXNzbWVudCDinIU=?='), 'Assessment ✅');
  assert.equal(Core.decodeWords('=?iso-8859-1?Q?Caf=E9_today?='), 'Café today');
  assert.equal(Core.decodeWords('=?utf-8?Q?Hello?= =?utf-8?Q?_World?='), 'Hello World');
  assert.equal(Core.decodeWords('plain'), 'plain');
});

test('parseEmail reads a multipart .eml with quoted-printable plain text', () => {
  const eml = [
    'Received: from x',
    'From: =?utf-8?Q?Ms_K=C3=A9lly?= <kelly@eq.edu.au>',
    'To: tgrim43@eq.edu.au',
    'Subject: Science assignment',
    '  due Friday',
    'Date: Tue, 28 Oct 2026 09:14:00 +1000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hi Tom,=0A please submit by Fri=',
    'day. Caf=C3=A9',
    '--b1',
    'Content-Type: text/html; charset="utf-8"',
    '',
    '<p>ignored html</p>',
    '--b1--',
    ''
  ].join('\r\n');
  const e = Core.parseEmail(eml);
  assert.equal(e.from, 'kelly@eq.edu.au');
  assert.equal(e.fromName, 'Ms Kélly');
  assert.equal(e.subject, 'Science assignment due Friday');
  assert.equal(e.date, '2026-10-27T23:14:00.000Z');
  assert.equal(e.preview, 'Hi Tom, please submit by Friday. Café');
  assert.ok(e.valid);
});

test('parseEmail falls back to html and base64 in nested multipart', () => {
  const html = Buffer.from('<html><style>p{}</style><p>Excursion&nbsp;note</p><br>Bring hat</html>').toString('base64');
  const eml = [
    'From: office@school.eq.edu.au',
    'Subject: Excursion',
    'Content-Type: multipart/mixed; boundary=outer',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary=inner',
    '',
    '--inner',
    'Content-Type: text/html',
    'Content-Transfer-Encoding: base64',
    '',
    html,
    '--inner--',
    '--outer',
    'Content-Type: text/plain',
    'Content-Disposition: attachment; filename=a.txt',
    '',
    'ATTACHMENT TEXT',
    '--outer--'
  ].join('\n');
  const e = Core.parseEmail(eml);
  assert.equal(e.preview, 'Excursion note Bring hat');
  assert.equal(e.date, null);
});

test('parseEmail reads text copied from Outlook', () => {
  const pasted = '\n From: Smith, John <jsmith@eq.edu.au>\nSent: Tuesday, 28 October 2026 9:14 AM\nTo: Grim, Tom\nSubject: Footy training\n\nTraining moved to Thursday.';
  const e = Core.parseEmail(pasted);
  assert.equal(e.from, 'jsmith@eq.edu.au');
  assert.equal(e.fromName, 'Smith, John');
  assert.equal(e.subject, 'Footy training');
  assert.equal(new Date(e.date).getTime(), new Date(2026, 9, 28, 9, 14).getTime());
  assert.equal(e.preview, 'Training moved to Thursday.');
  assert.equal(Core.parseEmail('just some words').valid, false);
});

test('parseLooseDate reads zone-less Outlook dates as local, day first', () => {
  const at = (s) => new Date(Core.parseLooseDate(s)).getTime();
  assert.equal(at('Tue 28/10/2026 2:05 PM'), new Date(2026, 9, 28, 14, 5).getTime());
  assert.equal(at('Tue 28/10/2026 12:05 AM'), new Date(2026, 9, 28, 0, 5).getTime());
  assert.equal(at('Mon 5/10/2026 9:14 AM'), new Date(2026, 9, 5, 9, 14).getTime(), 'day <= 12 must not be read month-first');
  assert.equal(at('Monday, 5 October 2026 9:14 am'), new Date(2026, 9, 5, 9, 14).getTime());
  assert.equal(at('Monday, October 5, 2026 at 9:14 p.m.'), new Date(2026, 9, 5, 21, 14).getTime());
  assert.equal(at('5 Oct 2026'), new Date(2026, 9, 5).getTime());
  assert.equal(Core.parseLooseDate('Mon, 05 Oct 2026 09:14:00 +1000'), '2026-10-04T23:14:00.000Z', 'zoned RFC 2822 keeps its zone');
  assert.equal(Core.parseLooseDate('not a date'), null);
  assert.equal(Core.parseLooseDate('31 Foo 2026'), null);
});

test('mergeGraphMessages adds new and preserves tracking on re-sync', () => {
  const msg = { id: 'g1', subject: 'Hi', receivedDateTime: '2026-10-28T00:00:00Z', bodyPreview: 'body', webLink: 'https://o/1', from: { emailAddress: { name: 'Ms K', address: 'K@eq.edu.au' } } };
  const first = Core.mergeGraphMessages([], [msg]);
  assert.equal(first.added, 1);
  assert.equal(first.emails[0].from, 'k@eq.edu.au');
  assert.equal(first.emails[0].status, 'new');
  first.emails[0].status = 'reply';
  first.emails[0].note = 'ask about draft';
  const second = Core.mergeGraphMessages(first.emails, [Object.assign({}, msg, { subject: 'Hi (edited)' }), { id: 'g2', subject: 'x', from: {} }]);
  assert.equal(second.added, 1);
  assert.equal(second.emails.length, 2);
  assert.equal(second.emails[0].status, 'reply');
  assert.equal(second.emails[0].note, 'ask about draft');
  assert.equal(second.emails[0].subject, 'Hi (edited)');
  assert.equal(second.emails[1].from, '');
});

test('isDuplicateEmail compares sender, subject and minute', () => {
  const list = [{ from: 'a@x', subject: 's', date: '2026-10-28T00:00:10Z' }];
  assert.ok(Core.isDuplicateEmail(list, { from: 'a@x', subject: 's', date: '2026-10-28T00:00:50Z' }));
  assert.ok(!Core.isDuplicateEmail(list, { from: 'a@x', subject: 's', date: '2026-10-28T00:01:00Z' }));
  assert.ok(!Core.isDuplicateEmail(list, { from: 'b@x', subject: 's', date: '2026-10-28T00:00:10Z' }));
});

test('esc neutralises html', () => {
  assert.equal(Core.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(Core.esc(null), '');
});
