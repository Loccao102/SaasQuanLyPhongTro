#!/usr/bin/env bash
# Runs ON the self-hosted habi-staging runner, not on GitHub's cloud runner.
# The source is the exact main commit checked out by actions/checkout.
set -Eeuo pipefail

cd "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  echo "Refusing to deploy a ref other than main" >&2
  exit 1
fi

env_file="${HABI_STAGING_ENV_FILE:-/etc/habi/staging.env}"
if [[ ! -r "$env_file" ]]; then
  echo "Staging environment file is missing or unreadable at $env_file" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is not installed on the VM" >&2
  exit 1
fi
docker info >/dev/null
docker compose version >/dev/null

# Prevent simultaneous deploys caused by manual runs or another runner service.
exec 9>/tmp/habi-staging-deploy.lock
flock -n 9 || { echo "Another staging deploy is in progress" >&2; exit 1; }

compose=(docker compose --env-file "$env_file" -f infra/docker-compose.staging.yml)
"${compose[@]}" config -q

echo "Deploying reviewed main commit: ${GITHUB_SHA:?}"
# Build on the VM using its local Docker engine. Both notification and login
# worker services use the same image tag, so a single worker build is sufficient.
"${compose[@]}" build api worker-notification

# Bring up the API first and abort before replacing workers on healthcheck failure.
"${compose[@]}" up -d --no-deps --wait --wait-timeout 180 api

# A healthy /api/health does not prove browser login works. Confirm that
# login's CSRF/Origin guard accepts every explicit admin origin and rejects
# an unrelated origin. Empty login payloads stop at validation (no real login
# credentials, sessions, messages, or database writes).
"${compose[@]}" exec -T api node -e '
(async () => {
  const origins = [...new Set((process.env.CORS_ORIGINS ?? "")
    .split(",").map(x => x.trim()).filter(Boolean))];
  const appOrigin = process.env.AUTH_PUBLIC_APP_URL;
  if (!appOrigin || !origins.includes(appOrigin)) {
    throw new Error("AUTH_PUBLIC_APP_URL must be present in CORS_ORIGINS");
  }
  const endpoint = "http://127.0.0.1:4000/api/auth/login";
  async function assertOrigin(origin, expectedStatus) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Origin": origin, "Content-Type": "application/json" },
      body: "{}"
    });
    if (response.status !== expectedStatus) {
      throw new Error("Origin smoke test failed for " + origin +
        ": expected HTTP " + expectedStatus +
        ", got HTTP " + response.status);
    }
  }
  for (const origin of origins) {
    await assertOrigin(origin, 400);
  }
  await assertOrigin("https://untrusted.example", 403);
  process.stdout.write("Auth origin smoke test passed for " + origins.length +
    " allowed origins; unknown origin blocked.\\n");
})().catch(error => { console.error(error); process.exit(1); });
'

# The existing paused-provider setting in Neon is intentionally unchanged.
# This step does not retry queued messages or unpause PLAYWRIGHT_ZALO.
"${compose[@]}" up -d --no-deps --no-build worker-notification worker-zalo-login

"${compose[@]}" ps
echo "Staging VM deploy finished at commit $GITHUB_SHA"
