import { API_URL } from "@/lib/api";

/**
 * Public data (quotes, cities, date places) read while the page is made on the server.
 * Inside Docker it asks the API directly (API_INTERNAL_URL); answers are kept for an hour,
 * since they only change when we edit the lists.
 */
export async function serverGet<T>(path: string): Promise<T | null> {
  const base = process.env.API_INTERNAL_URL ?? API_URL;
  try {
    const response = await fetch(`${base}${path}`, { next: { revalidate: 3600 } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
