const stepUpEvent = "habi:cms-step-up-required";

let pending:
  | {
      promise: Promise<void>;
      resolve: () => void;
      reject: (error: Error) => void;
    }
  | null = null;

export function requestCmsStepUp(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Recent authentication is only available in the browser.")
    );
  }

  if (pending) return pending.promise;

  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  pending = { promise, resolve, reject };
  window.dispatchEvent(new Event(stepUpEvent));
  return promise;
}

export function resolveCmsStepUp(): void {
  const current = pending;
  pending = null;
  current?.resolve();
}

export function rejectCmsStepUp(
  message = "Yêu cầu xác thực lại đã bị hủy."
): void {
  const current = pending;
  pending = null;
  current?.reject(new Error(message));
}

export function subscribeToCmsStepUpRequired(
  listener: () => void
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(stepUpEvent, listener);
  return () => window.removeEventListener(stepUpEvent, listener);
}
