import { createClient } from '@supabase/supabase-js';

// Anon key only — used for auth (signIn/refresh) not direct DB access
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
