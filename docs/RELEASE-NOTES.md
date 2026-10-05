# Release notes

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
