-- PROJ-4 fix (2026-07-12): the hardiness zone was derived from the WRONG measure.
--
-- The pipeline sampled DWD grid file 17 (ANNUAL mean of daily minimum temps,
-- ~+5 °C for most of Germany — summer nights included) and fed it into a zone
-- table built for the mean absolute annual minimum (~-12 to -18 °C). Result:
-- every German site derived zone 10 marked "confirmed", which made the PROJ-6
-- winter hard filter pass every plant — effectively disabled.
--
-- Code fix (same deploy): sample the JANUARY grid (file 01, mean daily minimum
-- of the coldest month) and use thresholds calibrated against the published
-- German Winterhärtezonen map (15/15 reference cities correct).
--
-- This migration does two things:
--
-- 1. Rename annual_min_temp → jan_mean_min_temp: the column now stores the
--    January mean daily minimum. Honest naming — a value whose name lies about
--    what it measures is exactly the bug class being fixed here.
--
-- 2. Reset the poisoned data: every stored zone was derived from the wrong
--    measure, so zones and the old temperature value are cleared back to the
--    honest "not yet determined" state. The next enrichment run fills in the
--    correct values; plans compare their snapshot_zone against the scan's
--    current zone, so affected plans flag themselves stale through the existing
--    "conditions changed" flow. Overall status drops from 'complete' to
--    'partial' so the enrichment retry path stays reachable.

alter table public.scan_enrichment
  rename column annual_min_temp to jan_mean_min_temp;

comment on column public.scan_enrichment.jan_mean_min_temp is
  'DWD 1991-2020 January mean of daily minimum temperature (°C) at the scan location. '
  'Proxy for winter severity; hardiness_zone is derived from it. '
  'Renamed from annual_min_temp 2026-07-12 — the old column held the annual mean of '
  'daily minima (wrong measure for hardiness, see PROJ-4 spec).';

update public.scan_enrichment
set
  jan_mean_min_temp = null,
  hardiness_zone    = null,
  zone_status       = 'unavailable',
  status            = case when status = 'complete' then 'partial' else status end
where zone_status = 'success' or jan_mean_min_temp is not null;
