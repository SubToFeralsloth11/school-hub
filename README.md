# School Hub

Notes, reminders, a school tracker and an email tracker in one web app. It works on phones, tablets and laptops (touch, mouse and keyboard). There's no build step, no server and no account.

## Opening it

- **From your computer:** double-click `index.html`. Outlook sync is unavailable this way because Microsoft sign-in needs a web address. Everything else works.
- **On the web (GitHub Pages):** `https://subtoferalsloth11.github.io/school-hub/`. Every feature works, including Outlook sync. On a phone, use *Add to Home Screen* to open it like an app.

Data is saved in the browser (`localStorage`) on each device separately. The file version and the web version also keep separate data. To move your data, use **Settings → Export backup**, then **Import backup** on the other device.

## Features

| Page | What it does |
| --- | --- |
| Today | Overdue, due-today and next-7-days counts. Shows everything coming up (reminders, school tasks, email follow-ups), pinned notes and emails that need dealing with. |
| Notes | Notes with titles, colours, tags, pinning and search. |
| Reminders | Date/time reminders that can repeat daily, weekly or monthly. They pop up in the app when due, and as system notifications if you turn alerts on. Marking a repeating reminder done moves it to the next occurrence. |
| School | Subjects (teacher, room, colour) and tasks: assignments, exams, homework and projects, each with a due date, status and mark. Shows each subject's average from marks like `18/20` or `85%`. |
| Email | Tracks emails for `tgrim43@eq.edu.au`. Each email gets a status (New, Needs reply, Waiting, Done), a follow-up date, a linked subject and notes. You can filter to mail sent from `@eq.edu.au` addresses. |
| Settings | Your name and email, theme (system, light or dark), alerts, Outlook connection, and backup/restore. |

Keyboard: `N` new item, `/` search, `1`–`6` switch page, `Esc` close.

## Getting emails in

1. **Outlook sync (web version only).** Signs in to Microsoft 365 and pulls in your 50 newest inbox messages. It syncs again when you open the app and every 10 minutes while it's open. One-time setup:
   1. Go to [Microsoft Entra → App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and choose **New registration**.
   2. For account types, choose *Accounts in any organizational directory*.
   3. Add a redirect URI with platform **Single-page application**. Use the exact GitHub Pages URL, for example `https://subtoferalsloth11.github.io/school-hub/`. The Settings page shows the exact value.
   4. Paste the **Application (client) ID** into **Settings → Outlook email**, then press **Sign in**.

   The app asks only for `Mail.Read` and `User.Read`, and it never sends or deletes mail. Department of Education (EQ) accounts may need an IT administrator to approve new apps. If sign-in says *Need admin approval*, use options 2 or 3 instead.
2. **Import .eml files.** In Outlook on the web, open a message and choose ⋯ → **Download**. Then press **Import .eml**, or drag the files onto the Email page.
3. **Paste an email.** Copy from the email's `From:` line down and press **Paste email**.

Emails that are already tracked are skipped on import. Re-syncing keeps your status, follow-up date and notes.

## Development

```
npm test        # node --test, pure logic in js/core.js
```

- `js/core.js`: data model, dates, MIME/.eml parsing and merge logic. It has no DOM code and is tested in `tests/`.
- `js/graph.js`: Microsoft sign-in (OAuth 2.0 with PKCE, no library) and Microsoft Graph inbox fetch.
- `js/app.js`: the UI.

The scripts are plain classic scripts, not ES modules, so `index.html` still runs from `file://`.
