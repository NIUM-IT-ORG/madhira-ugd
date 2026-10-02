# Guide sources

The Word guides are generated from these scripts so they stay consistent (the deployment guide also
writes `docs/DEPLOY-AWS.md`).

```bash
cd docs/source && npm install docx@9
CREDENTIALS_FILE=<json of {email: one-time password}> node build.js
```

The credentials file is not in Git. If you only change text, keep the existing guides' passwords by
recreating that file from the guides, or issue new one-time passwords (Users → Reset password) and print those.
