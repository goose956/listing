import { supabase } from './supabase';

export interface UserSettingsSafe {
  user_id: string;
  openai_model: string | null;
  vinted_username: string | null;
  openai_key_configured: boolean;
  updated_at: string;
}

/** Fetch the user's settings (never includes the raw API key). */
export async function fetchSettings(): Promise<UserSettingsSafe | null> {
  const { data, error } = await supabase
    .from('user_settings_safe')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as UserSettingsSafe | null;
}

/** Upsert settings. Pass apiKey only when the user is setting a new one. */
export async function saveSettings(input: {
  openaiApiKey?: string;
  openaiModel?: string;
  vintedUsername?: string;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const payload: Record<string, unknown> = {
    openai_model: input.openaiModel || 'gpt-4o-mini',
    vinted_username: input.vintedUsername || null,
  };
  if (input.openaiApiKey) {
    payload.openai_api_key = input.openaiApiKey.trim();
  }

  const { error } = await supabase.from('user_settings').upsert({
    user_id: user.id,
    ...payload,
  });
  if (error) throw error;
}

/** Remove the stored OpenAI key. */
export async function clearOpenAIKey(): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .update({ openai_api_key: null })
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id || '');
  if (error) throw error;
}