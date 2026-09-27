"use client";

import { useEffect, useRef, useState } from "react";
import { staffAuthApi } from "../lib/staff-auth-api";

type GoogleCredentialResponse = { credential?: string };

type GoogleAccounts = {
  id: {
    initialize(input: {
      client_id: string;
      nonce: string;
      callback: (response: GoogleCredentialResponse) => void;
    }): void;
    renderButton(
      element: HTMLElement,
      options: {
        type: "standard";
        theme: "outline";
        size: "large";
        shape: "rectangular";
        text: "signin_with";
        width: number;
      }
    ): void;
  };
};

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

export function StaffGoogleIdentityButton({
  clientId,
  disabled,
  onCredential
}: {
  clientId: string;
  disabled?: boolean;
  onCredential: (credential: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId || disabled) return;
    let cancelled = false;
    let script: HTMLScriptElement | null = null;
    let loadListener: (() => void) | null = null;

    const prepare = async () => {
      try {
        setError(null);
        const challenge = await staffAuthApi.googleChallenge();
        if (cancelled) return;

        const render = () => {
          if (cancelled || !ref.current || !window.google?.accounts) return;
          ref.current.innerHTML = "";
          window.google.accounts.id.initialize({
            client_id: clientId,
            nonce: challenge.nonce,
            callback: (response) => {
              if (response.credential) onCredential(response.credential);
            }
          });
          window.google.accounts.id.renderButton(ref.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            shape: "rectangular",
            text: "signin_with",
            width: Math.max(240, Math.min(360, ref.current.clientWidth || 320))
          });
        };

        const existing = document.querySelector<HTMLScriptElement>(
          'script[data-habi-google-identity="true"]'
        );
        if (existing) {
          script = existing;
          if (window.google?.accounts) {
            render();
          } else {
            loadListener = render;
            existing.addEventListener("load", render, { once: true });
          }
          return;
        }

        script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.dataset.habiGoogleIdentity = "true";
        loadListener = render;
        script.addEventListener("load", render, { once: true });
        document.head.appendChild(script);
      } catch {
        if (!cancelled) {
          setError("Không thể khởi tạo đăng nhập Google.");
        }
      }
    };

    void prepare();

    return () => {
      cancelled = true;
      if (script && loadListener) {
        script.removeEventListener("load", loadListener);
      }
    };
  }, [clientId, disabled, onCredential]);

  return (
    <>
      <div ref={ref} aria-disabled={disabled} style={{ minHeight: 44 }} />
      {error ? (
        <div className="staff-state staff-state--error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}
