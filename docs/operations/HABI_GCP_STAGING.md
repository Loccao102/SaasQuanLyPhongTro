# Habi GCP VM staging — Ubuntu 26.04 (x86_64)

This staging stack runs **only** NestJS API, Redis, Zalo QR worker, Zalo notification worker and Caddy. It uses the **existing Neon database branch `habi-staging`** (`br-withered-base-b3ndxmto`) in Neon project `soft-wave-01888923`. Never point it to the primary Neon branch.

## Preconditions

- GCP Ubuntu VM with working Docker Compose, outbound Internet and sufficient RAM/disk.
- Fixed external IPv4 is recommended for a 1-month pilot (an ephemeral IP may change on stop/start).
- One hostname pointing to the VM public IPv4. For short-lived pilot only, `api.<VM_EXTERNAL_IP>.sslip.io` may be used; for real users prefer a domain you control. The DNS resolution and ACME certificate must work.
- GCP VPC ingress firewall: allow TCP 80/443 to **only this VM**. Do not publish 4000/5432/6379, and restrict SSH access.
- Google Cloud billing budget alerts configured; billing alerts do not stop charges.
- Preview Habi Admin URL from the feature branch, not production main.

## Bootstrap

SSH into the VM:

```sh
git clone --branch feat/zalo-personal-multitenant https://github.com/Loccao102/SaasQuanLyPhongTro.git
cd SaasQuanLyPhongTro
cp infra/.env.staging.example .env.staging
chmod 600 .env.staging
nano .env.staging
```

Fill `HABI_API_DOMAIN` (hostname **without** https), `HABI_ADMIN_ORIGIN` (exact `https://` origin), `DATABASE_URL` using Neon **habi-staging** branch (pooled SSL URI), and all required secrets. Keep secrets only on the VM, never in Git or ChatGPT messages. Generate three separate tokens with `openssl rand -hex 32`, and the Zalo master key with `openssl rand -base64 32`. Keep the Zalo master key stable across restarts.

Validate without showing secrets:

```sh
sudo docker compose --env-file .env.staging -f infra/docker-compose.staging.yml config --quiet
```

Start the API, Redis and HTTPS **before** starting browser workers:

```sh
sudo docker compose --env-file .env.staging -f infra/docker-compose.staging.yml up -d --build redis api caddy
sudo docker compose --env-file .env.staging -f infra/docker-compose.staging.yml ps
curl -fsS https://$(grep '^HABI_API_DOMAIN=' .env.staging | cut -d= -f2)/api/health
```

The SSL certificate can take a short time to provision after DNS and port 80/443 are working. Do not use `curl -k`; fix TLS instead. If proxy cannot reach the API, review logs without dumping env secrets:

```sh
sudo docker compose --env-file .env.staging -f infra/docker-compose.staging.yml logs --tail=80 api caddy
```

**The Neon branch already has both migrations and 81 tables.** Do not run `seed:demo` on public beta. If the DB setup script is ever needed, it targets Neon via `DATABASE_URL`; verify branch first.

## Connect Vercel Preview

In Vercel project `habi-admin-staging` set these env vars for **Preview**:

```dotenv
NEXT_PUBLIC_ADMIN_API_BASE_URL=/api
ADMIN_API_PROXY_TARGET=https://api.<VM_EXTERNAL_IP>.sslip.io/api
```

Use the *actual HTTPS API hostname*, redeploy the feature branch (never point at localhost). Preview deployments are protected by Vercel authentication by default; do not remove this protection or promote to public access until authentication, tenant isolation, and Zalo flows have been tested and the dependency audit finding is fixed.

## Bootstrap an owner and test

To create **one** staging OWNER account without writing its password into `.env.staging` or shell history:

```sh
read -rsp "Staging OWNER password: " BOOTSTRAP_OWNER_PASSWORD; echo
read -rp "OWNER email: " BOOTSTRAP_OWNER_EMAIL
sudo docker compose --env-file .env.staging -f infra/docker-compose.staging.yml run --rm -T \
  -e BOOTSTRAP_OWNER_PASSWORD="$BOOTSTRAP_OWNER_PASSWORD" \
  -e BOOTSTRAP_OWNER_EMAIL="$BOOTSTRAP_OWNER_EMAIL" \
  -e BOOTSTRAP_OWNER_DISPLAY_NAME="Habi Owner" \
  -e BOOTSTRAP_ORGANIZATION_NAME="Habi Pilot" \
  -e BOOTSTRAP_ORGANIZATION_SLUG="habi-pilot" \
  api pnpm --filter @propops/api auth:bootstrap-owner
unset BOOTSTRAP_OWNER_PASSWORD BOOTSTRAP_OWNER_EMAIL
```

Be mindful that passing secrets via command arguments may expose them in a process list; use an encrypted secrets service for shared production operations. For pilot usage, prefer a one-time environment-file procedure with owner-only file permissions.

Start the Zalo browser workers **after** the API and auth smoke test:

```sh
sudo docker compose --env-file .env.staging -f infra/docker-compose.staging.yml up -d --build worker-zalo-login worker-notification
sudo docker compose --env-file .env.staging -f infra/docker-compose.staging.yml ps
```

Run test logins for two different organizations and check that each organization's QR and Zalo session is isolated. Do not assume unofficial Zalo Web automation will be stable for a full month; it must be tested against real Zalo Web.

## Keep the pilot secure and under budget

- Backups and data retention: Neon branch data should be backed up before opening to testers; database branch is not a backup strategy.
- Do not put Redis on a public port.
- Configure billing budget alerts and control the VM uptime manually if needed.
- Stable DNS/TLS is required for public use. Do not use Google Cloud external IP directly as HTTPS origin without a valid TLS certificate.
- Vercel Hobby is intended for personal/non-commercial use; check plan applicability to your SaaS trial.
- Do not publish until the known Next.js security advisory and other CI failures are resolved.
