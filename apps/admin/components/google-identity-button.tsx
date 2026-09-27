"use client";

import { useEffect, useRef } from "react";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleAccounts = {
  id: {
    initialize(input: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
    }): void;
    renderButton(
      element: HTMLElement,
      options: {
        type: "standard";
        theme: "outline";
        size: "large";
        shape: "rectangular";
        text: "signin_with" | "signup_with";
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

export function GoogleIdentityButton({
  clientId,
  mode,
  disabled,
  onCredential
}: {
  clientId: string;
  mode: "LOGIN" | "REGISTER";
  disabled?: boolean;
  onCredential: (credential: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId || disabled) return;

    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.google?.accounts) return;
      ref.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) onCredential(response.credential);
        }
      });
      window.google.accounts.id.renderButton(ref.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: mode === "REGISTER" ? "signup_with" : "signin_with",
        width: Math.max(240, Math.min(360, ref.current.clientWidth || 320))
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-habi-google-identity="true"]'
    );
    if (existing) {
      if (window.google?.accounts) render();
      else existing.addEventListener("load", render, { once: true });
      return () => {
        cancelled = true;
        existing.removeEventListener("load", render);
      };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.habiGoogleIdentity = "true";
    script.addEventListener("load", render, { once: true });
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener("load", render);
    };
  }, [clientId, disabled, mode, onCredential]);

  return (
    <div
      ref={ref}
      aria-disabled={disabled}
      style={{
        width: "100%",
        minHeight: 44,
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? "none" : "auto"
      }}
    />
  );
}
