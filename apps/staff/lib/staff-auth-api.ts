import {
  staffApiFetch,
  StaffNetworkError
} from "./staff-api-client";

export type StaffMembership = {
  organizationId: string;
  organizationName: string;
  role: string;
};

export type StaffSession = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  memberships: StaffMembership[];
  expiresAt: string;
};

export class StaffAuthApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "StaffAuthApiError";
  }
}

async function message(response: Response): Promise<string> {
  const raw = await response.text();

  if (!raw) {
    return "Yêu cầu xác thực thất bại.";
  }

  try {
    const payload = JSON.parse(raw) as {
      message?: string | string[];
    };

    if (Array.isArray(payload.message)) {
      return payload.message.join(" ");
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // Keep raw response.
  }

  return raw;
}

async function json<T>(
  path: string,
  options: Parameters<typeof staffApiFetch>[1]
): Promise<T> {
  const response = await staffApiFetch(path, options);

  if (!response.ok) {
    throw new StaffAuthApiError(
      response.status,
      await message(response)
    );
  }

  return response.json() as Promise<T>;
}

export const staffAuthApi = {
  me: () =>
    json<StaffSession>("/auth/me", {
      organization: false,
      csrf: false
    }),

  login: (input: { email: string; password: string }) =>
    json<StaffSession>("/auth/login", {
      method: "POST",
      body: input,
      organization: false,
      csrf: false
    }),

  logout: () =>
    json<{ loggedOut: boolean }>("/auth/logout", {
      method: "POST",
      organization: false
    })
};

export { StaffNetworkError };
