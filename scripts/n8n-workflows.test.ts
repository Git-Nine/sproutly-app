import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { optionValues } from '@/lib/utils'
import {
  SURFACE_OPTIONS,
  SPACE_TYPE_OPTIONS,
  SUN_OPTIONS,
  AREA_MIN,
  AREA_MAX,
} from '@/lib/scans'
import { CURATION_INTRO_MAX, CURATION_WHY_MAX } from '@/lib/plan-curation'

/**
 * Tests for the two exported n8n workflows in `docs/n8n/`.
 *
 * These workflows run OUTSIDE the app (scan-vision via /api/classify-vision,
 * plan-curation via /api/curate-plan), so nothing else in the suite covers them —
 * yet both routes turn *every* upstream problem into a silent graceful fallback.
 * A parser that no longer understands the model provider's reply shape therefore
 * shows up as a blank scan form or a permanently missing "Why this plan" card, with
 * no error anywhere. That is exactly the class of regression this file catches.
 *
 * The approach: load the committed workflow JSON, compile each Code node's `jsCode`
 * with mocked n8n globals (`$json`, `$input`, `$`), and run it against recorded
 * provider reply shapes. We test the artifact that actually gets imported into n8n,
 * not a copy of its logic.
 *
 * Contracts: docs/n8n-scan-vision-workflow.md, docs/n8n-plan-curation-workflow.md
 */

// ─── Workflow loading + Code-node harness ────────────────────────────────────

type N8nNode = {
  name: string
  type: string
  parameters: Record<string, unknown> & { jsCode?: string }
  credentials?: Record<string, { id: string; name: string }>
}
type Workflow = {
  nodes: N8nNode[]
  connections: Record<string, { main: Array<Array<{ node: string }>> }>
}
type N8nItem = { json: Record<string, unknown> }

/** Paths are resolved from the Vitest root (the repo root), not from this file —
 *  `import.meta.url` is rewritten by the transform and does not survive. */
const repoFile = (relative: string) => resolve(process.cwd(), relative)

function loadWorkflow(file: string): Workflow {
  return JSON.parse(readFileSync(repoFile(`docs/n8n/${file}`), 'utf8')) as Workflow
}

const vision = loadWorkflow('scan-vision.workflow.json')
const curation = loadWorkflow('plan-curation.workflow.json')

function node(wf: Workflow, name: string): N8nNode {
  const found = wf.nodes.find((n) => n.name === name)
  if (!found) throw new Error(`no node named "${name}" (have: ${wf.nodes.map((n) => n.name)})`)
  return found
}

/**
 * Run a Code node's `jsCode` with the n8n globals it is allowed to touch.
 * `$('…')` only resolves the Webhook node — any other reference throws, which keeps
 * the nodes honest about their one upstream dependency.
 */
function runCodeNode(
  wf: Workflow,
  nodeName: string,
  { input = {}, webhookBody = {} }: { input?: unknown; webhookBody?: unknown } = {},
): N8nItem[] {
  const code = node(wf, nodeName).parameters.jsCode
  if (typeof code !== 'string') throw new Error(`"${nodeName}" is not a Code node`)

  const webhook = { item: { json: { body: webhookBody } } }
  const $input = { first: () => ({ json: input }) }
  const $ = (name: string) => {
    if (name !== 'Webhook') throw new Error(`unexpected node reference: $('${name}')`)
    return webhook
  }

  // n8n Code nodes are function bodies (top-level `return` is legal there), so the
  // only faithful way to execute one is to compile it as a function body. The input
  // is a repo-committed file, never user data.
  const fn = new Function('$json', '$input', '$', code) as (
    $json: unknown,
    $input: unknown,
    $: unknown,
  ) => N8nItem[]
  return fn(input, $input, $)
}

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const VISION_WEBHOOK_BODY = {
  scan_draft_id: null,
  photo_url: 'https://example.supabase.co/storage/v1/object/sign/photos/u1/p.jpg?token=abc',
  postcode: '10115',
}

const goodVisionAnswer = JSON.stringify({
  usable: true,
  is_plantable_space: true,
  confidence: 0.82,
  surface: 'gravel',
  space_type: 'front_garden',
  sun_exposure: 'partial',
  area_sqm: 8,
  notes: 'Gravel front area, open to sky.',
})

/** The provider reply shapes the parsers must survive. */
const openRouterReply = (text: string) => ({
  id: 'gen-1',
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
})
const openRouterArrayReply = (text: string) => ({
  choices: [{ message: { role: 'assistant', content: [{ type: 'text', text }] } }],
})
const anthropicReply = (text: string) => ({ content: [{ type: 'text', text }] })
const n8nAiNodeReply = (text: string) => ({ text })

const parseVision = (input: unknown) =>
  runCodeNode(vision, 'Parse & shape', { input, webhookBody: VISION_WEBHOOK_BODY })[0].json

const CURATION_BODY = {
  site: {
    sun: 'full',
    area_sqm: 20,
    surface: 'soil',
    space_type: 'back_garden',
    soil: 'loam',
    zone: 7,
    maintenance_preference: 'low',
  },
  bounds: { min_picks: 2, max_picks: 3 },
  limits: { intro_max_chars: CURATION_INTRO_MAX, why_max_chars: CURATION_WHY_MAX },
  plants: [
    { id: 'plant-a', common_name: 'Yarrow', latin_name: 'Achillea millefolium', native: true },
    { id: 'plant-b', common_name: 'Silver birch', latin_name: 'Betula pendula', native: true },
    { id: 'plant-c', common_name: 'Thyme', latin_name: 'Thymus serpyllum', native: true },
  ],
}

const goodCurationAnswer = JSON.stringify({
  intro: 'A calm, layered mix for your sunny loam border.',
  selection: [
    { plant_id: 'plant-a', why: 'Thrives in full sun and asks almost nothing of you.' },
    { plant_id: 'plant-b', why: 'Gives the bed height and dappled shade as it matures.' },
  ],
})

const parseCuration = (input: unknown) =>
  runCodeNode(curation, 'Parse & validate', { input, webhookBody: CURATION_BODY })[0].json

// ─── Structure ───────────────────────────────────────────────────────────────

describe.each([
  ['scan-vision', vision, ['Webhook', 'Build request', 'Parse & shape', 'Switch (usable?)']],
  ['plan-curation', curation, ['Webhook', 'Build request', 'Parse & validate', 'Switch (curated?)']],
] as const)('%s workflow structure', (_name, wf, requiredNodes) => {
  it('has the expected nodes', () => {
    const names = wf.nodes.map((n) => n.name)
    for (const required of requiredNodes) expect(names).toContain(required)
  })

  it('wires every connection to a node that exists', () => {
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const [source, outputs] of Object.entries(wf.connections)) {
      expect(names.has(source), `connection source "${source}" is not a node`).toBe(true)
      for (const group of outputs.main) {
        for (const target of group) {
          expect(names.has(target.node), `"${target.node}" is not a node`).toBe(true)
        }
      }
    }
  })

  it('calls the model through an HTTP Request node with Header Auth and a timeout', () => {
    const http = wf.nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest')
    expect(http, 'no HTTP Request node').toBeDefined()
    expect(http!.parameters.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(http!.parameters.method).toBe('POST')
    expect(http!.parameters.genericAuthType).toBe('httpHeaderAuth')
    // The key must come from a credential, never be inlined in the exported JSON.
    expect(JSON.stringify(http!.parameters)).not.toMatch(/sk-or-[\w-]{8}/)
    expect(http!.credentials?.httpHeaderAuth).toBeDefined()
    expect(typeof http!.parameters.options).toBe('object')
    const timeout = (http!.parameters.options as { timeout?: number }).timeout
    expect(typeof timeout).toBe('number')
  })

  it('compiles every Code node', () => {
    for (const n of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
      expect(() => new Function('$json', '$input', '$', n.parameters.jsCode as string)).not.toThrow()
    }
  })
})

// ─── scan-vision: Build request ──────────────────────────────────────────────

describe('scan-vision / Build request', () => {
  const payload = runCodeNode(vision, 'Build request', { webhookBody: VISION_WEBHOOK_BODY })[0].json
    .payload as {
    model: string
    max_tokens: number
    messages: Array<{ role: string; content: Array<Record<string, never>> }>
  }
  const content = payload.messages[0].content as unknown as [
    { type: string; text: string },
    { type: string; image_url: { url: string } },
  ]

  it('builds a vendor/model slug and a serialisable chat-completions body', () => {
    expect(payload.model).toMatch(/^[\w.-]+\/[\w.-]+$/)
    expect(payload.max_tokens).toBeGreaterThan(0)
    expect(payload.messages[0].role).toBe('user')
    expect(() => JSON.stringify(payload)).not.toThrow()
  })

  it('passes the photo as an image_url block carrying the signed URL', () => {
    expect(content[1].type).toBe('image_url')
    expect(content[1].image_url.url).toBe(VISION_WEBHOOK_BODY.photo_url)
  })

  it('interpolates the postcode, and degrades to "none" when absent', () => {
    expect(content[0].text).toContain('Postcode hint: 10115')
    const noPostcode = runCodeNode(vision, 'Build request', {
      webhookBody: { photo_url: 'https://x/y.jpg' },
    })[0].json.payload as { messages: Array<{ content: Array<{ text?: string }> }> }
    expect(noPostcode.messages[0].content[0].text).toContain('Postcode hint: none')
  })

  it('sends no unevaluated n8n expression placeholders', () => {
    // A `{{ … }}` reaching the model verbatim is the 2026-07-09 expression-mode bug.
    expect(JSON.stringify(payload)).not.toContain('{{')
  })

  it('keeps the prompt enums in lockstep with src/lib/scans.ts', () => {
    const prompt = content[0].text
    expect(prompt).toContain(`surface (one of ${optionValues(SURFACE_OPTIONS).join(', ')})`)
    expect(prompt).toContain(`space_type (one of ${optionValues(SPACE_TYPE_OPTIONS).join(', ')})`)
    expect(prompt).toContain(`sun_exposure (one of ${optionValues(SUN_OPTIONS).join(', ')})`)
    expect(prompt).toContain(`area_sqm (integer from ${AREA_MIN} to ${AREA_MAX}`)
  })
})

// ─── scan-vision: Parse & shape ──────────────────────────────────────────────

describe('scan-vision / Parse & shape', () => {
  it('reads the OpenRouter reply shape', () => {
    const out = parseVision(openRouterReply(goodVisionAnswer))
    expect(out.status).toBe('ok')
    expect(out.branch).toBe('ok')
    expect(out.fields).toEqual({
      surface: 'gravel',
      space_type: 'front_garden',
      sun_exposure: 'partial',
      area_sqm: 8,
    })
    expect(out.confidence).toBe(0.82)
  })

  it('reads an OpenRouter array content block', () => {
    expect(parseVision(openRouterArrayReply(goodVisionAnswer)).status).toBe('ok')
  })

  it('strips markdown fences and surrounding prose', () => {
    expect(parseVision(openRouterReply(`Here you go:\n\`\`\`json\n${goodVisionAnswer}\n\`\`\``)).status).toBe('ok')
  })

  it('still reads the Anthropic / n8n AI node shapes, so reverting the provider is safe', () => {
    expect(parseVision(anthropicReply(goodVisionAnswer)).status).toBe('ok')
    expect(parseVision(n8nAiNodeReply(goodVisionAnswer)).status).toBe('ok')
  })

  it('falls back (never throws, never invents fields) on an unknown reply shape', () => {
    // This is the silent-failure path: an unrecognised shape must degrade to the
    // manual form, not to a confidently wrong prefill.
    const out = parseVision({ some: 'unexpected wrapper' })
    expect(out.status).not.toBe('ok')
    expect(out.fields).toBeNull()
  })

  it('falls back on prose, empty and malformed JSON replies', () => {
    for (const text of ['', 'I am unable to help with that.', '{ not json']) {
      const out = parseVision(openRouterReply(text))
      expect(out.status).not.toBe('ok')
      expect(out.fields).toBeNull()
    }
  })

  it('rejects off-enum and out-of-range values the model invents', () => {
    const offEnum = { ...JSON.parse(goodVisionAnswer), surface: 'concrete' }
    expect(parseVision(openRouterReply(JSON.stringify(offEnum))).fields).toBeNull()

    const tooBig = { ...JSON.parse(goodVisionAnswer), area_sqm: AREA_MAX + 1 }
    expect(parseVision(openRouterReply(JSON.stringify(tooBig))).fields).toBeNull()

    const fractional = { ...JSON.parse(goodVisionAnswer), area_sqm: 8.5 }
    expect(parseVision(openRouterReply(JSON.stringify(fractional))).fields).toBeNull()
  })

  it('distinguishes "rejected" from "low_confidence"', () => {
    const unreadable = { ...JSON.parse(goodVisionAnswer), usable: false }
    expect(parseVision(openRouterReply(JSON.stringify(unreadable))).status).toBe('rejected')

    const unsure = { ...JSON.parse(goodVisionAnswer), confidence: 0.2 }
    expect(parseVision(openRouterReply(JSON.stringify(unsure))).status).toBe('low_confidence')
  })

  it('does not reject a balcony or a paved area for "not being a garden"', () => {
    for (const space_type of ['balcony', 'bed'] as const) {
      const answer = { ...JSON.parse(goodVisionAnswer), space_type, surface: 'paved' }
      expect(parseVision(openRouterReply(JSON.stringify(answer))).status).toBe('ok')
    }
  })
})

// ─── plan-curation: Build request ────────────────────────────────────────────

describe('plan-curation / Build request', () => {
  const payload = runCodeNode(curation, 'Build request', { webhookBody: CURATION_BODY })[0].json
    .payload as { model: string; max_tokens: number; messages: Array<{ content: string }> }
  const prompt = payload.messages[0].content

  it('builds a vendor/model slug and a serialisable chat-completions body', () => {
    expect(payload.model).toMatch(/^[\w.-]+\/[\w.-]+$/)
    expect(payload.max_tokens).toBeGreaterThan(0)
    expect(() => JSON.stringify(payload)).not.toThrow()
  })

  it('interpolates the real request JSON, not an expression placeholder', () => {
    // The 2026-07-09 live bug: a "Fixed" prompt field sent `{{ … }}` verbatim and
    // every plan silently fell back. Building the prompt in JS makes that impossible.
    expect(prompt).not.toContain('{{')
    expect(prompt).toContain('"plants"')
    expect(prompt).toContain('plant-a')
    expect(prompt).toContain(String(CURATION_BODY.site.area_sqm))
  })

  it('keeps the output contract and the honesty rules in the prompt', () => {
    expect(prompt).toContain(
      '{"intro":"...","selection":[{"plant_id":"<id from the menu>","why":"..."}]}',
    )
    expect(prompt).toContain('NEVER invent numbers')
    expect(prompt).toContain('never moralize about climate, guilt, or duty')
    expect(prompt).toContain('MENU ONLY')
  })
})

// ─── plan-curation: Parse & validate ─────────────────────────────────────────

describe('plan-curation / Parse & validate', () => {
  it('reads the OpenRouter reply shape', () => {
    const out = parseCuration(openRouterReply(goodCurationAnswer))
    expect(out.branch).toBe('ok')
    expect(out.status).toBe('ok')
    expect(out.intro).toBe('A calm, layered mix for your sunny loam border.')
    expect(out.selection).toEqual([
      { plant_id: 'plant-a', why: 'Thrives in full sun and asks almost nothing of you.' },
      { plant_id: 'plant-b', why: 'Gives the bed height and dappled shade as it matures.' },
    ])
  })

  it('strips markdown fences', () => {
    expect(parseCuration(openRouterReply(`\`\`\`json\n${goodCurationAnswer}\n\`\`\``)).branch).toBe(
      'ok',
    )
  })

  it('still reads the Anthropic / n8n AI node shapes, so reverting the provider is safe', () => {
    expect(parseCuration(anthropicReply(goodCurationAnswer)).branch).toBe('ok')
    expect(parseCuration(n8nAiNodeReply(goodCurationAnswer)).branch).toBe('ok')
  })

  it('answers no_curation (never throws) on an unknown reply shape', () => {
    const out = parseCuration({ some: 'unexpected wrapper' })
    expect(out.status).toBe('no_curation')
    expect(out.branch).toBe('fallback')
    expect(typeof out.message).toBe('string')
  })

  it('answers no_curation on prose and malformed JSON', () => {
    for (const text of ['', 'Could you clarify which plants you mean?', '{ not json']) {
      expect(parseCuration(openRouterReply(text)).status).toBe('no_curation')
    }
  })

  it('rejects an off-menu plant id', () => {
    const answer = JSON.stringify({
      intro: 'x',
      selection: [
        { plant_id: 'plant-a', why: 'ok' },
        { plant_id: 'not-in-the-menu', why: 'invented' },
      ],
    })
    expect(parseCuration(openRouterReply(answer)).status).toBe('no_curation')
  })

  it('rejects a duplicated plant id', () => {
    const answer = JSON.stringify({
      intro: 'x',
      selection: [
        { plant_id: 'plant-a', why: 'once' },
        { plant_id: 'plant-a', why: 'twice' },
      ],
    })
    expect(parseCuration(openRouterReply(answer)).status).toBe('no_curation')
  })

  it('rejects a pick count outside the requested bounds', () => {
    const tooFew = JSON.stringify({ intro: 'x', selection: [{ plant_id: 'plant-a', why: 'solo' }] })
    expect(parseCuration(openRouterReply(tooFew)).status).toBe('no_curation')

    const tooMany = JSON.stringify({
      intro: 'x',
      selection: CURATION_BODY.plants
        .map((p) => ({ plant_id: p.id, why: 'y' }))
        .concat([{ plant_id: 'plant-a', why: 'y' }]),
    })
    expect(parseCuration(openRouterReply(tooMany)).status).toBe('no_curation')
  })

  it('enforces the intro and why length limits from src/lib/plan-curation.ts', () => {
    const longIntro = JSON.stringify({
      intro: 'x'.repeat(CURATION_INTRO_MAX + 1),
      selection: [
        { plant_id: 'plant-a', why: 'ok' },
        { plant_id: 'plant-b', why: 'ok' },
      ],
    })
    expect(parseCuration(openRouterReply(longIntro)).status).toBe('no_curation')

    const longWhy = JSON.stringify({
      intro: 'fine',
      selection: [
        { plant_id: 'plant-a', why: 'y'.repeat(CURATION_WHY_MAX + 1) },
        { plant_id: 'plant-b', why: 'ok' },
      ],
    })
    expect(parseCuration(openRouterReply(longWhy)).status).toBe('no_curation')
  })

  it('rejects a missing intro or a missing why line', () => {
    const noIntro = JSON.stringify({
      selection: [
        { plant_id: 'plant-a', why: 'ok' },
        { plant_id: 'plant-b', why: 'ok' },
      ],
    })
    expect(parseCuration(openRouterReply(noIntro)).status).toBe('no_curation')

    const noWhy = JSON.stringify({
      intro: 'fine',
      selection: [{ plant_id: 'plant-a' }, { plant_id: 'plant-b', why: 'ok' }],
    })
    expect(parseCuration(openRouterReply(noWhy)).status).toBe('no_curation')
  })
})

// ─── Timeout lockstep with the calling routes ────────────────────────────────

describe('HTTP node timeouts stay inside the calling route aborts', () => {
  /** Read the route's abort budget straight from its source, so the two can't drift. */
  function routeTimeoutMs(routePath: string): number {
    const source = readFileSync(repoFile(`src/app/api/${routePath}/route.ts`), 'utf8')
    const match = /const N8N_TIMEOUT_MS = ([\d_]+)/.exec(source)
    if (!match) throw new Error(`no N8N_TIMEOUT_MS in ${routePath}/route.ts`)
    return Number(match[1].replace(/_/g, ''))
  }

  it.each([
    ['scan-vision', vision, 'classify-vision'],
    ['plan-curation', curation, 'curate-plan'],
  ] as const)('%s', (_name, wf, routePath) => {
    const http = wf.nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest')!
    const nodeTimeout = (http.parameters.options as { timeout: number }).timeout
    // If the node outlives the route, the client aborts first and n8n records no
    // failed execution — the outage becomes invisible.
    expect(nodeTimeout).toBeLessThan(routeTimeoutMs(routePath))
  })
})
