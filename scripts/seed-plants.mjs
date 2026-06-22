// PROJ-5: one-time seed of German-relevant plants into public.plants.
//
//   npm run seed:plants
//
// Idempotent: upserts on the unique latin_name with ignoreDuplicates → ON CONFLICT
// DO NOTHING. Re-running never creates duplicates and never overwrites a row an
// admin has since edited (spec edge case). Uses the service-role key, which bypasses
// RLS — so it must run server-side only, never in the browser.
//
// Env (loaded via `node --env-file=.env.local`): NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
//
// The data is a small cleaned reference set, NOT a live FloraWeb/BfN sync (a v1
// non-goal). Curators extend/correct it through /admin/plants afterwards.

import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

/**
 * Initial catalogue. Each row carries every required attribute so the rule engine
 * (PROJ-6) can match it from day one. Vocabularies mirror the app contract
 * (src/lib/plants.ts): sun ∈ full/partial/shade, soil ∈ sand/loam/clay/silt/peat,
 * maintenance ∈ low/medium/high, plant_type ∈ groundcover/perennial/shrub/tree,
 * hardiness zone = whole number, sizes in cm.
 *
 * Layer coverage: 19 perennials, 3 groundcovers, 10 shrubs, 8 trees (40 total) —
 * enough for PROJ-6's layered (60/30/10) plans to draw a real tree/shrub/perennial
 * structure across sun, soil and hardiness ranges.
 *
 * Provenance: the original starter rows + the first native tree/shrub batch use
 * standard horticultural values. The final batch (marked below) is sourced from
 * NaturaDB (naturadb.de) — German common name, mature size, light, hardiness zone
 * (Klimazone) and native status (heimisch) taken from the species pages; soil
 * descriptors mapped onto our five buckets (sand/loam/clay/silt/peat); spread
 * estimated only where NaturaDB gave a growth habit rather than a width; and
 * maintenance_level derived (NaturaDB does not express it — wild natives default
 * to 'low'). Native status cross-checks with FloraWeb (BfN). Curators extend/correct
 * via /admin/plants; the exact source dataset + licensing for redistribution
 * remains an open question (see the spec).
 *
 * Images: Wikimedia Commons thumbnails (via the Wikipedia REST API), attached to
 * PLANTS below by Latin name. Mostly CC / public-domain (Köhler) — they satisfy the
 * http(s) image_url check. Two species have no usable image (placeholder in the UI).
 * Mirrors migration 20260622100400_proj6_seed_plant_images.sql for existing rows.
 */
const PLANT_IMAGES = {
  'Salvia nemorosa': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Salvia_nemorosa_sl37.jpg/330px-Salvia_nemorosa_sl37.jpg',
  'Achillea millefolium': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Achillea_millefiolium_sp3.JPG/330px-Achillea_millefiolium_sp3.JPG',
  'Geranium sanguineum': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Geranium_sanguineum004.jpg/330px-Geranium_sanguineum004.jpg',
  'Hylotelephium telephium': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Sedum_telephium_ssp_maximum_1.jpg/330px-Sedum_telephium_ssp_maximum_1.jpg',
  'Digitalis purpurea': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Digitalis_purpurea_01.jpg/330px-Digitalis_purpurea_01.jpg',
  'Lavandula angustifolia': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Lavandula_angustifolia_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-087.jpg/330px-Lavandula_angustifolia_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-087.jpg',
  'Echinacea purpurea': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Echinacea_purpurea_001.JPG/330px-Echinacea_purpurea_001.JPG',
  'Nepeta x faassenii': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Nepeta_racemosa_sl16.jpg/330px-Nepeta_racemosa_sl16.jpg',
  'Rudbeckia fulgida': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/RudbeckiaFulgida.jpg/330px-RudbeckiaFulgida.jpg',
  'Hosta sieboldiana': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Hosta_sieboldiana_Elegans2UME.jpg/330px-Hosta_sieboldiana_Elegans2UME.jpg',
  'Helleborus niger': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Illustration_Helleborus_niger0.jpg/330px-Illustration_Helleborus_niger0.jpg',
  'Anemone hupehensis': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/2007-05-08Anemone_hupehensis01.jpg/330px-2007-05-08Anemone_hupehensis01.jpg',
  'Verbena bonariensis': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Verbena_bonariensis.jpg/330px-Verbena_bonariensis.jpg',
  'Sambucus nigra': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Sambucus_nigra_004.jpg/330px-Sambucus_nigra_004.jpg',
  'Crataegus monogyna': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Crataegus_monogyna_-_Common_hawthorn.jpg/330px-Crataegus_monogyna_-_Common_hawthorn.jpg',
  'Corylus avellana': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Illustration_Corylus_avellana0.jpg/330px-Illustration_Corylus_avellana0.jpg',
  'Cornus sanguinea': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Cornus_sanguinea_PID1300-3.jpg/330px-Cornus_sanguinea_PID1300-3.jpg',
  'Viburnum opulus': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Illustration_Viburnum_opulus0.jpg/330px-Illustration_Viburnum_opulus0.jpg',
  'Prunus spinosa': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Schlehdorn_%28Prunus_spinosa%29_Nationalpark_Donau-Auen_Orth_an_der_Donau_2012_c.jpg/330px-Schlehdorn_%28Prunus_spinosa%29_Nationalpark_Donau-Auen_Orth_an_der_Donau_2012_c.jpg',
  'Sorbus aucuparia': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Sorbus_aucuparia_on_Y_Garn.jpg/330px-Sorbus_aucuparia_on_Y_Garn.jpg',
  'Acer campestre': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Acer_campestre_Weinsberg_20070419_1.jpg/330px-Acer_campestre_Weinsberg_20070419_1.jpg',
  'Carpinus betulus': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Illustration_Carpinus_betulus_1.jpg/330px-Illustration_Carpinus_betulus_1.jpg',
  'Prunus avium': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/CILIEGIO_SECOLARE_A_BESANA_IN_BRIANZA.JPG/330px-CILIEGIO_SECOLARE_A_BESANA_IN_BRIANZA.JPG',
  'Salix caprea': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Salix_caprea_036.jpg/330px-Salix_caprea_036.jpg',
  'Tilia cordata': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Tilia_cordata_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-139.jpg/330px-Tilia_cordata_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-139.jpg',
  'Salvia pratensis': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Salvia_pratensis_LC0340.jpg/330px-Salvia_pratensis_LC0340.jpg',
  'Ajuga reptans': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Ajuga_reptans_LC0138.jpg/330px-Ajuga_reptans_LC0138.jpg',
  'Prunella vulgaris': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Prunella_vulgaris_-_harilik_k%C3%A4bihein.jpg/330px-Prunella_vulgaris_-_harilik_k%C3%A4bihein.jpg',
  'Leucanthemum vulgare': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Illustration_Chrysanthemum_leucanthemum0.jpg/330px-Illustration_Chrysanthemum_leucanthemum0.jpg',
  'Knautia arvensis': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Knautia_arvensis_inflorescence_%28top_view%29_-_Keila.jpg/330px-Knautia_arvensis_inflorescence_%28top_view%29_-_Keila.jpg',
  'Origanum vulgare': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/ORIGANUM_VULGARE_-_SANT_JUST_-_IB-230_%28Orenga%29.JPG/330px-ORIGANUM_VULGARE_-_SANT_JUST_-_IB-230_%28Orenga%29.JPG',
  'Hypericum perforatum': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Hypericum_perforatum_Dziurawiec_zwyczajny_2020-07-12_02.jpg/330px-Hypericum_perforatum_Dziurawiec_zwyczajny_2020-07-12_02.jpg',
  'Campanula persicifolia': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Campanula_persicifolia_0002.JPG/330px-Campanula_persicifolia_0002.JPG',
  'Centaurea jacea': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Centaurea_jacea_01.JPG/330px-Centaurea_jacea_01.JPG',
  'Cornus mas': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Illustration_Cornus_mas0.jpg/330px-Illustration_Cornus_mas0.jpg',
  'Rosa canina': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Rosa_canina_6.JPG/330px-Rosa_canina_6.JPG',
  'Acer platanoides': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Spitz-Ahorn_%28Acer_platanoides%29_1.jpg/330px-Spitz-Ahorn_%28Acer_platanoides%29_1.jpg',
  'Betula pendula': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Chmielno_brzoza.jpg/330px-Chmielno_brzoza.jpg',
}

const PLANTS_RAW = [
  {
    common_name: 'Steppen-Salbei',
    latin_name: 'Salvia nemorosa',
    sun_tolerance: ['full'],
    soil_compatibility: ['sand', 'loam', 'clay'],
    min_hardiness_zone: 5,
    mature_height_cm: 50,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Shear back after the first flush for a second bloom. Loves dry, sunny spots.',
  },
  {
    common_name: 'Gewöhnliche Schafgarbe',
    latin_name: 'Achillea millefolium',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['sand', 'loam', 'clay'],
    min_hardiness_zone: 3,
    mature_height_cm: 60,
    mature_spread_cm: 45,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Tough, drought-tolerant pollinator magnet. Thrives on poor soils.',
  },
  {
    common_name: 'Blutroter Storchschnabel',
    latin_name: 'Geranium sanguineum',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 4,
    mature_height_cm: 30,
    mature_spread_cm: 45,
    maintenance_level: 'low',
    plant_type: 'groundcover',
    native: true,
    care_notes: 'Reliable weed-suppressing groundcover with long magenta flowering.',
  },
  {
    common_name: 'Hohe Fetthenne',
    latin_name: 'Hylotelephium telephium',
    sun_tolerance: ['full'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 4,
    mature_height_cm: 50,
    mature_spread_cm: 45,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Late-season nectar source; leave seed heads for winter structure.',
  },
  {
    common_name: 'Roter Fingerhut',
    latin_name: 'Digitalis purpurea',
    sun_tolerance: ['partial', 'shade'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 4,
    mature_height_cm: 120,
    mature_spread_cm: 45,
    maintenance_level: 'medium',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Biennial; self-seeds readily. All parts toxic if eaten.',
  },
  {
    common_name: 'Echter Lavendel',
    latin_name: 'Lavandula angustifolia',
    sun_tolerance: ['full'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 6,
    mature_height_cm: 60,
    mature_spread_cm: 60,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: false,
    care_notes: 'Needs sharp drainage. Prune lightly after flowering, never into old wood.',
  },
  {
    common_name: 'Purpur-Sonnenhut',
    latin_name: 'Echinacea purpurea',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 5,
    mature_height_cm: 90,
    mature_spread_cm: 45,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: false,
    care_notes: 'Long-flowering prairie perennial; seed heads feed finches in winter.',
  },
  {
    common_name: 'Katzenminze',
    latin_name: 'Nepeta x faassenii',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 4,
    mature_height_cm: 45,
    mature_spread_cm: 45,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: false,
    care_notes: 'Drought-tolerant, very long bloom; shear mid-summer to refresh.',
  },
  {
    common_name: 'Garten-Sonnenhut',
    latin_name: 'Rudbeckia fulgida',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'clay'],
    min_hardiness_zone: 4,
    mature_height_cm: 60,
    mature_spread_cm: 45,
    maintenance_level: 'medium',
    plant_type: 'perennial',
    native: false,
    care_notes: 'Golden late-summer daisies; tolerates heavier soils than most.',
  },
  {
    common_name: 'Blaublatt-Funkie',
    latin_name: 'Hosta sieboldiana',
    sun_tolerance: ['partial', 'shade'],
    soil_compatibility: ['loam', 'clay'],
    min_hardiness_zone: 3,
    mature_height_cm: 60,
    mature_spread_cm: 90,
    maintenance_level: 'medium',
    plant_type: 'perennial',
    native: false,
    care_notes: 'Bold shade foliage; watch for slugs on fresh spring growth.',
  },
  {
    common_name: 'Christrose',
    latin_name: 'Helleborus niger',
    sun_tolerance: ['partial', 'shade'],
    soil_compatibility: ['loam', 'clay'],
    min_hardiness_zone: 4,
    mature_height_cm: 30,
    mature_spread_cm: 30,
    maintenance_level: 'medium',
    plant_type: 'perennial',
    native: false,
    care_notes: 'Winter-flowering; prefers moist, humus-rich soil in dappled shade.',
  },
  {
    common_name: 'Garten-Reitgras',
    latin_name: 'Calamagrostis x acutiflora',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['sand', 'loam', 'clay'],
    min_hardiness_zone: 5,
    mature_height_cm: 150,
    mature_spread_cm: 60,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: false,
    care_notes: 'Upright structural grass; cut back to the base in late winter.',
  },
  {
    common_name: 'Herbst-Anemone',
    latin_name: 'Anemone hupehensis',
    sun_tolerance: ['partial', 'shade'],
    soil_compatibility: ['loam'],
    min_hardiness_zone: 5,
    mature_height_cm: 90,
    mature_spread_cm: 45,
    maintenance_level: 'medium',
    plant_type: 'perennial',
    native: false,
    care_notes: 'Elegant autumn flowers; spreads steadily once established.',
  },
  {
    common_name: 'Patagonisches Eisenkraut',
    latin_name: 'Verbena bonariensis',
    sun_tolerance: ['full'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 7,
    mature_height_cm: 120,
    mature_spread_cm: 45,
    maintenance_level: 'medium',
    plant_type: 'perennial',
    native: false,
    care_notes: 'See-through airy stems; marginally hardy — mulch the crown in winter.',
  },

  // ---- Native shrubs (German natives — FloraWeb status; NaturaDB-style attributes) ----
  {
    common_name: 'Schwarzer Holunder',
    latin_name: 'Sambucus nigra',
    sun_tolerance: ['full', 'partial', 'shade'],
    soil_compatibility: ['loam', 'clay', 'sand'],
    min_hardiness_zone: 4,
    mature_height_cm: 400,
    mature_spread_cm: 350,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Elderflowers for pollinators, berries for birds. Very vigorous — cut back hard to keep in bounds.',
  },
  {
    common_name: 'Eingriffeliger Weißdorn',
    latin_name: 'Crataegus monogyna',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'clay', 'sand'],
    min_hardiness_zone: 5,
    mature_height_cm: 500,
    mature_spread_cm: 400,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Thorny top-tier wildlife hedge: blossom for insects, haws for birds. Clips well.',
  },
  {
    common_name: 'Gewöhnliche Hasel',
    latin_name: 'Corylus avellana',
    sun_tolerance: ['full', 'partial', 'shade'],
    soil_compatibility: ['loam', 'clay', 'sand'],
    min_hardiness_zone: 4,
    mature_height_cm: 400,
    mature_spread_cm: 350,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Early catkins feed bees; edible nuts; coppices readily to control size.',
  },
  {
    common_name: 'Roter Hartriegel',
    latin_name: 'Cornus sanguinea',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'clay'],
    min_hardiness_zone: 4,
    mature_height_cm: 300,
    mature_spread_cm: 250,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Red winter stems; unfussy on most soils. Suckers — give it room or prune out runners.',
  },
  {
    common_name: 'Gewöhnlicher Schneeball',
    latin_name: 'Viburnum opulus',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'clay'],
    min_hardiness_zone: 3,
    mature_height_cm: 350,
    mature_spread_cm: 300,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'White lacecap flowers then red berries; happy on damp, heavy soils.',
  },
  {
    common_name: 'Schlehe',
    latin_name: 'Prunus spinosa',
    sun_tolerance: ['full'],
    soil_compatibility: ['loam', 'clay', 'sand'],
    min_hardiness_zone: 4,
    mature_height_cm: 300,
    mature_spread_cm: 300,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Early blossom, sloes for wildlife. Thorny and suckering — a true wild hedge.',
  },

  // ---- Native trees (sizes are open-grown garden estimates) ----
  {
    common_name: 'Eberesche',
    latin_name: 'Sorbus aucuparia',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'sand', 'clay'],
    min_hardiness_zone: 3,
    mature_height_cm: 1000,
    mature_spread_cm: 600,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'Compact native tree for smaller gardens; spring blossom, red berries loved by birds.',
  },
  {
    common_name: 'Feldahorn',
    latin_name: 'Acer campestre',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'clay', 'sand'],
    min_hardiness_zone: 4,
    mature_height_cm: 1200,
    mature_spread_cm: 800,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'Tough small-to-medium native maple; fine specimen or clipped hedge.',
  },
  {
    common_name: 'Hainbuche',
    latin_name: 'Carpinus betulus',
    sun_tolerance: ['full', 'partial', 'shade'],
    soil_compatibility: ['loam', 'clay'],
    min_hardiness_zone: 4,
    mature_height_cm: 1500,
    mature_spread_cm: 1000,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'Holds russet leaves through winter; superb clipped hedge or shade tree.',
  },
  {
    common_name: 'Vogel-Kirsche',
    latin_name: 'Prunus avium',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 4,
    mature_height_cm: 1500,
    mature_spread_cm: 800,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'Spring blossom for pollinators, cherries for birds; fast-growing native.',
  },
  {
    common_name: 'Sal-Weide',
    latin_name: 'Salix caprea',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'clay', 'silt'],
    min_hardiness_zone: 4,
    mature_height_cm: 800,
    mature_spread_cm: 500,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'One of the earliest pollen sources for bees; tolerates damp ground.',
  },
  {
    common_name: 'Winter-Linde',
    latin_name: 'Tilia cordata',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'clay', 'sand'],
    min_hardiness_zone: 3,
    mature_height_cm: 2000,
    mature_spread_cm: 1200,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'Large shade tree; fragrant midsummer flowers alive with bees. For big spaces only.',
  },

  // ---- Sourced from NaturaDB (naturadb.de); native status per NaturaDB/FloraWeb ----
  {
    common_name: 'Wiesen-Salbei',
    latin_name: 'Salvia pratensis',
    sun_tolerance: ['full'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 3,
    mature_height_cm: 60,
    mature_spread_cm: 30,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Native meadow sage; nectar-rich for bees and bumblebees. Loves sunny, calcareous spots.',
  },
  {
    common_name: 'Kriechender Günsel',
    latin_name: 'Ajuga reptans',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 6,
    mature_height_cm: 30,
    mature_spread_cm: 25,
    maintenance_level: 'low',
    plant_type: 'groundcover',
    native: true,
    care_notes: 'Spreads by runners into weed-suppressing mats; blue spring spikes. Good under shrubs.',
  },
  {
    common_name: 'Kleine Braunelle',
    latin_name: 'Prunella vulgaris',
    sun_tolerance: ['full'],
    soil_compatibility: ['loam'],
    min_hardiness_zone: 3,
    mature_height_cm: 25,
    mature_spread_cm: 60,
    maintenance_level: 'low',
    plant_type: 'groundcover',
    native: true,
    care_notes: 'Tough carpet-former that takes light footfall; violet flowers, very easy native groundcover.',
  },
  {
    common_name: 'Wiesen-Margerite',
    latin_name: 'Leucanthemum vulgare',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 3,
    mature_height_cm: 60,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Classic ox-eye daisy; long flowering, unfussy on fresh-to-dry soils.',
  },
  {
    common_name: 'Wiesen-Witwenblume',
    latin_name: 'Knautia arvensis',
    sun_tolerance: ['full'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 6,
    mature_height_cm: 80,
    mature_spread_cm: 50,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Pollen- and nectar-rich; a magnet for wild bees and butterflies. Prefers lean soils.',
  },
  {
    common_name: 'Echter Dost',
    latin_name: 'Origanum vulgare',
    sun_tolerance: ['full'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 5,
    mature_height_cm: 50,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Wild marjoram; a top insect plant (many wild bees & butterflies). Aromatic; loves sun and lime.',
  },
  {
    common_name: 'Echtes Johanniskraut',
    latin_name: 'Hypericum perforatum',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 6,
    mature_height_cm: 60,
    mature_spread_cm: 50,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: "St John's wort; yellow midsummer flowers, drought-tolerant on average soils.",
  },
  {
    common_name: 'Pfirsichblättrige Glockenblume',
    latin_name: 'Campanula persicifolia',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 3,
    mature_height_cm: 80,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Peach-leaved bellflower; delicate blue bells in sun or part shade — great for naturalistic beds.',
  },
  {
    common_name: 'Wiesen-Flockenblume',
    latin_name: 'Centaurea jacea',
    sun_tolerance: ['full'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 5,
    mature_height_cm: 80,
    mature_spread_cm: 40,
    maintenance_level: 'low',
    plant_type: 'perennial',
    native: true,
    care_notes: 'Brown knapweed; long bloom and a valuable nectar source; undemanding.',
  },
  {
    common_name: 'Kornelkirsche',
    latin_name: 'Cornus mas',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['sand', 'loam'],
    min_hardiness_zone: 5,
    mature_height_cm: 450,
    mature_spread_cm: 400,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Cornelian cherry; yellow late-winter flowers and edible red fruit. Slow and reliable.',
  },
  {
    common_name: 'Pfaffenhütchen',
    latin_name: 'Euonymus europaeus',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['clay', 'loam'],
    min_hardiness_zone: 4,
    mature_height_cm: 400,
    mature_spread_cm: 300,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Spindle; striking pink-orange autumn fruit (toxic). Good hedgerow shrub on heavy soils.',
  },
  {
    common_name: 'Hundsrose',
    latin_name: 'Rosa canina',
    sun_tolerance: ['full', 'partial', 'shade'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 5,
    mature_height_cm: 300,
    mature_spread_cm: 200,
    maintenance_level: 'low',
    plant_type: 'shrub',
    native: true,
    care_notes: 'Dog rose; hips for birds, arching thorny stems. Very adaptable, sun to light shade.',
  },
  {
    common_name: 'Spitz-Ahorn',
    latin_name: 'Acer platanoides',
    sun_tolerance: ['full', 'partial'],
    soil_compatibility: ['loam'],
    min_hardiness_zone: 4,
    mature_height_cm: 2500,
    mature_spread_cm: 1800,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'Norway maple; large native shade tree, early flowers for bees, strong autumn colour. For big spaces.',
  },
  {
    common_name: 'Hänge-Birke',
    latin_name: 'Betula pendula',
    sun_tolerance: ['full'],
    soil_compatibility: ['loam', 'sand'],
    min_hardiness_zone: 2,
    mature_height_cm: 1800,
    mature_spread_cm: 900,
    maintenance_level: 'low',
    plant_type: 'tree',
    native: true,
    care_notes: 'Silver birch; white-barked pioneer with a light canopy; extremely hardy and undemanding.',
  },
]

// Attach the Wikimedia image URL to each plant by Latin name (species without one
// keep image_url undefined → null in the DB → UI placeholder).
export const PLANTS = PLANTS_RAW.map((p) =>
  PLANT_IMAGES[p.latin_name] ? { ...p, image_url: PLANT_IMAGES[p.latin_name] } : p,
)

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    console.error(
      'Missing env. This script needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Run it with:  node --env-file=.env.local scripts/seed-plants.mjs  (or `npm run seed:plants`).',
    )
    process.exit(1)
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`Seeding ${PLANTS.length} plants (insert-or-ignore on latin_name)…`)

  // ignoreDuplicates → ON CONFLICT DO NOTHING: idempotent, never clobbers admin edits.
  const { data, error } = await supabase
    .from('plants')
    .upsert(PLANTS, { onConflict: 'latin_name', ignoreDuplicates: true })
    .select('latin_name')

  if (error) {
    console.error('Seed failed:', error.message)
    process.exit(1)
  }

  const inserted = data?.length ?? 0
  const skipped = PLANTS.length - inserted
  console.log(`Done. Inserted ${inserted} new, skipped ${skipped} already present.`)
}

// Only run when invoked directly (so tests can import PLANTS without seeding).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
