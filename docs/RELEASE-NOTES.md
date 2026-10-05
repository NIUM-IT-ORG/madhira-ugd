# Release notes

## v1.2 (6 October 2026)

**For the Commissioner**
- **Delete issues for good**: Delete on an issue, or tick several in the Issues table → Delete selected…, with a
  reason. They disappear from the map, lists, dashboard and Excel, with their photos; damage raised from a road is
  cleared on the road too (noted in its history). The reason is kept in the admin log.
- **Issues table sorts** by any column (tap the heading; tap again to reverse); the Excel download follows the
  same order.
- **Users**: a **Supervisor (AEE)** box: supervisors may correct other field staff's labour entries. Fixed: Reset
  password, Disable and Enable no longer remove the person's ward access.

**For field staff**
- **Labour by zone** instead of ward, on a new **Labour** page: table with totals, zone and date filters, sorting,
  Excel, and the history of every correction.
- **Corrections for 48 hours after saving**: your own entries; the AEE can correct the Field Inspector's and the
  contracting assistants' too. Afterwards entries are frozen for field staff; the Commissioner can always correct.
- **Report issue** has two new problems: **Drain damaged** and **Culvert broken / damaged**.
- **Three contracting assistant accounts** (assistant1–3@madhira.local) with the same rights as the Field Inspector.

**Your data**
- Upgrading keeps every record. Labour recorded by ward in v1.0/v1.1 is added up per zone and day (notes joined,
  original wards noted); the original records are kept unchanged. Checked with the new upgrade check
  (`server/test/upgrade-check.mjs`): a v1.1 database full of data upgraded with every road, its history, issue,
  request, photo, network change and labour total intact.
- New: a one-time **fresh start** tool (`server/scripts/reset-records.mjs`) that deletes recorded data only and keeps
  the accounts and the Madhira plan. It is never run by an upgrade (see `docs/OPERATIONS.md`).

**For IT**
- Migration `005_v1_2.sql` (new tables `labour_entries`, `labour_entry_events`, `starting_accounts`; column
  `users.supervisor`), applied automatically at start-up. The three new accounts are created at the first start of
  v1.2; existing accounts are never re-created (even if their email was changed).
- New API: `/api/labour/:id` (PATCH, DELETE, history), `/api/export/labour.xlsx`, `DELETE /api/issues/:id`,
  `POST /api/issues/delete`. `POST /api/labour` takes `zone` instead of `ward`.
- The Docker image now includes `server/scripts/`.

## v1.1 (3 October 2026)

Changes from the field testing of v1.0.

**For the AEE and Field Inspector**
- **Every pipe can be recorded.** About 15% of the pipes (582 of 3,991, mostly in Madupalli and on the town's
  edges) lie outside the ward boundaries drawn in the KML, and v1.0 refused stretches on them. They now go to
  the nearest ward and are marked "outside ward boundary" (also for new manholes and issues there).
- **Water pipe leakages can be marked fixed**, like tap connections: "Leakages fixed" with the number still
  pending. The leak issue and the map's "L" badge clear when every leak is fixed.
- **Report issue:** the remark is now required and the photo optional.
- **Photos are required only when the CC road is marked restored** (the Commissioner approves on them); for
  damage and other updates they are optional.

**For the Commissioner**
- **Issues page:** filter by ward (the list follows the chosen zone) and by status; **Download Excel** saves
  the filtered list.
- **Storage page (new):** space used by photos and the database, free disk on the server, and deletion of old
  data by date (photos, stretch history, resolved issues, decided requests, deleted/rejected stretches, labour,
  sign-in log, clean-up log) with an exact preview, a zip archive beforehand, typed confirmation and a log.
- Excel: new columns **Leaks fixed** and **Outside ward boundary** in the Stretches sheet.

**Fixes found in testing (included in v1.1)**
- A restoration the Commissioner rejected goes back for approval when the AEE records it again with a new photo
  (before, it dropped out of the Approvals list for good). A redrawn line on an approved road needs approving again.
- A pipe can belong to only one road stretch (lengths were counted twice); the map tool and the server refuse a
  pipe already used by another stretch.
- Pipe requests: no second pipe between the same two manholes; a pipe proposal is drawn between the manholes as
  they are when approved (never onto a moved or re-added manhole) and closes when its new manhole is rejected or
  withdrawn. Two requests at the same moment can no longer both pass the duplicate checks.
- Rejected or withdrawn proposed roads close their issues and leave the dashboard figures and weekly chart.
- An issue re-opened by hand brings the damage back on the road, so the next save does not close it again.
- Edits based on an older copy of a road (e.g. waiting offline) are refused with "someone else changed this"
  when the Commissioner approved/rejected the restoration meanwhile, when reported/fixed counts would disagree,
  or when the history needed to check was deleted on the Storage page.
- Storage page: deleting history keeps each road's status on the chosen date (the weekly chart stays right);
  deleting removed roads keeps their still-open issues; the archive also has every record in full
  (records.json); photos by month use India time.
- Users page: saving a user no longer signs that user out (only a change of role, disabling or a password reset
  does); the Commissioner stays signed in when editing their own entry; a duplicate email gives a clear message.
- Phones and offline work:
  - the app opens on site without signal (last data seen; satellite images may be missing) instead of the
    sign-in page; signing out without signal completes as soon as the phone is online again;
  - saves waiting on the phone are sent only for the person who made them, in the order they were made, and never
    twice (a save whose reply was lost returns the first result: no duplicate issues, stretches or photos);
  - a server restart or an expired session no longer marks waiting saves as refused;
  - saves the server refused can be seen, retried or discarded (tap the badge); issue reports saved offline by
    v1.0 without a remark are still sent;
  - the app's offline copy now refreshes properly after an upgrade (it never updated before), and missing old
    app files get a real "not found" instead of the app page;
  - live updates reload after the phone reconnects or wakes, and the live connection is closed when a page is
    left (repeated reloads over plain http could stall).
- Storage page: the Delete confirmation always matches the preview it shows.
- Excel and Google Earth times are India time; "overdue" counts from the day after the due date.
- Live updates stop for a disabled user; labour cannot be logged for tomorrow; impossible dates and malformed
  requests get a clear message instead of a server error.

**For IT**
- Database changes applied automatically at start-up: migrations `003_storage.sql` (table `storage_purges`) and
  `004_request_keys.sql` (table `request_keys`).
  No manual steps; rolling back to v1.0 is safe.
- New server dependency: `yazl` (MIT) for the archive zip.
- New API endpoints: `/api/export/issues.xlsx`, `/api/admin/storage*` (see `docs/API.md`).
- Upgrade: `docs/DEPLOY-AWS.docx` part B14 (bring the new files into your repository, tag `v1.1`, then
  `git checkout v1.1 && docker compose up -d --build` on the server).

## v1.0 (2 October 2026)

First release.
