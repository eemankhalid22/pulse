export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export const WS_URL = API_URL.replace(/^http/, "ws");

const TOKEN_KEY = "pulse_token";

export const getToken = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);

export const setToken = (t: string | null) => {
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMessage(data: any, fallback: string) {
  if (!data) return fallback;
  if (typeof data.error === "string") return data.error;
  const issue = data.error?.issues?.[0];
  if (issue) return `${issue.path?.join(".") || "input"}: ${issue.message}`;
  if (typeof data.error?.message === "string") return data.error.message;
  return fallback;
}

export async function api<T = unknown>(
  path: string,
  init: Omit<RequestInit, "body"> & { json?: unknown } = {},
): Promise<T> {
  const { json, headers: extra, ...rest } = init;
  const headers: Record<string, string> = {
    ...(extra as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (
      res.status === 401 &&
      !path.startsWith("/auth/login") &&
      typeof window !== "undefined"
    ) {
      setToken(null);
      if (window.location.pathname !== "/login")
        window.location.href = "/login";
    }
    throw new ApiError(res.status, extractMessage(data, res.statusText));
  }
  return data as T;
}
