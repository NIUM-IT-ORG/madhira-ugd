// User guides (Commissioner; AEE and Field Inspector) for the Madhira UGD Tracker.
const path = require('path');

module.exports = function userGuides(root, creds) {
  const img = (n) => path.join(root, 'docs', 'images', `${n}.jpg`);
  const SITE = 'https://______________________  (your IT team will give you this address)';
  const meta = {
    kicker: 'MADHIRA UGD TRACKER',
    footer: 'Madhira Municipality · Underground Drainage Scheme',
  };
  const credTable = (who) => ({
    t: 'table',
    head: ['Item', 'Your details'],
    widths: [0.3, 0.7],
    rows: [
      ['Web address', SITE],
      ['Email (sign-in name)', who.email],
      ['One-time password', `\`${creds[who.email]}\``],
    ],
  });
  const ACC = {
    comm: { email: 'commissioner@madhira.local', name: 'Commissioner' },
    aee: { email: 'aee@madhira.local', name: 'AEE' },
    insp: { email: 'inspector@madhira.local', name: 'Field Inspector' },
  };
  const colours = {
    t: 'table',
    head: ['Line colour on the map', 'Meaning'],
    widths: [0.35, 0.65],
    rows: [
      ['Grey', 'Not started: no pipe laid, no road cut'],
      ['Blue', 'Work in progress: road cut, trench open or pipe being laid'],
      ['Orange', 'Back-filled, CC road restoration pending'],
      ['Yellow', 'CC road restored, curing not complete'],
      ['Light green', 'Curing done, waiting for the Commissioner\'s approval'],
      ['**Green**', '**CC road restored and approved by the Commissioner**'],
      ['Red outline', 'At least one open issue on the stretch'],
      ['Dashed dark line', 'Road not motorable'],
      ['Dashed amber line', 'Proposed by an AEE, waiting for approval'],
      ['Letters on a stretch', 'T taps broken · L water pipe leak · D drain clogged with gravel · W water stagnation · P potholes'],
    ],
  };

  const commissioner = {
    ...meta,
    title: "Commissioner's Guide",
    subtitle: 'Version 1.0 · October 2026 · for the Municipal Commissioner (administrator)',
    header: "Madhira UGD Tracker · Commissioner's Guide",
    blocks: [
      { t: 'p', text: 'The UGD Tracker shows every road of the Underground Drainage scheme on a satellite map of Madhira. Your AEE and Field Inspector record what they see on each road from their phones; you see it live, approve restorations and network changes, and download reports.' },
      { t: 'h1', text: '1. Your sign-in' },
      credTable(ACC.comm),
      { t: 'note', tone: 'warn', label: 'Keep this private.', text: 'The one-time password works only until you sign in for the first time; you must then choose your own password (at least 8 characters). After that the password above no longer works.' },
      { t: 'h2', text: 'Accounts for your field staff' },
      { t: 'p', text: 'Two more accounts are ready. Give each person their own sign-in in person or by phone; they are also printed in the AEE and Field Inspector Guide. Both can record and propose in all 22 wards.' },
      { t: 'table', head: ['Person', 'Email (sign-in name)', 'One-time password'], widths: [0.25, 0.4, 0.35], rows: [
        ['AEE', ACC.aee.email, `\`${creds[ACC.aee.email]}\``],
        ['Field Inspector', ACC.insp.email, `\`${creds[ACC.insp.email]}\``],
      ] },
      { t: 'p', text: 'You can change these email addresses to real ones later under **Users → Edit**. Nothing is ever emailed; the address is only the sign-in name.' },
      { t: 'h2', text: 'First sign-in' },
      { t: 'steps', items: [
        'Open the web address in Chrome, Edge or Safari (office PC or phone).',
        'Enter your email and the one-time password, and select **Sign in**.',
        'Enter the one-time password again as "Current password", then your new password twice, and select **Save password**.',
      ] },
      { t: 'image', path: img('set-password'), width: 2.4, caption: 'Choosing your own password at first sign-in' },

      { t: 'h1', text: '2. The screen at a glance', newPage: true },
      { t: 'image', path: img('map-overview'), caption: 'The map page (left: legend, filters and layers; bottom: field tools)' },
      { t: 'table', head: ['Part of the screen', 'What it does'], widths: [0.3, 0.7], rows: [
        ['Top bar', 'Map · Dashboard · Issues · Approvals (number waiting) · Activity · Users. The green dot means live updates are on.'],
        ['Colour by (above the map)', 'Overall, Sewer work, Road restoration, Motorability, Utilities damage or Public hazards'],
        ['Left panel', 'Search, legend, filters, zones (jump to a zone), layers'],
        ['Bottom buttons', '+ Road stretch, Report issue, + Manhole, + Pipe, Select several (your changes apply at once)'],
        ['Click anything', 'A stretch, manhole, pipe, issue or ward opens its details on the right'],
      ] },
      { t: 'h2', text: 'Reading the map' },
      colours,
      { t: 'image', path: img('map-status'), caption: 'Stretches coloured by stage, with issue badges (sample data)' },
      { t: 'bullets', items: [
        '**Search** finds a stretch code (W9-012), a manhole (MH-245), a ward ("Ward 9") or a road name.',
        '**Filters** show only stretches at a stage, with open issues, not motorable, or proposed, in one zone.',
        'The web address follows the map: copy it from the address bar to send someone the exact spot.',
      ] },

      { t: 'h1', text: '3. Every day: approvals and activity', newPage: true },
      { t: 'p', text: 'The **Approvals** tab shows how many items wait for you. Nothing an AEE adds or deletes changes the official map until you approve it.' },
      { t: 'image', path: img('approvals'), caption: 'The Approvals page (sample data)' },
      { t: 'h3', text: 'CC road restoration' },
      { t: 'steps', items: [
        'Select **Show on map** to see the stretch, then open **History** and look at the photos.',
        '**Approve** if the road is properly restored and cured: the stretch turns green.',
        'Or **Reject** with a reason: the AEE sees it in the history and records the corrected work.',
      ] },
      { t: 'h3', text: 'Additions and deletions proposed by AEEs' },
      { t: 'bullets', items: [
        'New road stretches, manholes (number, ground level, invert level) and pipes (diameter, slope) appear dashed amber on the map; deletion requests appear dashed red.',
        'Approve or reject each one; a rejection needs a reason. A new pipe can be approved only after the new manholes at its ends.',
        'Deleting a manhole also deletes the pipes connected to it.',
      ] },
      { t: 'image', path: img('proposal-on-map'), caption: 'A proposed manhole (amber ring) with its request details' },
      { t: 'h3', text: 'Activity' },
      { t: 'p', text: 'Every change, newest first, with who made it and where. Tick **Only flagged** to see updates made more than 200 m away from the road (possible reporting from the office).' },

      { t: 'h1', text: '4. Dashboard and reports', newPage: true },
      { t: 'image', path: img('dashboard'), caption: 'The dashboard (field figures are sample data)' },
      { t: 'bullets', items: [
        '**Reported** figures (sanctioned and executed) come from the progress sheet of 30 Sep 2026. **Field** figures are what your staff recorded on the map and update live.',
        '**Zones and wards** (bottom of the page): select a zone to see its wards; **Report** opens a one-page ward report you can print or save as PDF.',
        '**Download Excel**: the progress sheet in its usual layout with field-verified columns added, plus sheets of all stretches, issues, labour and change requests.',
        '**Open in Google Earth (KML)**: every stretch coloured by stage, and open issues as pins.',
      ] },
      { t: 'image', path: img('ward-report'), width: 5.2, caption: 'Ward report, ready to print' },

      { t: 'h1', text: '5. Managing people' },
      { t: 'table', head: ['Access', 'Can do'], widths: [0.3, 0.7], rows: [
        ['Admin (you)', 'Everything: approvals, users, corrections'],
        ['AEE / inspector (editor)', 'Record, propose and resolve issues in the wards you assign'],
        ['Viewer', 'See everything, change nothing (e.g. senior officials, IT monitoring)'],
      ] },
      { t: 'steps', items: [
        '**Users → + Add user**: name, designation, email, access and wards. The app shows a one-time password once: give it to the person directly.',
        '**Reset password** issues a new one-time password; **Disable** blocks the account at once (its history is kept).',
      ] },
      { t: 'h2', text: 'Correcting a record' },
      { t: 'bullets', items: [
        'Open the stretch → **History** → **Roll back to this version**. The rollback is itself recorded; nothing is lost.',
        '**Delete** removes a stretch from the map; its history is kept.',
      ] },
      { t: 'h2', text: 'Help' },
      { t: 'p', text: 'For sign-in problems, slowness or a site that does not open, contact your IT team. For a forgotten password of an AEE, use **Reset password** on the Users page.' },
    ],
  };

  const field = {
    ...meta,
    title: 'AEE and Field Inspector Guide',
    subtitle: 'Version 1.0 · October 2026 · for recording work on site with your phone',
    header: 'Madhira UGD Tracker · AEE and Field Inspector Guide',
    blocks: [
      { t: 'p', text: 'You record what you see on each road. Every save keeps your name, the time, your phone\'s GPS position and your photos, and the Commissioner sees it at once. Both of you can work in all 22 wards.' },
      { t: 'h1', text: '1. Your sign-in' },
      { t: 'h3', text: 'AEE' },
      credTable(ACC.aee),
      { t: 'h3', text: 'Field Inspector' },
      credTable(ACC.insp),
      { t: 'note', tone: 'warn', label: 'Keep yours private.', text: 'The one-time password works only for your first sign-in; you must then choose your own password (at least 8 characters). Do not share accounts: every entry carries the name of the person signed in.' },
      { t: 'h2', text: 'Set up your phone (5 minutes)' },
      { t: 'steps', items: [
        'Open the web address in **Chrome** (Android) or **Safari** (iPhone).',
        'Sign in with your email and one-time password, then choose your own password.',
        'Add it to the home screen: Chrome menu ⋮ → **Add to Home screen** (iPhone: Share → **Add to Home Screen**). It now opens like an app.',
        'When asked, **allow location**. Updates without GPS, or made more than 200 m from the road, are flagged to the Commissioner.',
      ] },
      { t: 'image', path: img('login'), width: 2.4, caption: 'Sign-in screen' },

      { t: 'h1', text: '2. Record a new road stretch', newPage: true },
      { t: 'steps', items: [
        'Zoom in on the road. Tap **+ Road stretch**.',
        '**Pick pipes** (usual): tap each pipe reach along the road; they turn yellow and the length and manholes are counted. Tap again to remove one. For a road without pipes on the map, switch to **Draw line** and tap along the road (taps near a manhole snap to it).',
        'Tap **Next: record status** and fill the six sections (below).',
        'Add **photos**, a short note if useful, and **Save**.',
      ] },
      { t: 'image', path: img('pick-pipes'), caption: 'Picking the pipe reaches along a road' },
      { t: 'table', head: ['Section', 'What you record (your item numbers)'], widths: [0.28, 0.72], rows: [
        ['A Sewer work', 'Pipeline not started (1) / partly laid, in metres / laid (2); manholes built (3); inspection chambers built (4). The combination is shown automatically (5).'],
        ['B Road cutting', 'Road cut (6) → trench open (7) → back-filled with gravel (8)'],
        ['C CC restoration', 'Pending (9) → restored, curing not done (11) → restored, curing done (10). Turns green when the Commissioner approves (12).'],
        ['D Motorability', 'Motorable / with difficulty / not motorable (13)'],
        ['E Utilities', 'Tap connections broken and restored (14), water pipe leaks (15), drain clogged with gravel (16)'],
        ['F Hazards', 'Water stagnation (17), potholes in the trench (18), uneven back-fill'],
      ] },
      { t: 'image', path: img('stretch-form-filled'), caption: 'The status form: tags at the top update as you fill it' },
      { t: 'note', tone: 'info', label: 'Photos.', text: 'A photo is required when you mark the CC road restored and when you report new damage (taps, leaks, clogged drain, stagnation, potholes, not motorable). Save stays grey until you add one.' },
      { t: 'p', text: 'A new stretch shows as **proposed** (dashed amber) until the Commissioner approves it. You can keep recording its status meanwhile.' },

      { t: 'h1', text: '3. Update a stretch', newPage: true },
      { t: 'steps', items: [
        'Tap the coloured line on the map (or search its code, e.g. W15-001).',
        'Tap **Update status**, change only what is different today, add a photo, **Save**.',
        'Tap **History** to see every earlier entry and who made it.',
      ] },
      { t: 'image', path: img('phone-stretch'), width: 2.6, caption: 'A stretch opened on the phone (sample data)' },
      { t: 'bullets', items: [
        'When you mark **CC restored, curing done**, the line turns light green and goes to the Commissioner. It turns **green** only after approval.',
        'If someone else changed the same item while you were editing, the app asks you to close the form and open the stretch again to see the latest values.',
        'Line drawn wrongly? **Redraw line**. Stretch should not exist? **Request deletion** with the reason.',
      ] },
      { t: 'h2', text: 'Several roads at once' },
      { t: 'p', text: '**Select several** → tap the stretches → **Next** → set only what changed (for example "Back-filled" on five lanes). Each stretch still gets its own history entry. Record restoration and damage one stretch at a time, because they need a photo each.' },

      { t: 'h1', text: '4. Issues' },
      { t: 'bullets', items: [
        'Damage you tick on a stretch opens an **issue** automatically. Clearing it on the stretch closes the issue.',
        'For a problem at a spot (e.g. gravel dumped in a drain), tap **Report issue**, tap the spot, choose the problem, add a photo.',
        'On the **Issues** page: **Assign** it to the contractor with a due date; when fixed, **Mark resolved** with a note and a photo of the fix.',
      ] },

      { t: 'h1', text: '5. Manholes and pipes missing or wrong on the map' },
      { t: 'table', head: ['To', 'Do this'], widths: [0.3, 0.7], rows: [
        ['Add a manhole', '**+ Manhole** → tap its exact position → enter its number (e.g. MH-2301), ground level and invert level'],
        ['Add a pipe', '**+ Pipe** → tap the first manhole, then the second → choose the diameter (and slope if known)'],
        ['Remove a wrong pipe or manhole', 'Tap it → **Request deletion** → give the reason'],
      ] },
      { t: 'p', text: 'These wait for the Commissioner\'s approval; follow them under **My requests**. You can withdraw your own request while it waits.' },

      { t: 'h1', text: '6. No signal, labour, and good practice' },
      { t: 'bullets', items: [
        '**No signal:** save as usual. The app keeps the update and its photos on your phone ("1 waiting to send" at the top) and sends them when the signal returns. Do not clear the browser\'s data meanwhile.',
        '**Labour:** tap your initial (top right) → **Log labour**: date, ward, number of labourers and machines. One entry per ward per day; saving again replaces it.',
        'Record **on site**: your GPS position is saved with every update.',
        'Keep a stretch to **one road between two junctions**, so its colour tells one story.',
        'Take photos in daylight showing the road surface and a landmark (house, pole, shop).',
      ] },
      { t: 'image', path: img('phone-menu'), width: 2.4, caption: 'Menu (tap your initial). Shown here for the Commissioner; yours has no Users page.' },
      { t: 'h2', text: 'Map colours' },
      colours,
    ],
  };
  return { commissioner, field };
};
