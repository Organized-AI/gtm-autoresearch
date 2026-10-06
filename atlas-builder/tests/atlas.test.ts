import { test, expect } from 'claude-code/testing'

import { KICKOFF, milestone, STEPS } from '../hooks/register'

const STEP = 'mcp__atlas-builder__step'

test('Bash milestones map to build steps', async () => {
  expect(milestone('npx wrangler login')?.id).toBe('cloudflare')
  expect(milestone('npx wrangler d1 execute gtm-container-atlas --remote --file=schema.sql')?.id).toBe('database')
  expect(milestone('printf %s "$K" | npx wrangler secret put JEV_KEY')?.id).toBe('jev')
  expect(milestone('npm run deploy')?.id).toBe('deploy')
  expect(milestone('claude mcp add --transport http gtm https://gtm-mcp.stape.ai/mcp')?.id).toBe('gtm')
  expect(milestone('ls -la')).toBeNull()
  expect(STEPS.length).toBe(10)
})

test('the kickoff prompt starts a build and the step tool counts progress', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.status', () => ({ value: {} }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text: KICKOFF })
  await $.tool.call({ tool: STEP, step: 'tools', status: 'done' } as never)
  await $.tool.call({ tool: STEP, step: 'code', status: 'done' } as never)
  await $.tool.call({ tool: STEP, step: 'cloudflare', status: 'you', note: 'Finish signing in' } as never)
  const r = await $.command.run({ command: 'atlas-build', args: '' })
  expect(r.text).toBe('Atlas build: 2 of 10 steps done.')
})

test('ordinary prompts do not start a build', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text: 'what is a GTM trigger?' })
  const r = await $.command.run({ command: 'atlas-build', args: '' })
  expect(r.text).toContain('To start, send:')
})

test('an unknown step is refused', async $ => {
  const r = await $.tool.call({ tool: STEP, step: 'nope', status: 'done' } as never)
  expect(Boolean(r.isError || ('deny' in r && r.deny))).toBe(true)
})
