export class ApiError extends Error {}

export async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? `Request failed (${response.status})`);
  }
  return data as T;
}
