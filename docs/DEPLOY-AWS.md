# Deployment Guide: Git and AWS

_Release v1.0 · 2 October 2026 · one AWS EC2 server with Docker (vendor-neutral package)_

This guide takes the release package to a working, secure website on AWS in about an hour, and sets up the Git repository the municipality will keep the code in. Everything in the package uses open formats (Docker/OCI container, Docker Compose, PostgreSQL, GeoJSON, PMTiles), so the same package also runs on any other cloud or an on-premise server (see `docs/DEPLOY-GENERIC.md`).

| You will end with | Detail |
| --- | --- |
| Website | `https://<your domain>` with an automatic, free, auto-renewing TLS certificate |
| Server | 1 × EC2 (Ubuntu 24.04) in Mumbai, ap-south-1, running 3 containers: PostgreSQL, the app, Caddy (HTTPS) |
| Data kept in India | Database and photos on the server's encrypted disk, nightly backups, daily disk snapshots |
| Code | Private Git repository (GitHub, GitLab, Bitbucket or your own), tag `v1.0`, created from the package in Part A |
| Accounts | Commissioner, AEE and Field Inspector, created on first start with one-time passwords (in the user guides) |

## Part 0. What you received

`madhira-ugd-v1.0.zip` (130 MB) and `SHA256SUMS.txt`. Unzipped, the folder `madhira-ugd/` holds every file of release v1.0; Part A turns it into the municipality's Git repository.

| Folder / file | Contents |
| --- | --- |
| `README-FIRST.md` | Start here: overview and handover checklist |
| `server/`, `web/`, `shared/` | Source code: API server (Node.js 24), web app (React + MapLibre), shared rules |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Container build and the three-service deployment |
| `deploy/` | Caddy (HTTPS) configuration, nightly backup script, starting accounts (hashed passwords) |
| `data/processed/` | Map data the app serves (35 MB): satellite tiles (PMTiles), wards, zones, 3,969 manholes, 3,991 pipes, progress baseline |
| `data/raw/` | Original files (91 MB): Google Earth frames, KML, network plans and town plans (PDF), progress Excel |
| `pipeline/` | Python scripts that turned the originals into `data/processed` (only needed to rebuild map data) |
| `docs/` | This guide, user guides (Word), architecture, data dictionary, imagery and georeferencing, API, operations, acceptance checklist, licences |
| `server/test/` | Post-deployment checks (read-only) and the full test suite (test copies only) |

#### Check the package arrived intact

```bash
sha256sum -c SHA256SUMS.txt        # Linux
shasum -a 256 -c SHA256SUMS.txt    # macOS
# expected: madhira-ugd-v1.0.zip: OK
```

> **Contains one-time passwords.** The user guides in `docs/` contain the starting passwords for the three accounts. They stop working once each person signs in and sets their own password, but treat the package as confidential until then.

## Part A. Git repository

The municipality should own the code in its own private repository. The largest file is 21 MB, so any Git host works without Git LFS.

1. Create an **empty, private** repository on your Git host (GitHub, GitLab, Bitbucket, Azure DevOps, or a self-hosted Gitea/GitLab). Do not add a README or licence there.
2. On an office machine with Git installed, unzip the package, record it as the first commit, tag it and push it:

   ```bash
   unzip madhira-ugd-v1.0.zip
   cd madhira-ugd
   git init -b main
   git add -A
   git commit -m "Madhira UGD Tracker v1.0"
   git tag -a v1.0 -m "Release v1.0"
   git remote add origin <your repository URL>
   git push -u origin main --tags
   ```
3. Check on the Git host that `main` and the tag are there and that `.env` is **not** (the `.gitignore` already excludes it).
4. In the repository settings, protect the `main` branch (no force-push; changes through pull/merge requests).
5. Add a **read-only deploy key** for the server (created in step B7).

#### How changes flow

| Item | Convention |
| --- | --- |
| Branch `main` | What runs in production |
| Changes | On a feature branch → merge request → review → merge to `main` |
| Releases | Tag every deployment: `v1.0`, `v1.1` … (`git tag v1.1 && git push --tags`) |
| Never commit | `.env` (passwords), `backups/`, `var/` (already in `.gitignore`) |
| Rollback | On the server: `git checkout v1.0 && docker compose up -d --build` |

## Part B. AWS: one EC2 server with Docker

### B1. Before you start

- An AWS account, and a person with permission to create EC2 instances, security groups, Elastic IPs and (if used) Route 53 records.
- A domain or sub-domain for the site, e.g. `ugd.<municipality-domain>`, and access to its DNS.
- Your office's public IP address (for SSH access); find it at https://checkip.amazonaws.com.
- Select the **Asia Pacific (Mumbai) ap-south-1** region (top-right of the AWS console) for every step.

### B2. Key pair and security group

1. **EC2 → Key pairs → Create key pair**: name `madhira-ugd`, type ED25519, format `.pem`. Store the downloaded file safely; it is the only way to SSH in.
2. **EC2 → Security groups → Create security group** `madhira-ugd-web` in the default VPC with these inbound rules:

| Type | Port | Source | Why |
| --- | --- | --- | --- |
| SSH | 22 | Your office IP /32 only | Administration |
| HTTP | 80 | 0.0.0.0/0 and ::/0 | Certificate issue and redirect to HTTPS |
| HTTPS | 443 | 0.0.0.0/0 and ::/0 | The website |

Leave outbound as "all traffic". Do not open 5432 (database) or 8080 (app): they stay inside the server.

### B3. Launch the server

**EC2 → Instances → Launch instances**:

| Setting | Value |
| --- | --- |
| Name | `madhira-ugd-prod` |
| Image (AMI) | Ubuntu Server 24.04 LTS (64-bit x86) |
| Instance type | `t3.small` (2 vCPU, 2 GB). Use `t3.medium` if you prefer more headroom. |
| Key pair | `madhira-ugd` |
| Network | Default VPC, a public subnet, auto-assign public IP **enabled**, security group `madhira-ugd-web` |
| Storage | 40 GiB **gp3**, **Encrypted: yes** (default AWS key) |
| Advanced → Termination protection | Enable |
| Advanced → Metadata version | V2 only (token required) |

### B4. Fixed address and DNS

1. **EC2 → Elastic IPs → Allocate Elastic IP address**, then **Actions → Associate** it with `madhira-ugd-prod`. Note the address.
2. In your DNS (Route 53 **Hosted zones → Create record**, or your registrar's panel) create an **A record**: name `ugd` (or your choice) → the Elastic IP, TTL 300.
3. Wait until the name resolves to the Elastic IP (usually minutes):

   ```bash
   nslookup ugd.<your-domain>
   ```

> **Important:** DNS must point at the server before step B9, otherwise the free certificate cannot be issued (Caddy retries automatically once it does).

### B5. Connect and prepare the server

1. From the office machine:

   ```bash
   chmod 400 madhira-ugd.pem
   ssh -i madhira-ugd.pem ubuntu@<elastic-ip>
   ```
2. Update the system, set the time zone, turn on automatic security updates:

   ```bash
   sudo apt update && sudo apt -y upgrade
   sudo timedatectl set-timezone Asia/Kolkata
   sudo apt -y install unattended-upgrades git
   sudo dpkg-reconfigure -plow unattended-upgrades     # answer Yes
   ```
3. Add 2 GB of swap (helps the build on a 2 GB server):

   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

### B6. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh        # Docker Engine + Compose plugin
sudo usermod -aG docker ubuntu
exit                                               # log out, then SSH in again
docker version && docker compose version          # both should print versions
```

Your security policy may prefer the apt repository method: https://docs.docker.com/engine/install/ubuntu/. Either is fine.

### B7. A read-only deploy key for Git

```bash
ssh-keygen -t ed25519 -f ~/.ssh/madhira_deploy -N ""
cat ~/.ssh/madhira_deploy.pub     # paste into the repository: Settings → Deploy keys (read-only)
printf "Host <git-host>\n  IdentityFile ~/.ssh/madhira_deploy\n" >> ~/.ssh/config
```

### B8. Get the code onto the server

```bash
sudo mkdir -p /opt/madhira-ugd && sudo chown ubuntu:ubuntu /opt/madhira-ugd
git clone git@<git-host>:<org>/madhira-ugd.git /opt/madhira-ugd
cd /opt/madhira-ugd && git checkout v1.0
```

No Git host yet? Copy the zip instead: `scp -i madhira-ugd.pem madhira-ugd-v1.0.zip ubuntu@<elastic-ip>:/opt/` then `cd /opt && unzip madhira-ugd-v1.0.zip`. The folder must end up at `/opt/madhira-ugd` (the backup script and runbook assume this name).

### B9. Settings and first start

1. Create the settings file from the example and make two random secrets:

   ```bash
   cd /opt/madhira-ugd
   cp .env.example .env && chmod 600 .env
   openssl rand -hex 24     # use for DB_PASSWORD
   openssl rand -hex 32     # use for JWT_SECRET
   nano .env
   ```
2. In `.env` set `DOMAIN` (e.g. `ugd.example.in`, no https://), `DB_PASSWORD` and `JWT_SECRET`. Save (Ctrl+O, Enter, Ctrl+X).
3. Build and start (the first build takes 5–10 minutes):

   ```bash
   docker compose up -d --build
   docker compose ps                      # db, app, caddy: running / healthy
   docker compose logs app | tail -20     # look for "Server listening" and
                                          # "Created 3 starting accounts"
   ```
4. Open `https://<DOMAIN>` in a browser: the sign-in page appears with a valid padlock.

### B10. Check the deployment

```bash
docker compose exec app node server/test/postdeploy-check.mjs https://<DOMAIN>
```

All lines must show **PASS** (site, HTTPS redirect, phone-app files, sign-in guard). The data checks need a signed-in account: once the Commissioner has signed in (Part C), ask them to create a **Viewer** account for IT (e.g. `it@madhira.local`), set its password, and run:

```bash
docker compose exec app node server/test/postdeploy-check.mjs https://<DOMAIN> it@madhira.local '<password>'
```

This also checks the 22 wards, the sewer network, all four imagery frames, the progress baseline (99,560 m), exports and live updates. The script only reads; it is safe on the live system. Never run `staging-test.mjs` or `demo-seed.mjs` on the live system (they create test records).

### B11. Backups

1. Nightly database dump and photo archive (kept 30 days in `/opt/madhira-ugd/backups`):

   ```bash
   cd /opt/madhira-ugd && mkdir -p backups
   sh deploy/backup.sh                     # run once by hand: "backup done"
   crontab -e                              # add the line below
   30 1 * * * cd /opt/madhira-ugd && sh deploy/backup.sh >> backups/backup.log 2>&1
   ```
2. **Disk snapshots**: EC2 → Elastic Block Store → **Lifecycle Manager → Create lifecycle policy** → EBS snapshot policy, target the instance's volume (tag it `Backup=madhira-ugd`), every 24 hours at 02:00 IST, retain 14.
3. Optional off-server copy: copy `backups/` to an S3 bucket in ap-south-1 (e.g. `aws s3 sync backups s3://<bucket>/madhira-ugd/` from cron, with an instance role allowed to write to that bucket only).
4. Test a restore on a spare server before go-live (commands in `docs/OPERATIONS.md`).

### B12. Monitoring

- **CloudWatch → Alarms → Create alarm**: metric EC2 `StatusCheckFailed` for the instance ≥ 1 for 2 periods → notify an SNS e-mail topic; add **recover instance** as the action.
- A second alarm on `CPUUtilization` > 80 % for 30 minutes.
- **Route 53 → Health checks**: HTTPS, domain `<DOMAIN>`, path `/api/health`, with an alarm to the same SNS topic (or any uptime monitor you already use).
- Logs: `docker compose logs --since 1h app` (container logs rotate at 10 MB × 5 files).

### B13. Security checklist

- SSH open only to the office IP; key-based login only (Ubuntu default). Consider AWS Systems Manager Session Manager instead of SSH.
- Disk encrypted; IMDSv2 required; termination protection on; automatic security updates on.
- `.env` readable only by `ubuntu` (`chmod 600`), never committed to Git.
- Only ports 80 and 443 are public; the database is reachable only inside Docker.
- Imagery is for internal municipal use (see `docs/LICENCES.md`); the site requires sign-in for everything.

### B14. Updates and rollback

```bash
cd /opt/madhira-ugd
sh deploy/backup.sh                       # backup first
git fetch --tags && git checkout v1.1     # the new release tag
docker compose up -d --build              # database changes apply automatically
docker compose exec app node server/test/postdeploy-check.mjs https://<DOMAIN>
# rollback:  git checkout v1.0 && docker compose up -d --build
```

### B15. Approximate monthly cost (ap-south-1, on-demand)

| Item | Approx. USD / month |
| --- | --- |
| EC2 t3.small (t3.medium ≈ double) | 15–17 |
| 40 GiB gp3 disk | ≈ 3–4 |
| Public IPv4 / Elastic IP | ≈ 3–4 |
| Snapshots (14 days, incremental) | 1–3 |
| Route 53 hosted zone + health check (if used) | ≈ 1 |
| Data transfer (a few users) | < 1 |
| **Total** | **≈ 25–30** |

Prices change; confirm with the AWS Pricing Calculator. A 1-year Savings Plan or reserved instance lowers the EC2 cost by roughly a third.

### B16. Troubleshooting

| Symptom | Check |
| --- | --- |
| Site does not open | `docker compose ps`; security group has 80/443; DNS resolves to the Elastic IP |
| Browser warns about the certificate | `docker compose logs caddy`: DNS must point at the server and port 80 must be open; Caddy retries automatically |
| Build fails with out-of-memory | Swap added (B5)? Or use t3.medium |
| Map without satellite imagery | Run the post-deploy check; a proxy or CDN in front must pass HTTP Range requests |
| Live updates not arriving | Only if another proxy is put in front: it must not buffer `/api/events` |
| More | `docs/OPERATIONS.md` |

## Part C. After go-live

1. Send the web address to the Commissioner, with the **Commissioner's Guide** (`docs/user-guides/`).
2. The Commissioner signs in first, sets a password, and gives the AEE and Field Inspector their sign-ins with the **AEE and Field Inspector Guide**.
3. Each of them signs in on their phone, sets a password and adds the app to the home screen.
4. The Commissioner creates the **Viewer** account for IT (B10); run the full post-deploy check.
5. Work through `docs/UAT-CHECKLIST.md` together; sign off.
6. Tag the accepted version in Git if anything changed (`v1.0.1`), and note the server details below.

| Handover record | Fill in |
| --- | --- |
| Web address |  |
| AWS account / region | ap-south-1 |
| Instance ID / Elastic IP |  |
| Git repository URL |  |
| Deployed tag and date | v1.0 ·  |
| Backup location(s) | /opt/madhira-ugd/backups · EBS snapshots |
| IT contact |  |

## Reference

#### Settings (`.env`)

| Variable | Required | Meaning |
| --- | --- | --- |
| `DOMAIN` | yes | Web address without https:// |
| `DB_PASSWORD` | yes | PostgreSQL password (internal to the server) |
| `JWT_SECRET` | yes | Signs sign-in sessions; changing it signs everyone out |
| `FAR_THRESHOLD_M` | no (200) | Distance beyond which a field update is flagged |
| `MAX_PHOTO_MB` | no (8) | Largest photo accepted |
| `SESSION_DAYS` | no (14) | How long a sign-in lasts |
| `TIME_ZONE` | no (Asia/Kolkata) | Dates in reports |

To set an optional variable, add it under `app → environment` in `docker-compose.yml` (or to `.env` and reference it there) and run `docker compose up -d`.

#### Where things live on the server

| What | Where |
| --- | --- |
| Code and settings | `/opt/madhira-ugd` (`.env` holds the secrets) |
| Database | Docker volume `madhira-ugd_db` |
| Photos | Docker volume `madhira-ugd_uploads` (`/var/lib/ugd/uploads` inside the app) |
| Certificates | Docker volume `madhira-ugd_caddy` |
| Backups | `/opt/madhira-ugd/backups` |

#### Moving to another cloud later

Install Docker on the new server, copy `/opt/madhira-ugd` (with `.env`), restore the latest database dump and photo archive (`docs/OPERATIONS.md`), point DNS at the new server, and `docker compose up -d`. Nothing in the package is AWS-specific.
