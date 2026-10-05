# Acceptance checklist (before go-live)

Tick each line on the deployed site. Use a phone for the field lines. The demo data option (§ below) lets
you try everything without touching real records.

## IT

- [ ] `https://<DOMAIN>` opens with a valid certificate; `http://` redirects to `https://`
- [ ] `node server/test/postdeploy-check.mjs https://<DOMAIN>` passes (and again with a signed-in account)
- [ ] `docker compose ps` shows db, app and caddy healthy; they restart after a server reboot
- [ ] Nightly backup is scheduled; one backup restored successfully on a spare machine
- [ ] Server snapshots enabled; SSH limited to the office IP

## Commissioner

- [ ] Sign in with the one-time password; asked to set a new one
- [ ] Map: imagery sharp at full zoom in Madupalli and the core town; pipes run along known roads
- [ ] Click a manhole (levels, depth) and a pipe (diameter, flow direction)
- [ ] Dashboard figures match the progress sheet (pipeline 54.7 of 99.6 km, manholes 1,976 of 4,387, ICs 491 of 2,655)
- [ ] Download Excel opens in Excel; the KML opens in Google Earth
- [ ] Users page lists Commissioner, AEE and Field Inspector
- [ ] Issues page: choose Zone 2, then Ward 5; Download Excel gives only those issues
- [ ] Storage page: usage shows; choose a date and Photos; Will delete shows a number; Download archive first gives a zip (do not delete on the live system during acceptance unless intended)

## AEE and Field Inspector (on their phones)

- [ ] Sign in, set own password, add the app to the home screen, allow location
- [ ] Record a stretch: pick pipes → fill the six sections → photo → save; it shows as proposed
- [ ] Record a stretch on a pipe outside the ward outlines (e.g. in Madupalli): the bar shows "ward N (outside ward boundary)" and it saves
- [ ] Commissioner approves it in **Approvals**; it becomes a normal stretch
- [ ] Update it to "CC restored, curing done" with a photo; Commissioner approves; it turns green
- [ ] Tick "drain clogged" (photo optional); the issue appears in **Issues**; resolve it with a note
- [ ] Record 2 water pipe leakages, then 1 and 2 leakages fixed: the leak issue count drops to 1, then closes
- [ ] Report issue: Report stays grey until a remark is written; it sends without a photo
- [ ] Propose a manhole and a pipe; Commissioner approves the manhole, then the pipe
- [ ] Switch the phone to airplane mode, save an update, switch back: it is sent automatically
- [ ] Log labour for today

## Demo data (optional, test copies only)

On a **test** deployment, after the Commissioner and AEE have set their passwords, IT can load sample
records in every stage:
`docker compose exec -e SEED_EMAIL=<admin email> -e SEED_PASSWORD=<admin password> app node server/test/demo-seed.mjs http://localhost:8080`
Do not run it on the live system.
