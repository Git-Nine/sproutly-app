-- PROJ-3: Photo Upload & Space Scan — make the photo optional.
-- A user can now create a scan by answering the conditions questions alone, without
-- uploading an image (lowers the friction for the "Guilty Non-Starter" persona). The
-- manual fields (postcode, sun, surface, space type, area) stay required — they power
-- PROJ-4 enrichment and PROJ-6 plan generation. Only the photo becomes optional.
--
-- Drops the NOT NULL on photo_path. No RLS / policy / storage change: a null photo_path
-- simply means no object exists at {user_id}/scans/{scan_id}/photo, which the app, the
-- list thumbnail, and the detail view already render with a neutral placeholder.

alter table public.scans
  alter column photo_path drop not null;

comment on column public.scans.photo_path is
  'PROJ-3: storage path of the scan photo in the private `photos` bucket, or NULL when the user created the scan without a photo. The id stays the PK for all internal references.';
