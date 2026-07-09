// PROJ-11 — selection filter: which German species enter the pipeline.
//
// No open source carries an "ornamental / orderable" flag, so garden-suitability is a
// CURATED ALLOWLIST (below) narrowed by RULE-BASED EXCLUSIONS: invasive species (EU
// Union list + BfN national lists) and unsuitable habitats (aquatics, pasture grasses,
// agricultural weeds, protected species). Everything here is pure + data-only, so the
// filter is unit-testable without any network access.
//
// The allowlist is the human-curated seed of candidate species; the exclusion rules
// are the guardrail that catches anything invasive/unsuitable that slips in (and are
// exercised directly by the tests with trap inputs). Invasive lists are freely
// reusable (EU Reg. 1143/2014 as an EU official work; BfN Neobiota national lists).

/** EU Union list of invasive alien species (Reg. 1143/2014, plant species relevant to
 *  Germany; current via Implementing Reg. 2025/1422). Legally binding + freely reusable. */
export const EU_UNION_LIST = new Set([
  'Heracleum mantegazzianum',
  'Heracleum sosnowskyi',
  'Heracleum persicum',
  'Impatiens glandulifera',
  'Lupinus polyphyllus',
  'Ailanthus altissima',
  'Lysichiton americanus',
  'Gunnera tinctoria',
  'Baccharis halimifolia',
  'Pueraria montana',
  'Acacia dealbata',
  'Ludwigia grandiflora',
  'Ludwigia peploides',
  'Myriophyllum aquaticum',
  'Myriophyllum heterophyllum',
  'Elodea nuttallii',
  'Cabomba caroliniana',
  'Parthenium hysterophorus',
  'Asclepias syriaca',
  'Hakea sericea',
])

/** BfN Neobiota national management lists — invasive neophytes beyond the EU set. */
export const BFN_INVASIVE = new Set([
  'Solidago canadensis',
  'Solidago gigantea',
  'Prunus serotina',
  'Robinia pseudoacacia',
  'Reynoutria japonica',
  'Fallopia japonica',
  'Reynoutria sachalinensis',
  'Rhus typhina',
  'Buddleja davidii',
  'Spiraea douglasii',
  'Rosa rugosa',
  'Mahonia aquifolium',
  'Senecio inaequidens',
  'Bunias orientalis',
  'Helianthus tuberosus',
])

/** Protected species (BNatSchG / Federal Species Protection Ordinance) — a curated
 *  set of the commonly-encountered wild ornamentals it is illegal to dig/trade. */
export const PROTECTED_SPECIES = new Set([
  'Gentiana lutea',
  'Pulsatilla vulgaris',
  'Cypripedium calceolus',
  'Leucojum vernum',
  'Galanthus nivalis',
  'Dianthus gratianopolitanus',
])

/** Genera excluded by habitat: aquatics/marginals, pasture grasses, and common
 *  agricultural weeds — matched on the first word of the Latin binomial. */
export const EXCLUDED_GENERA = new Set([
  // Aquatics / marsh
  'Nymphaea', 'Nuphar', 'Potamogeton', 'Ceratophyllum', 'Lemna', 'Elodea',
  'Myriophyllum', 'Typha', 'Phragmites', 'Sparganium', 'Sagittaria', 'Alisma',
  // Pasture / agricultural grasses
  'Lolium', 'Poa', 'Dactylis', 'Phleum', 'Alopecurus', 'Agrostis', 'Bromus',
  'Elymus', 'Elytrigia', 'Cynosurus', 'Arrhenatherum',
  // Common agricultural / ruderal weeds. (Note: NOT genus-excluding Galium — its
  // ornamental members like G. odoratum/sweet woodruff are garden-suitable; only
  // G. aparine is a weed, handled by curation not a blanket genus rule.)
  'Cirsium', 'Rumex', 'Chenopodium', 'Urtica', 'Sonchus', 'Convolvulus',
  'Capsella', 'Stellaria', 'Amaranthus', 'Polygonum', 'Persicaria', 'Senecio',
])

function genusOf(latinName) {
  return String(latinName ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * Decide whether a species passes the selection filter. Returns
 * { included: boolean, reason: string|null } — `reason` names the exclusion rule
 * (for the run report) or is null when included. Invasive/protected checks are by
 * exact binomial; habitat checks are by genus.
 */
export function passesSelectionFilter(latinName) {
  const name = String(latinName ?? '').trim()
  if (!name) return { included: false, reason: 'empty name' }
  if (EU_UNION_LIST.has(name)) return { included: false, reason: 'invasive (EU Union list)' }
  if (BFN_INVASIVE.has(name)) return { included: false, reason: 'invasive (BfN national list)' }
  if (PROTECTED_SPECIES.has(name)) return { included: false, reason: 'protected species' }
  if (EXCLUDED_GENERA.has(genusOf(name))) {
    return { included: false, reason: `excluded habitat/genus (${genusOf(name)})` }
  }
  return { included: true, reason: null }
}

/**
 * Curated candidate species — German-relevant, garden-suitable natives plus proven
 * non-invasive ornamentals, chosen to extend the ~40 seeded rows across all four
 * structural layers. Some may already be in the live catalogue (the import marks
 * those as existing/conflict). Every entry is still run through
 * passesSelectionFilter so an accidental invasive/aquatic addition is caught.
 */
export const CANDIDATE_ALLOWLIST = [
  // ---- Perennials (natives + non-invasive ornamentals) ----
  'Aquilegia vulgaris',
  'Aster amellus',
  'Symphyotrichum novae-angliae',
  'Bergenia cordifolia',
  'Astrantia major',
  'Geranium pratense',
  'Geranium macrorrhizum',
  'Alchemilla mollis',
  'Salvia officinalis',
  'Thymus vulgaris',
  'Sedum acre',
  'Sedum album',
  'Verbascum nigrum',
  'Verbascum thapsus',
  'Malva sylvestris',
  'Malva moschata',
  'Dianthus carthusianorum',
  'Silene dioica',
  'Silene vulgaris',
  'Primula veris',
  'Primula vulgaris',
  'Aconitum napellus',
  'Delphinium elatum',
  'Lythrum salicaria',
  'Filipendula ulmaria',
  'Sanguisorba officinalis',
  'Valeriana officinalis',
  'Eupatorium cannabinum',
  'Solidago virgaurea',
  'Inula helenium',
  'Tanacetum vulgare',
  'Anthemis tinctoria',
  'Stachys byzantina',
  'Stachys officinalis',
  'Nepeta cataria',
  'Agastache foeniculum',
  'Monarda didyma',
  'Papaver orientale',
  'Papaver rhoeas',
  'Aster alpinus',
  'Doronicum orientale',
  'Helenium autumnale',
  'Gaura lindheimeri',
  'Coreopsis verticillata',
  'Iris germanica',
  'Iris sibirica',
  'Paeonia officinalis',
  'Aquilegia caerulea',
  'Aruncus dioicus',
  'Astilbe chinensis',
  // ---- Grasses (ornamental, non-pasture) ----
  'Molinia caerulea',
  'Deschampsia cespitosa',
  'Sesleria autumnalis',
  'Panicum virgatum',
  'Pennisetum alopecuroides',
  // ---- Groundcovers ----
  'Vinca minor',
  'Waldsteinia ternata',
  'Pachysandra terminalis',
  'Thymus serpyllum',
  'Fragaria vesca',
  'Vaccinium vitis-idaea',
  'Galium odoratum',
  'Lamium maculatum',
  'Veronica prostrata',
  'Antennaria dioica',
  // ---- Shrubs ----
  'Ribes sanguineum',
  'Ribes uva-crispa',
  'Ligustrum vulgare',
  'Berberis vulgaris',
  'Berberis thunbergii',
  'Ilex aquifolium',
  'Hedera helix',
  'Lonicera periclymenum',
  'Lonicera xylosteum',
  'Frangula alnus',
  'Rhamnus cathartica',
  'Salix purpurea',
  'Salix rosmarinifolia',
  'Amelanchier lamarckii',
  'Physocarpus opulifolius',
  'Spiraea japonica',
  'Weigela florida',
  'Hydrangea paniculata',
  'Deutzia gracilis',
  'Philadelphus coronarius',
  'Syringa vulgaris',
  'Hippophae rhamnoides',
  'Rosa rubiginosa',
  'Rosa gallica',
  // ---- Trees ----
  'Fagus sylvatica',
  'Quercus robur',
  'Quercus petraea',
  'Fraxinus excelsior',
  'Alnus glutinosa',
  'Ulmus glabra',
  'Malus sylvestris',
  'Pyrus communis',
  'Prunus padus',
  'Sorbus aria',
  'Sorbus torminalis',
  'Acer pseudoplatanus',
  'Populus tremula',
  'Taxus baccata',
]
