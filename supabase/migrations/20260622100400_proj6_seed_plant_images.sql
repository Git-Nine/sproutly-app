-- PROJ-6: backfill plant images (Wikimedia Commons thumbnails) onto the seeded
-- catalogue. Sourced via the Wikipedia REST API per species; all are
-- upload.wikimedia.org URLs (mostly CC / public-domain Köhler illustrations) and
-- satisfy plants_image_url_http_check. The seed script's ON CONFLICT DO NOTHING
-- can't update existing rows, so this one-off data migration does it.
--
-- Guarded by `image_url is null` → idempotent and never clobbers a later admin edit.
-- Two species are intentionally left imageless (graceful placeholder in the UI):
-- Euonymus europaeus (the live Wikipedia lead image is currently wrong/vandalised)
-- and Calamagrostis x acutiflora (no usable hybrid-cultivar page image).
-- Nepeta x faassenii uses a Nepeta racemosa photo (same catmint; close stand-in).

update public.plants as p
set image_url = v.url
from (values
  ('Salvia nemorosa', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Salvia_nemorosa_sl37.jpg/330px-Salvia_nemorosa_sl37.jpg'),
  ('Achillea millefolium', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Achillea_millefiolium_sp3.JPG/330px-Achillea_millefiolium_sp3.JPG'),
  ('Geranium sanguineum', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Geranium_sanguineum004.jpg/330px-Geranium_sanguineum004.jpg'),
  ('Hylotelephium telephium', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Sedum_telephium_ssp_maximum_1.jpg/330px-Sedum_telephium_ssp_maximum_1.jpg'),
  ('Digitalis purpurea', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Digitalis_purpurea_01.jpg/330px-Digitalis_purpurea_01.jpg'),
  ('Lavandula angustifolia', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Lavandula_angustifolia_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-087.jpg/330px-Lavandula_angustifolia_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-087.jpg'),
  ('Echinacea purpurea', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Echinacea_purpurea_001.JPG/330px-Echinacea_purpurea_001.JPG'),
  ('Nepeta x faassenii', 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Nepeta_racemosa_sl16.jpg/330px-Nepeta_racemosa_sl16.jpg'),
  ('Rudbeckia fulgida', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/RudbeckiaFulgida.jpg/330px-RudbeckiaFulgida.jpg'),
  ('Hosta sieboldiana', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Hosta_sieboldiana_Elegans2UME.jpg/330px-Hosta_sieboldiana_Elegans2UME.jpg'),
  ('Helleborus niger', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Illustration_Helleborus_niger0.jpg/330px-Illustration_Helleborus_niger0.jpg'),
  ('Anemone hupehensis', 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/2007-05-08Anemone_hupehensis01.jpg/330px-2007-05-08Anemone_hupehensis01.jpg'),
  ('Verbena bonariensis', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Verbena_bonariensis.jpg/330px-Verbena_bonariensis.jpg'),
  ('Sambucus nigra', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Sambucus_nigra_004.jpg/330px-Sambucus_nigra_004.jpg'),
  ('Crataegus monogyna', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Crataegus_monogyna_-_Common_hawthorn.jpg/330px-Crataegus_monogyna_-_Common_hawthorn.jpg'),
  ('Corylus avellana', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Illustration_Corylus_avellana0.jpg/330px-Illustration_Corylus_avellana0.jpg'),
  ('Cornus sanguinea', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Cornus_sanguinea_PID1300-3.jpg/330px-Cornus_sanguinea_PID1300-3.jpg'),
  ('Viburnum opulus', 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Illustration_Viburnum_opulus0.jpg/330px-Illustration_Viburnum_opulus0.jpg'),
  ('Prunus spinosa', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Schlehdorn_%28Prunus_spinosa%29_Nationalpark_Donau-Auen_Orth_an_der_Donau_2012_c.jpg/330px-Schlehdorn_%28Prunus_spinosa%29_Nationalpark_Donau-Auen_Orth_an_der_Donau_2012_c.jpg'),
  ('Sorbus aucuparia', 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Sorbus_aucuparia_on_Y_Garn.jpg/330px-Sorbus_aucuparia_on_Y_Garn.jpg'),
  ('Acer campestre', 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Acer_campestre_Weinsberg_20070419_1.jpg/330px-Acer_campestre_Weinsberg_20070419_1.jpg'),
  ('Carpinus betulus', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Illustration_Carpinus_betulus_1.jpg/330px-Illustration_Carpinus_betulus_1.jpg'),
  ('Prunus avium', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/CILIEGIO_SECOLARE_A_BESANA_IN_BRIANZA.JPG/330px-CILIEGIO_SECOLARE_A_BESANA_IN_BRIANZA.JPG'),
  ('Salix caprea', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Salix_caprea_036.jpg/330px-Salix_caprea_036.jpg'),
  ('Tilia cordata', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Tilia_cordata_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-139.jpg/330px-Tilia_cordata_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-139.jpg'),
  ('Salvia pratensis', 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Salvia_pratensis_LC0340.jpg/330px-Salvia_pratensis_LC0340.jpg'),
  ('Ajuga reptans', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Ajuga_reptans_LC0138.jpg/330px-Ajuga_reptans_LC0138.jpg'),
  ('Prunella vulgaris', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Prunella_vulgaris_-_harilik_k%C3%A4bihein.jpg/330px-Prunella_vulgaris_-_harilik_k%C3%A4bihein.jpg'),
  ('Leucanthemum vulgare', 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Illustration_Chrysanthemum_leucanthemum0.jpg/330px-Illustration_Chrysanthemum_leucanthemum0.jpg'),
  ('Knautia arvensis', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Knautia_arvensis_inflorescence_%28top_view%29_-_Keila.jpg/330px-Knautia_arvensis_inflorescence_%28top_view%29_-_Keila.jpg'),
  ('Origanum vulgare', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/ORIGANUM_VULGARE_-_SANT_JUST_-_IB-230_%28Orenga%29.JPG/330px-ORIGANUM_VULGARE_-_SANT_JUST_-_IB-230_%28Orenga%29.JPG'),
  ('Hypericum perforatum', 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Hypericum_perforatum_Dziurawiec_zwyczajny_2020-07-12_02.jpg/330px-Hypericum_perforatum_Dziurawiec_zwyczajny_2020-07-12_02.jpg'),
  ('Campanula persicifolia', 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Campanula_persicifolia_0002.JPG/330px-Campanula_persicifolia_0002.JPG'),
  ('Centaurea jacea', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Centaurea_jacea_01.JPG/330px-Centaurea_jacea_01.JPG'),
  ('Cornus mas', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Illustration_Cornus_mas0.jpg/330px-Illustration_Cornus_mas0.jpg'),
  ('Rosa canina', 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Rosa_canina_6.JPG/330px-Rosa_canina_6.JPG'),
  ('Acer platanoides', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Spitz-Ahorn_%28Acer_platanoides%29_1.jpg/330px-Spitz-Ahorn_%28Acer_platanoides%29_1.jpg'),
  ('Betula pendula', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Chmielno_brzoza.jpg/330px-Chmielno_brzoza.jpg')
) as v(latin_name, url)
where p.latin_name = v.latin_name and p.image_url is null;
