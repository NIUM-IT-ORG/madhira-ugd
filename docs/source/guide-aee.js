// AEE step-by-step guide: every task as numbered taps with phone screenshots (docs/images/aee).
const path = require('path');

module.exports = function aeeGuide(root, creds) {
  const s = (n, caption) => ({ path: path.join(root, 'docs', 'images', 'aee', `${n}.jpg`), caption });
  const img = (n) => path.join(root, 'docs', 'images', `${n}.jpg`);
  const EMAIL = 'aee@madhira.local';

  return {
    kicker: 'MADHIRA UGD TRACKER',
    title: 'AEE Step-by-Step Guide',
    subtitle: 'Version 1.1 · October 2026 · for the Assistant Executive Engineer, on site with a phone',
    header: 'Madhira UGD Tracker · AEE Step-by-Step Guide',
    footer: 'Madhira Municipality · Underground Drainage Scheme',
    blocks: [
      { t: 'p', text: 'This guide takes you through every job you do in the UGD Tracker, one tap at a time, with pictures of what your phone shows. **Words in bold are the exact names of the buttons on screen.** You can work in all 22 wards.' },
      { t: 'table', head: ['I want to…', 'Go to'], widths: [0.62, 0.38], rows: [
        ['Sign in for the first time and set up my phone', 'Steps 1 and 2'],
        ['Understand the map and find a road', 'Step 3'],
        ['Record a road the contractor has started', 'Task A'],
        ['Update a road after today\'s work (the daily job)', 'Task B'],
        ['Report damage: broken taps, leaks, gravel in drains, potholes…', 'Task C'],
        ['Follow up and close an issue', 'Task D'],
        ['Add a manhole or pipe missing from the map', 'Tasks E and F'],
        ['Remove a wrong road, pipe or manhole', 'Task G'],
        ['See if the Commissioner approved my requests', 'Task H'],
        ['Update many roads at once', 'Task I'],
        ['Record labour and machines for the day', 'Task J'],
        ['Work where there is no signal', 'Task K'],
        ['A daily routine, problems and a one-page card', 'Sections 4–6'],
      ] },

      { t: 'h1', text: 'Step 1. Your sign-in', newPage: true },
      { t: 'table', head: ['Item', 'Your details'], widths: [0.3, 0.7], rows: [
        ['Web address', 'https://______________________  (your IT team will give you this address)'],
        ['Email (sign-in name)', EMAIL],
        ['One-time password', `\`${creds[EMAIL]}\``],
      ] },
      { t: 'note', tone: 'warn', label: 'Keep it private.', text: 'The one-time password works only once. At the first sign-in you choose your own password, and the one above stops working. Do not share your account: every entry carries the name of the person signed in.' },
      { t: 'steps', items: [
        'On your phone open **Chrome** (Android) or **Safari** (iPhone) and type the web address.',
        'Type the email and the one-time password exactly as printed (capital letters matter). Tap **Sign in**.',
        'The app asks you to **Set your own password**. Type the one-time password again in **Current password**, then your new password (at least 8 characters) twice. Tap **Save password**.',
      ] },
      { t: 'shots', items: [s('login', 'Step 1.2: sign in'), { path: img('set-password'), caption: 'Step 1.3: choose your own password' }], width: 2.3 },

      { t: 'h1', text: 'Step 2. Set up your phone (once)' },
      { t: 'steps', items: [
        '**Put it on the home screen.** Android Chrome: menu ⋮ → **Add to Home screen**. iPhone Safari: Share □↑ → **Add to Home Screen**. From now on open it from the icon like any app.',
        '**Allow location.** When the phone asks "Allow location?", choose **Allow** (or "While using the app"). Every update saves where you stood. Updates without GPS, or made more than 200 m from the road, are flagged to the Commissioner.',
        '**Check it.** Open any form: the badge at the bottom left should read **GPS ±10 m** or similar. If it says **No GPS**, see Section 5 (Problems).',
      ] },

      { t: 'h1', text: 'Step 3. Know the map' },
      { t: 'shots', items: [s('home', 'The map as you see it'), s('menu', 'The menu: tap your initial (top right)')] },
      { t: 'table', head: ['On the screen', 'What it is for'], widths: [0.32, 0.68], rows: [
        ['Green dot (top right)', 'Live: what you save reaches the Commissioner at once. Grey means you are offline.'],
        ['Your initial "A"', 'The menu: Map, Dashboard, Issues, My requests, Activity, Log labour, Change password, Sign out'],
        ['**Layers & search**', 'Find a stretch (W15-002), a manhole (MH-2147), a ward ("Ward 15") or a road name; legend, filters and layers'],
        ['**Overall · Sewer work · Road restoration · Motorability…**', 'Colours the roads by that topic'],
        ['+ and − / arrow / target', 'Zoom in and out / turn the map north / show where you are standing'],
        ['Thin lilac lines and white dots', 'Sewer pipes and manholes from the drawings. Purple thick line: trunk main.'],
        ['Thick coloured lines with a code', 'Road stretches already recorded (colours below)'],
        ['**+ Road stretch · Report issue · + Manhole · + Pipe · Select several**', 'Your tools (Tasks A, C, E, F, I)'],
      ] },
      { t: 'h3', text: 'Colours of the road stretches' },
      { t: 'table', head: ['Colour', 'Meaning'], widths: [0.3, 0.7], rows: [
        ['Grey', 'Not started'],
        ['Blue', 'Work in progress: road cut, trench open or pipe being laid'],
        ['Orange', 'Back-filled, CC road restoration pending'],
        ['Yellow', 'CC restored, curing not done'],
        ['Light green', 'Curing done, waiting for the Commissioner\'s approval'],
        ['**Green**', '**Restored and approved by the Commissioner**'],
        ['Red outline', 'At least one open issue'],
        ['Dashed amber', 'Proposed by you, waiting for approval'],
        ['Letter badges', 'T taps broken · L water pipe leak · D drain clogged · W water stagnation · P potholes'],
      ] },

      { t: 'h1', text: 'Task A. Record a new road stretch', newPage: true },
      { t: 'p', text: 'Do this the first time work starts on a road. One stretch = **one road between two junctions**, so its colour tells one story.' },
      { t: 'steps', items: [
        'Zoom in until you see the road and its pipe lines. Tap **+ Road stretch**.',
        'With **Pick pipes** selected, tap each pipe piece along the road. Each turns yellow and the bar shows the length, pieces, manholes and ward (here "90 m · 3 reaches · 4 manholes · ward 15"). Tapped a wrong piece? Tap it again to remove it.',
        'No pipe on the map for this road? Tap **Draw line** and tap along the road instead; taps near a manhole snap to it.',
        'Tap **Next: record status**.',
      ] },
      { t: 'shots', items: [s('home', 'A.1: tap + Road stretch'), s('pick-pipes', 'A.2: tap the pipes along the road'), s('outside-pick', 'A road outside the ward outline: nearest ward')] },
      { t: 'note', tone: 'info', label: 'Pipes outside the ward outlines.', text: 'About one pipe in seven lies outside the ward boundaries drawn on the map (mostly in Madupalli and on the edges of town). You can pick them like any other pipe: the stretch goes to the **nearest ward** and the bar says "(outside ward boundary)". A pipe can belong to only one stretch: if it is already in another, the app says which one.' },
      { t: 'steps', continue: true, items: [
        { text: 'Type a **Road name** if the road has one (e.g. "Market lane"). It helps others find it.' },
        { text: '**Section A, Sewer work** (items 1–5): tap how far the pipeline is (not started / partly laid / laid). Use **+** and **−** for manholes and inspection chambers built. The app shows how many manholes the drawing has, and the combination line updates by itself.' },
        { text: '**Section B, Road cutting** (items 6–8): tap the stage today: road cut → trench open → back-filled with gravel.' },
        { text: '**Section C, CC restoration** (items 9–12): leave **Not due yet** until the trench is back-filled.' },
        { text: '**Section D, Motorability** (item 13): can a vehicle pass?' },
      ] },
      { t: 'shots', items: [s('form-a', 'Sections A and B'), s('form-bcd', 'Sections B, C and D')] },
      { t: 'steps', continue: true, items: [
        { text: '**Section E, Utilities damage** (items 14–16): count tap connections broken and restored, water pipe leakages and **Leakages fixed**, and switch on **Drain clogged with gravel** if so. Under each pair the app shows how many are still pending.' },
        { text: '**Section F, Public hazards** (items 17–18): water stagnation, potholes in the trench, uneven back-fill.' },
        { text: 'Tap **+ Photo** and take a photo (or pick one from the gallery). Photos of damage are optional but useful. A photo is **required** only when you mark the CC road restored: then the box turns **red** and **Save** stays grey until you add one.' },
        { text: 'Add a short **Note** if useful, then tap **Save**. The stretch appears on the map with its code (e.g. W15-002) as **proposed** until the Commissioner approves it. You can keep updating it meanwhile.' },
      ] },
      { t: 'shots', items: [s('form-ef', 'Section E: 2 leaks, 1 fixed, 1 pending'), s('photo-optional', 'Photo optional: Save is green'), s('photo-needed', 'CC restored: a photo is required')] },
      { t: 'note', tone: 'info', label: 'When is a photo required?', text: 'Only when you mark the CC road restored (the Commissioner approves the restoration on it). For damage and other updates a photo is optional, but it helps: photos are shrunk on the phone and keep their GPS position and time. Take them in daylight, showing the road and a landmark (house, pole, shop).' },

      { t: 'h1', text: 'Task B. Update a stretch after the day\'s work' },
      { t: 'p', text: '**This is your daily job.** Example: yesterday the road was cut; today the trench is back-filled, two more manholes are built and the broken tap is reconnected.' },
      { t: 'steps', items: [
        'Tap the coloured line of the road (or find it with **Layers & search**). Its card opens at the bottom: stage, tags, sections A–F and open issues.',
        'Scroll down the card and tap **Update status**.',
        'Change **only what is different today**. Everything else stays as it was. Here: Manholes built **+** **+**, Stage **Back-filled with gravel**, Restoration **CC road restoration pending**, Tap connections restored **+**.',
        'Add a photo if useful (required only for CC restoration), then tap **Save**. The colour changes at once (blue → orange here).',
      ] },
      { t: 'shots', width: 1.55, items: [s('stretch-detail', 'B.1: the stretch card'), s('stretch-buttons', 'B.2: Update status'), s('update-a', 'B.3: manholes 2 → 4'), s('update-bc', 'B.3: back-filled, restoration pending')] },
      { t: 'shots', items: [s('update-taps', 'B.3: 1 tap restored'), s('updated', 'B.4: saved, now orange'), s('history', 'History: who changed what, when')] },
      { t: 'bullets', items: [
        'Tap **History** on the card to see every entry, newest first, with the old value crossed out, the photos and the GPS.',
        'When a tap is marked restored, or a leak is marked fixed (**Leakages fixed** **+**), the matching open issue closes by itself once nothing is pending.',
        '**CC road restored**: mark **CC restored, curing not done** on the day of the concrete, and **CC restored, curing done** after curing, with a photo. The line turns light green and goes to the Commissioner; it turns **green** only after approval. If the Commissioner rejects it, the card says so and the reason is in **History**: when the work is corrected, tap **Update status**, add a **new photo** and **Save**: it goes back to the Commissioner.',
        'Message "Someone else changed this stretch"? Close the form, open the stretch again to see the latest values, and repeat your change.',
        'Line drawn wrongly? On the card tap **Redraw line**.',
      ] },

      { t: 'h1', text: 'Task C. Report damage or a problem (issue)' },
      { t: 'p', text: 'There are two ways, and both create an **issue** that the Commissioner sees with your remark (and photo, if you add one).' },
      { t: 'bullets', items: [
        '**On a stretch:** record the damage in sections E–F while recording or updating the stretch (Tasks A and B). The issue opens by itself, and closes by itself when you record it fixed.',
        '**At a spot:** use the steps below, e.g. gravel dumped in a side drain, a leak at a junction.',
      ] },
      { t: 'steps', items: [
        'Tap **Report issue** at the bottom of the map, or **Report issue** on a stretch card.',
        'Tap the exact spot of the problem on the map.',
        'Choose **What is the problem?**, set **How many** and the **Severity** (Low / Medium / High).',
        'Write the **Remark** (required): what and where, e.g. "Water pipe leaking at the junction, near the hand pump". **Report** stays grey until you do.',
        'Add a photo if you can (**+ Photo**, optional), then tap **Report**. A red "!" appears at the spot.',
      ] },
      { t: 'shots', items: [s('issue-tap', 'C.2: tap where the problem is'), s('issue-form', 'C.3–5: details, remark, Report')] },

      { t: 'h1', text: 'Task D. Follow up and close an issue' },
      { t: 'steps', items: [
        'Menu (your initial) → **Issues**. The top shows open, high-severity and **overdue** counts. Use the filters to see one kind, zone, **ward**, severity or status (choose the zone first and the ward list shows only its wards). **Download Excel** saves the list you are looking at.',
        'Tap an issue card: the map flies to it and its details open.',
        'To hand it to the contractor: **Assign** → who (e.g. "Contractor site engineer") and a **Due date** → **Assign**. Past the due date it shows **Overdue**.',
        'When it is fixed: **Mark resolved** → write **How was it fixed?** (required) → add a **photo of the fix** (recommended) → **Resolve**.',
        'Came back? Open it and tap **Re-open** with a note.',
      ] },
      { t: 'shots', items: [s('issues-board', 'D.1: Issues in Zone 2, Ward 5'), s('issue-open', 'D.2: issue details')] },
      { t: 'shots', items: [s('issue-resolve', 'D.4: how it was fixed'), s('issue-resolved', 'D.4: resolved, with history')] },

      { t: 'h1', text: 'Task E. Add a manhole missing from the map' },
      { t: 'steps', items: [
        'Zoom in close. Tap **+ Manhole**, then tap the manhole\'s exact position.',
        'Type the **Manhole number** as the engineers use it (e.g. MH-2301). It must be new in its zone.',
        'Type the **Ground level (GL)** and **Invert level (IL)** in metres. The app shows the depth.',
        'Write **Why is it needed?** (e.g. "Extra manhole at the lane junction, as built"), then **Send for approval**. It shows as an amber ring until the Commissioner approves it.',
      ] },
      { t: 'shots', items: [s('manhole-tap', 'E.1: tap its position'), s('manhole-form', 'E.2–4: number, levels, reason')] },

      { t: 'h1', text: 'Task F. Add a pipe missing from the map' },
      { t: 'steps', items: [
        'Tap **+ Pipe**, then tap the first manhole and then the second. A new manhole you proposed (amber ring) can be used too.',
        'Choose the **Diameter**. Add the **Slope** (e.g. 1/150) and the length on the drawing if you know them. Flow direction is set from the manholes\' invert levels.',
        'Write why it is needed and tap **Send for approval**. A pipe to a new manhole is approved after that manhole.',
      ] },
      { t: 'shots', items: [s('pipe-tap', 'F.1: tap the first manhole'), s('pipe-form', 'F.2–3: diameter, slope, send')] },

      { t: 'h1', text: 'Task G. Remove a wrong stretch, pipe or manhole' },
      { t: 'steps', items: [
        'Tap the wrong item on the map (the line of a stretch, a pipe, or a manhole dot).',
        'Tap **Request deletion** and write the reason (e.g. "Duplicate of the line on the parallel lane"). Tap to confirm.',
        'It shows dashed red until the Commissioner decides. Deleting a manhole also removes its pipes. History is never lost.',
      ] },
      { t: 'shots', items: [s('manhole-detail', 'A manhole card: levels, depth, pipes and Request deletion')] },

      { t: 'h1', text: 'Task H. Check your requests' },
      { t: 'steps', items: [
        'Menu → **My requests**. **Waiting for the Commissioner** lists everything you proposed (new stretches, manholes, pipes, deletions).',
        '**Show on map** flies to it. **Withdraw** cancels your own request while it waits.',
        'Below, **Decided** shows each request as approved or rejected, with the Commissioner\'s reason.',
      ] },
      { t: 'shots', items: [s('requests', 'My requests')] },

      { t: 'h1', text: 'Task I. Update many roads at once' },
      { t: 'p', text: 'Useful when the same thing happened on several roads, e.g. five lanes back-filled today.' },
      { t: 'steps', items: [
        'Tap **Select several**, then tap each stretch (they turn yellow; the count shows "2 selected"). Tap again to unselect.',
        'Tap **Next: choose changes**. Everything starts at **Leave unchanged**: set only what changed.',
        'Tap **Apply to 2** (the number of stretches). Each stretch gets its own history entry.',
      ] },
      { t: 'note', tone: 'info', label: 'Note.', text: 'Record CC restoration one stretch at a time (Task B), because each needs its own photo.' },
      { t: 'shots', items: [s('select', 'I.1: tap the stretches'), s('bulk', 'I.2: set only what changed')] },

      { t: 'h1', text: 'Task J. Log labour and machines' },
      { t: 'steps', items: [
        'Menu → **Log labour**.',
        'Check the **Date**, choose the **Ward**, set the number of **Labourers on site** and **Machines** (JCB, roller…), add a note (e.g. "contractor team B"). Tap **Save**.',
        'One entry per ward per day. Saving again for the same ward and day replaces the earlier figure.',
      ] },
      { t: 'shots', items: [s('labour', 'Log labour')] },

      { t: 'h1', text: 'Task K. No signal on site' },
      { t: 'bullets', items: [
        'The app opens without signal too, with the roads and pipes as you last saw them (the satellite picture may be missing).',
        'Save as usual. The app keeps the update and its photos on your phone and shows **1 waiting to send** at the top. Tap it to see what is waiting, or **Send now**.',
        'When the signal returns it sends them by itself (open the app if it was closed). The count disappears when everything has reached the server. Nothing is sent twice, even if the signal drops halfway.',
        'Updates belong to you: if you sign out, they wait on the phone and are sent the next time **you** sign in. **Do not clear the browser\'s data or history**, or they are lost.',
        '**not accepted** at the top means the server refused an update (for example someone changed that stretch meanwhile). Tap it to read why, then **Try again** or **Discard** and record it again on the stretch.',
      ] },

      { t: 'h1', text: '4. Your daily routine' },
      { t: 'table', head: ['When', 'Do this'], widths: [0.2, 0.8], rows: [
        ['Morning (5 min)', 'Menu → **Issues**: anything **overdue** or high severity? Call the contractor. Menu → **My requests**: anything rejected? Read the reason.'],
        ['On each road worked today', 'Stand on the road, tap its stretch → **Update status** → change what is different → **Save** (Task B; photo for CC restored). New road started? **+ Road stretch** (Task A).'],
        ['When you see damage', 'Record it on the stretch, or **Report issue** at the spot with a remark, and a photo if you can (Task C).'],
        ['When damage is fixed', 'Record it fixed on the stretch (taps restored, leakages fixed…), or **Mark resolved** on the issue (Tasks B and D).'],
        ['Concrete laid / curing done', 'Mark CC restored, curing not done / curing done, with a photo, so the Commissioner can approve.'],
        ['Evening (2 min)', 'Menu → **Log labour** for each ward worked (Task J). Check that the top bar shows nothing "waiting to send".'],
      ] },

      { t: 'h1', text: '5. Problems and what to do' },
      { t: 'table', head: ['Problem', 'What to do'], widths: [0.36, 0.64], rows: [
        ['Forgot the password', 'Ask the Commissioner: Users → **Reset password** gives you a new one-time password.'],
        ['**Save** or **Report** stays grey', 'Save: you marked the CC road restored, so add a photo (red box), or a required field is empty. Report: write the remark (required).'],
        ['Badge says **No GPS**, or GPS ±80 m (weak)', 'Phone Settings → Location on; Settings → Apps → Chrome (or Safari) → Location → Allow; reload the app. Weak: step away from buildings for a few seconds.'],
        ['Cannot find a road; map blank', '**Layers & search**: type the stretch code, a manhole number, the ward or the road name. Blank map: check mobile data and reload; if it continues, tell IT.'],
        ['Pipes do not turn yellow when tapped', 'Zoom in more and tap right on the thin line. Or use **Draw line**.'],
        ['"… already exists in Zone …"', 'That manhole number is already used in the zone. Check the drawing, or tap the existing manhole.'],
        ['"Someone else changed this stretch"', 'Close the form, open the stretch again, repeat your change.'],
        ['Entered something wrong', 'Update the stretch again with the right value. History keeps both; the Commissioner can also roll back.'],
      ] },

      { t: 'h1', text: '6. Quick card (print and keep in your pocket)', newPage: true },
      { t: 'table', head: ['To', 'Tap'], widths: [0.3, 0.7], rows: [
        ['Sign in', `Web address → ${EMAIL} → your password → **Sign in**`],
        ['New road', '**+ Road stretch** → tap pipes along the road → **Next: record status** → fill A–F → photo (optional) → **Save**'],
        ['Daily update', 'Tap the road → **Update status** → change only what changed → **Save** (photo needed for CC restored)'],
        ['Leak repaired', 'Tap the road → **Update status** → **Leakages fixed +** → **Save**'],
        ['See past entries', 'Tap the road → **History**'],
        ['Damage at a spot', '**Report issue** → tap the spot → problem, how many, severity → **remark** → photo (optional) → **Report**'],
        ['Issues of one ward', 'Menu → **Issues** → choose zone → choose **ward**'],
        ['Hand an issue over', 'Menu → **Issues** → tap it → **Assign** → who + due date → **Assign**'],
        ['Close an issue', 'Menu → **Issues** → tap it → **Mark resolved** → how it was fixed + photo → **Resolve**'],
        ['Missing manhole', '**+ Manhole** → tap its spot → number, GL, IL, reason → **Send for approval**'],
        ['Missing pipe', '**+ Pipe** → tap manhole 1 → tap manhole 2 → diameter → **Send for approval**'],
        ['Wrong item', 'Tap it → **Request deletion** → reason'],
        ['My proposals', 'Menu → **My requests** (waiting · decided · withdraw)'],
        ['Many roads', '**Select several** → tap roads → **Next: choose changes** → **Apply**'],
        ['Labour', 'Menu → **Log labour** → date, ward, labourers, machines → **Save**'],
        ['No signal', 'Save anyway; it sends later. Do not clear browser data.'],
      ] },
      { t: 'table', head: ['Line colour', 'Meaning'], widths: [0.3, 0.7], rows: [
        ['Grey · Blue · Orange', 'Not started · work in progress · back-filled, restoration pending'],
        ['Yellow · Light green · **Green**', 'Restored, curing · cured, awaiting approval · **approved**'],
        ['Red outline · Dashed amber', 'Open issue · proposed, awaiting approval'],
      ] },
      { t: 'note', tone: 'key', label: 'Golden rules.', text: 'Record on site, the same day. One road between two junctions per stretch. A photo for every CC restoration (required) and, whenever you can, for damage. A clear remark on every issue. Your own account only.' },
    ],
  };
};
