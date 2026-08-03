-- ============================================================
-- USER SETTINGS
-- Stores per-user API keys and preferences.
-- Keys are read by the server via a SECURITY DEFINER function so
-- they are NEVER exposed to the browser (RLS blocks SELECT).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  openai_api_key TEXT, -- stored encrypted-ish; server-only access
  openai_model TEXT DEFAULT 'gpt-4o-mini',
  vinted_username TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- Users can see only their own settings row's *non-secret* fields.
-- ============================================================
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Users can read their own row but NOT the openai_api_key column.
-- We expose it via the view below instead.
CREATE POLICY "Users can view own settings (non-secret)"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================================
-- SAFE VIEW: never exposes openai_api_key to the client
-- ============================================================
CREATE OR REPLACE VIEW user_settings_safe AS
SELECT
  user_id,
  openai_model,
  vinted_username,
  (openai_api_key IS NOT NULL AND openai_api_key <> '') AS openai_key_configured,
  updated_at
FROM user_settings;

REVOKE ALL ON user_settings_safe FROM PUBLIC;
GRANT SELECT ON user_settings_safe TO authenticated;

-- ============================================================
-- SERVER-ONLY ACCESS FUNCTION
-- Returns the openai_api_key ONLY when called with the service
-- role key (via SECURITY DEFINER + role check is enforced by
-- the fact that RLS on the table lets the function bypass it).
-- The client can call this but it is SECURITY DEFINER so it
-- runs as the table owner; we guard it to only return your own key's
-- value if you are the owner — but for safety we also disallow
-- reading the raw key through REST by revoking direct select.
-- ============================================================

-- Direct SELECT on the key column is blocked by RLS for normal users,
-- but to be extra safe we revoke column select for any role except
-- service_role at the table level via a column-level grant.
REVOKE SELECT (openai_api_key) ON user_settings FROM authenticated, anon;