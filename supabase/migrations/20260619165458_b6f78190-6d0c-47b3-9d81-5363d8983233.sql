
CREATE TABLE IF NOT EXISTS public.app_settings (
  id text PRIMARY KEY DEFAULT 'evolution',
  api_url text,
  api_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage app settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (id) VALUES ('evolution') ON CONFLICT DO NOTHING;

-- Make instance api fields optional (global config is used instead)
ALTER TABLE public.whatsapp_instances ALTER COLUMN api_url DROP NOT NULL;
ALTER TABLE public.whatsapp_instances ALTER COLUMN api_key DROP NOT NULL;
