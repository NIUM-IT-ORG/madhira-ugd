MADHIRA UGD TRACKER - LOCAL TRIAL (Mac)
=======================================

A working copy of the Underground Drainage tracker for Madhira Municipality that runs on your Mac,
with the real satellite imagery, wards and sewer network, and sample field records. Nothing is sent
anywhere; everything stays in this folder.

1. Install Node.js (one time)
   Download the LTS installer (version 24 or newer) from https://nodejs.org and run it.

2. Start
   Double-click  start.command
   (First time macOS may say it "cannot be opened": right-click start.command > Open > Open.)
   A Terminal window opens, the app starts, sample data is loaded on the first run, and your
   browser opens http://localhost:8080

3. Sign in (trial accounts)
   Commissioner      commissioner@trial.local    trial-commissioner
   AEE               aee@trial.local             trial-aee
   Field Inspector   inspector@trial.local       trial-inspector

4. Stop
   Close the Terminal window (or press Ctrl+C in it).

Start again later: double-click start.command; your changes are kept.
Start from scratch: double-click reset.command, then start.command.

Things to try
 - Map: zoom into Madupalli or the bus stand; click a manhole, a pipe, a coloured road stretch.
 - "Colour by" above the map: Overall, Sewer work, Road restoration, Motorability, Utilities, Hazards.
 - As AEE: "+ Road stretch", tap pipes along a road, Next, fill the six sections, Save.
 - As Commissioner: Approvals (approve a restoration so it turns green), Dashboard, Download Excel,
   Open in Google Earth, Users.
 - Phone view: open http://<this Mac's IP>:8080 on a phone on the same Wi-Fi
   (find the IP in System Settings > Wi-Fi > Details). GPS needs the real (HTTPS) deployment.

Needs internet only for the satellite background outside Madhira; the Madhira imagery is included.
Sample records are invented for the demo. Satellite imagery: Google Earth, for internal use only.
