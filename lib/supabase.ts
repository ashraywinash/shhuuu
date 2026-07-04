import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

let client: SupabaseClient | null = null;

export function getSupabase() {
  if (!url || !publishableKey) throw new Error("Supabase is not configured. Add the public URL and anon key to .env.local.");
  client ??= createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}

export async function assertPseudonymAuthReady() {
  if (!url || !publishableKey) throw new Error("Supabase is not configured. Add the public URL and anon key to .env.local.");
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } });
  } catch {
    throw new Error("shhuuu could not reach Supabase. Check your connection and try again.");
  }
  if (!response.ok) throw new Error("shhuuu could not verify the Supabase Auth configuration.");
  const settings = await response.json() as { external?: { email?: boolean }; mailer_autoconfirm?: boolean };
  if (!settings.external?.email) throw new Error("Enable the Email provider in Supabase Auth before creating pseudonym accounts.");
  if (!settings.mailer_autoconfirm) {
    throw new Error("Turn off Confirm email in Supabase Auth before creating accounts. shhuuu uses private pseudonyms without email inboxes.");
  }
}
