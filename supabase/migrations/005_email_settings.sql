-- ============================================================
-- ADD EMAIL ADDRESS TO USER SETTINGS
-- Used for emailing listings to the user for manual Vinted upload.
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS email_address TEXT;

-- Update the safe view to expose the email address (it's not secret)
CREATE OR REPLACE VIEW user_settings_safe AS
SELECT
  user_id,
  openai_model,
  vinted_username,
  email_address,
  (openai_api_key IS NOT NULL AND openai_api_key <> '') AS openai_key_configured,
  updated_at
FROM user_settings;

REVOKE ALL ON user_settings_safe FROM PUBLIC;
GRANT SELECT ON user_settings_safe TO authenticated;