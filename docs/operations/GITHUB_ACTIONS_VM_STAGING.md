# Habi staging: main → GitHub Actions → GCP VM

This deployment strategy builds Docker images directly **on `habi-gp`**. A GitHub
Actions self-hosted runner on that VM performs the deployment after the
GitHub-hosted `verify` job succeeds on a `main` push.

```text
PR → CI on ubuntu-latest (no VPS access)
   → merge/push main
   → CI verify (audit, lint, typecheck, tests, build)
   → deploy-staging-vm on self-hosted runner [habi-staging]
   → docker compose build on habi-gp
   → update API and wait for healthy
   → update worker-notification and worker-zalo-login
```

The staging database remains the configured Neon branch. Docker Compose keeps
its existing named Redis and Caddy volumes; it must not use `down -v` or
`docker system prune --volumes`.

## One-time GCP VM setup

Run these on `habi-gp` as an administrative user:

```bash
sudo adduser --disabled-password --gecos "" habi-runner
sudo usermod -aG docker habi-runner
sudo install -d -o root -g habi-runner -m 0750 /etc/habi
```

Keep staging secrets **outside** the Actions checkout. For an existing staging
configuration at `~/SaasQuanLyPhongTro/.env.staging`, create a read-only copy:

```bash
sudo install -o root -g habi-runner -m 0640 \
  /home/loccao102_gmail_com/SaasQuanLyPhongTro/.env.staging \
  /etc/habi/staging.env
sudo -u habi-runner test -r /etc/habi/staging.env && echo "staging env readable"
sudo -u habi-runner docker info >/dev/null && echo "docker accessible"
```

If the real staging env file is somewhere else, adjust the source of the
`install` command. If it does not exist, do not copy or invent secrets: find
the original Compose environment first.

**Important:** membership of the Docker group effectively grants root
privileges on this VM. Use a dedicated runner account and only run trusted
`main` code on this runner. Set branch protection/reviews on `main`; never
run fork PR workflows on this VM.

## Register the GitHub Actions runner

1. Open GitHub repo **Settings → Actions → Runners → New self-hosted runner**.
2. Choose Linux / x64, and copy the current official download/configuration
   commands from that screen (the registration token is short-lived).
3. Switch to `habi-runner` and execute those commands within its home
   directory. On `./config.sh` register the extra label `habi-staging`.
   The runner must have labels `self-hosted`, `linux`, `x64`,
   `habi-staging`.
4. From the runner directory, install and start the service:

   ```bash
   sudo ./svc.sh install habi-runner
   sudo ./svc.sh start
   sudo ./svc.sh status
   ```

5. Confirm GitHub lists the runner as **Idle/Online**. No public inbound port
   or SSH key is needed for the runner: it makes outbound connections to
   GitHub.

## Repository configuration

In GitHub repo **Settings → Environments**, create `staging`. You may enable
required reviewers for deployment approval. Create the repository or
environment variable:

```text
HABI_STAGING_ENV_FILE=/etc/habi/staging.env
```

If this variable is omitted the script defaults to the same path. Do **not**
upload the contents of `.env.staging` to a GitHub artifact, a workflow log
or the repository.

The existing `.github/workflows/ci.yml` has:
- PR verify on GitHub-hosted runner;
- `push` to `main`: verify, then VM deployment only if **all** verify steps
  succeeded;
- deployment mutex, 75-minute timeout and fixed runner labels.

**Known prerequisite:** the current `main` CI run failed. The audit/lint/
integration failures must be fixed before this gated deployment can run.
Do not replace this gate with `if: always()` or skip checks silently.

## Staging admin / Origin settings

The existing Compose file reads:

```text
HABI_ADMIN_ORIGIN=https://<stable-habi-admin-host>
HABI_PREVIEW_ADMIN_ORIGIN=https://<optional-exact-preview-host>
```

Only exact HTTPS origins should be configured; never `*` or
`*.vercel.app` in `CORS_ORIGINS`. Use a stable main-branch admin host for
routine operation so every preview deployment does not require a CSRF origin
change.

The Vercel frontend is separately deployed by its Git integration: this VM
deploy job updates **API and Playwright workers**, not the Vercel frontend.

## Operations

Actions logs show the deployed commit SHA and Docker Compose service status.
Inspect directly if needed:

```bash
sudo docker ps --format "table {{.Names}}\t{{.Status}}"
sudo docker logs --tail=150 habi-staging-worker-notification-1
```

A new Playwright image does **not** automatically enable a paused Zalo provider.
After a UI failure, inspect the live monitor, verify that a test recipient
is correct, then separately authorize unpausing the provider. Never blindly
retry `UNKNOWN` deliveries.

If a deployment fails its API health gate, workers are not replaced. Investigate
API logs and revert the faulty `main` commit via a reviewed revert, then let
CI build and deploy that commit. Do not reset Neon or delete Docker volumes.
