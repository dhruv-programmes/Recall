export function supabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL in .env, then restart the app.");
  }
  return url;
}

export function supabasePublishableKey() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env, then restart the app.",
    );
  }
  return key;
}
