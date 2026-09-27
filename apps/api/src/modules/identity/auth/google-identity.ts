type GoogleJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

type GoogleJwksResponse = {
  keys?: GoogleJwk[];
};

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string;
  displayName: string;
  hostedDomain: string | null;
  authoritativeEmail: boolean;
};

let cachedKeys: GoogleJwk[] = [];
let cachedUntil = 0;

function decodeJsonPart<T>(value: string): T {
  const text = Buffer.from(value, "base64url").toString("utf8");
  return JSON.parse(text) as T;
}

function cacheMaxAge(headers: Headers): number {
  const value = headers.get("cache-control") ?? "";
  const match = value.match(/max-age=(\d+)/i);
  return match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
}

async function googleKeys(): Promise<GoogleJwk[]> {
  if (cachedKeys.length > 0 && cachedUntil > Date.now()) {
    return cachedKeys;
  }

  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/certs",
    { signal: AbortSignal.timeout(5_000) }
  );
  if (!response.ok) {
    throw new Error("Không thể tải public key để xác thực Google.");
  }

  const payload = (await response.json()) as GoogleJwksResponse;
  if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new Error("Google JWKS response không hợp lệ.");
  }

  cachedKeys = payload.keys;
  cachedUntil = Date.now() + cacheMaxAge(response.headers);
  return cachedKeys;
}

export async function verifyGoogleIdentityToken(
  credential: string,
  clientId: string,
  expectedNonce?: string
): Promise<VerifiedGoogleIdentity> {
  if (
    credential.length < 32 ||
    credential.length > 16 * 1024 ||
    !clientId.trim() ||
    (expectedNonce !== undefined &&
      (expectedNonce.length < 32 || expectedNonce.length > 256))
  ) {
    throw new Error("Google credential không hợp lệ.");
  }

  const parts = credential.split(".");
  if (parts.length !== 3) {
    throw new Error("Google credential không hợp lệ.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Google credential không hợp lệ.");
  }

  const header = decodeJsonPart<{ alg?: string; kid?: string }>(encodedHeader);
  const claims = decodeJsonPart<{
    iss?: string;
    sub?: string;
    aud?: string | string[];
    azp?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    hd?: string;
    nonce?: string;
  }>(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Google credential sử dụng thuật toán không được hỗ trợ.");
  }

  const jwk = (await googleKeys()).find((item) => item.kid === header.kid);
  if (!jwk) {
    cachedUntil = 0;
    const refreshed = await googleKeys();
    const retryKey = refreshed.find((item) => item.kid === header.kid);
    if (!retryKey) {
      throw new Error("Không tìm thấy Google signing key.");
    }
    cachedKeys = refreshed;
  }

  const signingKey = cachedKeys.find((item) => item.kid === header.kid);
  if (
    !signingKey ||
    (signingKey.alg !== undefined && signingKey.alg !== "RS256") ||
    (signingKey.use !== undefined && signingKey.use !== "sig")
  ) {
    throw new Error("Không tìm thấy Google signing key hợp lệ.");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    signingKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(encodedSignature, "base64url"),
    new TextEncoder().encode(encodedHeader + "." + encodedPayload)
  );

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const authorizedPartyValid =
    audience.length <= 1 || claims.azp === clientId;
  const verified =
    validSignature &&
    authorizedPartyValid &&
    (claims.iss === "https://accounts.google.com" ||
      claims.iss === "accounts.google.com") &&
    audience.includes(clientId) &&
    typeof claims.exp === "number" &&
    claims.exp * 1000 > Date.now() &&
    (
      claims.iat === undefined ||
      (typeof claims.iat === "number" && claims.iat * 1000 <= Date.now() + 60_000)
    ) &&
    typeof claims.sub === "string" &&
    claims.sub.length > 0 &&
    claims.sub.length <= 255 &&
    typeof claims.email === "string" &&
    claims.email.length > 0 &&
    claims.email.length <= 320 &&
    (claims.email_verified === true || claims.email_verified === "true") &&
    (
      expectedNonce === undefined ||
      (typeof claims.nonce === "string" && claims.nonce === expectedNonce)
    );

  if (!verified) {
    throw new Error("Google credential không vượt qua bước xác thực.");
  }

  const email = claims.email!.trim().toLowerCase();
  const hostedDomain =
    typeof claims.hd === "string" && claims.hd.trim()
      ? claims.hd.trim().toLowerCase()
      : null;

  return {
    subject: claims.sub!,
    email,
    displayName:
      typeof claims.name === "string" && claims.name.trim()
        ? claims.name.trim()
        : email.split("@")[0] || "Google user",
    hostedDomain,
    authoritativeEmail:
      email.endsWith("@gmail.com") || hostedDomain !== null
  };
}
