-- Fix the auth trigger so signup can NEVER be blocked.
-- Older version of handle_new_user() could error and block account creation.
-- This version:
--   1. Never fails (wrapped in EXCEPTION handler)
--   2. Uses ON CONFLICT DO NOTHING (safe to run repeatedly)
--   3. Sets a safe search_path
-- Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block user creation, even if the profile insert fails
  RETURN NEW;
END;
$$;

-- Recreate the trigger to use the fixed function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Ensure the function can be invoked
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, anon, service_role;