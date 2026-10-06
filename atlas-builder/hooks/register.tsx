// Atlas Builder: /atlas-build starts a guided build of the person's own GTM Container Atlas.
// Claude does the work; the person answers questions and connects tools. A pane shows the
// steps, a band above the prompt says whose turn it is, and the model reports progress
// through the `step` tool. Bash calls that match a milestone also tick steps off, so the
// checklist stays right even if the model forgets to report.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Build, StepState, StepStatus } from '../types'

const PLUGIN = 'atlas-builder'
const PANE = 'atlas-build'
const STEP_TOOL = `mcp__${PLUGIN}__step`
const REPO = 'https://github.com/Organized-AI/gtm-autoresearch.git'
const BRANCH = 'feat/container-atlas-jev-gtm'
const HOSTED_JEV = 'https://atlas.organizedai.vip'

type StepDef = { id: string; title: string; you?: string }
export const STEPS: StepDef[] = [
  { id: 'tools', title: 'Check Node, git and Wrangler' },
  { id: 'code', title: 'Get the atlas code' },
  { id: 'cloudflare', title: 'Sign in to Cloudflare', you: 'Finish the Cloudflare sign-in in your browser.' },
  { id: 'database', title: 'Create the D1 database' },
  { id: 'jev', title: 'Connect Jev', you: 'Give your email for a hosted Jev-gateway key (free for 30 days).' },
  { id: 'deploy', title: 'Deploy your atlas' },
  { id: 'gtm', title: 'Connect the GTM MCP', you: 'Sign in with the Google account that can see your GTM container.' },
  { id: 'audit', title: 'Audit your real container', you: 'Pick the container, then open your atlas and drop the files in.' },
  { id: 'drift', title: 'Watch for drift', you: 'Click Watch on the last review step of your atlas.' },
  { id: 'publish', title: 'Publish fixes (optional)', you: 'Type "publish" only when you have read the diff.' },
]

const fresh = (): Build => ({ active: false, steps: STEPS.map(s => ({ id: s.id, status: 'todo' as StepStatus })) })
const build = atom({ plugin: 'atlas-builder', key: 'build' } as const, fresh())

const MARK: Record<StepStatus, string> = { todo: '·', active: '▸', you: '?', done: '✓', skipped: '–', blocked: '!' }

export const PLAYBOOK = `You are running the Atlas Builder: you build the person's own GTM Container Atlas on their Cloudflare account, so they can audit their real GTM data. The person only answers questions and connects tools; you do everything else.

Rules
- Work through the steps in order. Before each step, call ${STEP_TOOL} with status "active"; when it is finished call it with "done" (or "skipped"/"blocked" with a short note). When the person must act (sign in, pick, approve), call it with status "you" and a one-line note saying exactly what to do.
- Ask every question with AskUserQuestion, with the recommended option first. Never ask for something you can find out yourself.
- Never print, paste or commit a secret (Cloudflare token, Jev key, Stape key). Pass secrets through stdin or environment variables.
- Never create, change or publish anything in GTM until step 10, and never publish unless the person types "publish".
- Keep messages short: what you did, what is next. No recap of finished steps.

Steps
1 tools: check node >= 20, git, and that "npx wrangler --version" works. Install nothing globally without asking.
2 code: git clone -b ${BRANCH} ${REPO} atlas, then npm install in atlas/container-atlas/worker. Read atlas/container-atlas/README.md and atlas/jev-gtm/README.md. Work in atlas/container-atlas/worker from here on.
3 cloudflare: run "npx wrangler whoami". If not signed in, run "npx wrangler login" and set the step to "you" until it finishes. If they have no Cloudflare account, tell them to create a free one at dash.cloudflare.com/sign-up first.
4 database: "npx wrangler d1 create gtm-container-atlas", put the database_id into wrangler.jsonc (replace REPLACE_WITH_YOUR_D1_ID), then "npm run db:init".
5 jev: Jev runs only through jev-gateway, which binds every call to a frozen rubric and logs it. The person's atlas reaches it through the hosted atlas with a key. Ask for their email (AskUserQuestion with an "Other" answer), then POST {"email": "...", "label": "<their site>"} to ${HOSTED_JEV}/api/jev/trial. Save the returned key with "npx wrangler secret put JEV_KEY" fed through stdin (never echo it). Remove any "ai" binding and JEV_MODEL var from wrangler.jsonc and add "JEV_URL": "${HOSTED_JEV}/api/judge" to vars. Tell them the trial end date, and that each finding comes back verified (fix), refuted (intended) or inconclusive (ask a person).
6 deploy: "npm run deploy", then fetch <workers.dev URL>/api/health and confirm drift, runs and jev are true. Report the URL with ${STEP_TOOL} (field "url").
7 gtm: add the remote MCP server https://gtm-mcp.stape.ai/mcp named "gtm" with this client's own command (Claude Code: "claude mcp add --transport http gtm https://gtm-mcp.stape.ai/mcp"). It signs in with Google: set the step to "you" while they do. If the tools are not visible yet, tell them to restart Claude Code and run /atlas-build resume.
8 audit: list their GTM accounts and containers, ask which to audit, read the live workspace and save it as export JSON (exportFormatVersion 2, containerVersion with tag, trigger, variable, folder, builtInVariable, container). Ask whether there is a server container; if yes save it too. Tell them to open their atlas URL and drop the files in.
9 drift: remind them to click Watch on the last review step. The watch only saves when the container is published.
10 publish (only if they ask): with the gtm server create a workspace "Atlas fixes <date>", apply the operations they accepted in the GTM auto tab, create a version, show the diff, and publish only after they type "publish".

Finish with: their atlas URL, the Jev trial end date, which MCP servers are connected, and what is left for them.`

export const KICKOFF = 'Build my own GTM Container Atlas with the Atlas Builder. Start with step 1 and ask me only what you need.'
// Any prompt that asks to build (or resume) the atlas starts the guided build.
const STARTS = /\b(build|set ?up|resume|continue)\b[^.\n]{0,40}\b(container atlas|atlas builder)\b/i

function setStep(b: Build, id: string, status: StepStatus, note?: string): Build {
  const steps = b.steps.map(s => {
    if (s.id === id) return { id, status, note: note ?? (status === s.status ? s.note : undefined) }
    // one step is "active" at a time
    if (status === 'active' && s.status === 'active') return { ...s, status: 'todo' as StepStatus }
    return s
  })
  return { ...b, steps }
}
export function nextUp(b: Build): { step: StepDef; state: StepState } | null {
  const order = ['you', 'active', 'blocked'] as const
  for (const want of order) {
    const st = b.steps.find(s => s.status === want)
    if (st) return { step: STEPS.find(d => d.id === st.id)!, state: st }
  }
  const st = b.steps.find(s => s.status === 'todo')
  return st ? { step: STEPS.find(d => d.id === st.id)!, state: st } : null
}
const doneCount = (b: Build) => b.steps.filter(s => s.status === 'done' || s.status === 'skipped').length

// Milestones read off Bash commands, as a backstop to the model's own reports.
export function milestone(command: string): { id: string; status: StepStatus } | null {
  const c = command.replace(/\s+/g, ' ')
  if (/wrangler (login|whoami)\b/.test(c)) return { id: 'cloudflare', status: 'done' }
  if (/wrangler d1 execute\b.*--file[= ]schema\.sql|npm run db:init/.test(c)) return { id: 'database', status: 'done' }
  if (/wrangler secret put JEV_KEY/.test(c)) return { id: 'jev', status: 'done' }
  if (/wrangler deploy\b|npm run deploy\b/.test(c)) return { id: 'deploy', status: 'done' }
  if (/claude mcp add\b.*gtm-mcp\.stape\.ai/.test(c)) return { id: 'gtm', status: 'done' }
  if (/git clone\b.*gtm-autoresearch/.test(c)) return { id: 'code', status: 'done' }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'atlas-build', description: 'Show the GTM Container Atlas build checklist ("reset" clears it)' })
    await $.tool.register({
      name: 'step',
      description: 'Atlas Builder progress: report the status of a build step so the person sees it in the checklist. Call with status "active" before a step, "you" when the person must act (with a one-line note), "done", "skipped" or "blocked" (with a note). Pass url once the atlas is deployed, and jev ("own" or "hosted") after step 5.',
      inputSchema: {
        type: 'object',
        properties: {
          step: { type: 'string', enum: STEPS.map(s => s.id) },
          status: { type: 'string', enum: ['active', 'you', 'done', 'skipped', 'blocked'] },
          note: { type: 'string', description: 'One short line for the person' },
          url: { type: 'string', description: 'The deployed atlas URL' },
          jev: { type: 'string', enum: ['own', 'hosted'] },
        },
        required: ['step', 'status'],
      },
    })
    const b = await read($, build)
    if (b.active) await $.ui.open({ id: PANE, title: 'Atlas build' })
    return next(e)
  })

  // The build starts from the prompt the person pastes (or types): no setup command needed.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (STARTS.test(e.text)) {
        const b = await read($, build)
        const resume = /\b(resume|continue)\b/i.test(e.text) && b.active
        if (!resume) await update($, build, () => ({ ...fresh(), active: true, startedAt: Date.now() }))
        void $.ui.open({ id: PANE, title: 'Atlas build' }).catch(() => undefined)
      }
    } catch (err) { /* the prompt goes through either way */ }
    return next(e)
  })

  // /atlas-build shows the checklist; "/atlas-build reset" stops the build and clears it.
  on('command.run', { command: 'atlas-build' }, async ($, e) => {
    if (/\breset\b/i.test(e.args)) { await update($, build, () => fresh()); $.ui.status(undefined); return { text: 'Atlas build cleared.' } }
    await $.ui.open({ id: PANE, title: 'Atlas build' })
    const b = await read($, build)
    return { text: b.active ? `Atlas build: ${doneCount(b)} of ${STEPS.length} steps done.` : 'To start, send: ' + KICKOFF }
  })

  // The playbook rides along in the system prompt only while a build is running.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const b = await read($, build)
    if (!b.active) return out
    const state = b.steps.map(s => `${s.id}: ${s.status}${s.note ? ' (' + s.note + ')' : ''}`).join('; ')
    return { sections: [...out.sections, { id: `${PLUGIN}:playbook`, text: PLAYBOOK + '\n\nCurrent progress: ' + state + (b.url ? '. Atlas URL: ' + b.url : '') + (b.jev ? '. Jev: ' + b.jev : ''), scope: 'session' as const }] }
  })

  on('tool.call', { tool: 'mcp__atlas-builder__step' }, async ($, e) => {
    try {
    const input = e as unknown as { step: string; status: StepStatus; note?: string; url?: string; jev?: 'own' | 'hosted' }
    if (!STEPS.some(s => s.id === input.step)) return { deny: 'Unknown step ' + input.step + '. Use one of: ' + STEPS.map(s => s.id).join(', ') }
    const after = await update($, build, b => {
      let nb = setStep(b, input.step, input.status, input.note)
      if (input.url) nb = { ...nb, url: input.url }
      if (input.jev) nb = { ...nb, jev: input.jev }
      if (nb.steps.every(s => s.status === 'done' || s.status === 'skipped' || s.id === 'publish')) nb = { ...nb }
      return nb
    })
    const n = doneCount(after)
    $.ui.status(`Atlas build ${n}/${STEPS.length}`)
    if (input.status === 'you') $.ui.toast('Your turn: ' + (input.note || STEPS.find(s => s.id === input.step)!.you || 'see the Atlas build pane'))
    return { result: { ok: true, done: n, of: STEPS.length } }
    } catch (err) {
      return { deny: 'Progress could not be saved: ' + String((err as Error)?.message || err) + '. Carry on with the step.' }
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    // Bookkeeping only: never let it change or block the command's result.
    try {
      const b = await read($, build)
      if (!b.active || e.tool !== 'Bash' || ran.isError || ('deny' in ran && ran.deny)) return ran
      const m = milestone(String((e as { command?: string }).command || ''))
      if (m) {
        const cur = b.steps.find(s => s.id === m.id)
        if (cur && cur.status !== 'done') {
          const after = await update($, build, x => setStep(x, m.id, m.status))
          $.ui.status(`Atlas build ${doneCount(after)}/${STEPS.length}`)
        }
      }
    } catch (err) { /* progress is best-effort */ }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, build)
    const up = nextUp(b)
    return (
      <Box flexDirection="column">
        <Text bold>GTM Container Atlas · {doneCount(b)}/{STEPS.length}</Text>
        {b.url ? <Text dimColor>{b.url}</Text> : <Text dimColor>Your own atlas on your Cloudflare account</Text>}
        <Text> </Text>
        {STEPS.map((d, i) => {
          const st = b.steps.find(s => s.id === d.id)!
          const isNow = up && up.step.id === d.id
          return (
            <Box flexDirection="column">
              <Text bold={!!isNow} dimColor={st.status === 'done' || st.status === 'skipped'} color={st.status === 'you' ? 'yellow' : st.status === 'blocked' ? 'red' : st.status === 'done' ? 'green' : undefined}>
                {MARK[st.status]} {i + 1}. {d.title}
              </Text>
              {st.note && (st.status === 'you' || st.status === 'blocked' || isNow) ? <Text dimColor>   {st.note}</Text> : null}
            </Box>
          )
        })}
        <Text> </Text>
        {b.jev ? <Text dimColor>Jev: hosted Jev-gateway (free 30 days)</Text> : null}
        {!b.active ? <Text dimColor>Type /atlas-build to start.</Text> : null}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, build)
    const up = b.active ? nextUp(b) : null
    if (!up || up.state.status !== 'you') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="yellow">Your turn · step {STEPS.indexOf(up.step) + 1}: </Text>
        <Text>{up.state.note || up.step.you || up.step.title}</Text>
      </Box>
    )
  })
}
