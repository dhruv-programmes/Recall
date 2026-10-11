import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The proxy refreshes the session.
        }
      },
    },
  });
}

export async function requireSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null;
  if (error || !userId) return null;
  return { supabase, userId };
}

export async function accessToken(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function createBackgroundClient(token: string) {
  return createSupabaseClient(supabaseUrl(), supabasePublishableKey(), {
    accessToken: async () => token,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function unauthorized() {
  return Response.json({ error: "Sign in to continue." }, { status: 401 });
}
