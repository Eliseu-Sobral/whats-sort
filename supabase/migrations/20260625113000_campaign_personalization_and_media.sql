ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS campaign_greetings text,
  ADD COLUMN IF NOT EXISTS campaign_name_fallbacks text,
  ADD COLUMN IF NOT EXISTS campaign_message_variants text;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS media_kind text,
  ADD COLUMN IF NOT EXISTS media_mime_type text,
  ADD COLUMN IF NOT EXISTS media_file_name text;
