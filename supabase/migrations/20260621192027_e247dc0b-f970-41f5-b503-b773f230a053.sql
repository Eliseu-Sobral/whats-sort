
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

-- Approve all existing users so we don't break the current accounts.
UPDATE public.profiles SET is_approved = true WHERE is_approved = false;

-- Auto-approve any user that has the admin role.
UPDATE public.profiles p
SET is_approved = true
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'admin');

-- Helper function (security definer) used by future RLS / app checks.
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_approved FROM public.profiles WHERE id = _user_id),
    false
  ) OR public.has_role(_user_id, 'admin');
$$;

REVOKE ALL ON FUNCTION public.is_approved(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated, service_role;

-- Keep admins always approved.
CREATE OR REPLACE FUNCTION public.sync_admin_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    UPDATE public.profiles SET is_approved = true WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_admin_approval ON public.user_roles;
CREATE TRIGGER trg_sync_admin_approval
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_admin_approval();
