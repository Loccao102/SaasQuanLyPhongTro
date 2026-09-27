"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser";

export type PasskeyRegistrationOptionsJSON =
  Parameters<typeof startRegistration>[0]["optionsJSON"];

export type PasskeyAuthenticationOptionsJSON =
  Parameters<typeof startAuthentication>[0]["optionsJSON"];

export function browserSupportsPasskeys(): boolean {
  return browserSupportsWebAuthn();
}

export async function createPasskey(
  optionsJSON: PasskeyRegistrationOptionsJSON
) {
  if (!browserSupportsWebAuthn()) {
    throw new Error(
      "Trình duyệt hoặc thiết bị này chưa hỗ trợ WebAuthn/passkey."
    );
  }
  return startRegistration({ optionsJSON });
}

export async function authenticateWithPasskey(
  optionsJSON: PasskeyAuthenticationOptionsJSON
) {
  if (!browserSupportsWebAuthn()) {
    throw new Error(
      "Trình duyệt hoặc thiết bị này chưa hỗ trợ WebAuthn/passkey."
    );
  }
  return startAuthentication({ optionsJSON });
}
