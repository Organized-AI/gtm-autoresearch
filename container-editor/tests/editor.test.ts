import { test, expect } from 'claude-code/testing'

import { PUBLISHES, SAYS_PUBLISH, STARTS } from '../hooks/register'

const passPrompts = (on: any) => on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }) as never)
const quietUi = (on: any) => { on('ui.open', () => ({ value: { isPlaced: true } }) as never); on('ui.status', () => ({ value: {} }) as never); on('ui.toast', () => ({ value: {} }) as never) }

test('what starts an edit session', async () => {
  expect(STARTS.test('edit my container')).toBe(true)
  expect(STARTS.test('Can you edit our GTM container GTM-ABC1234?')).toBe(true)
  expect(STARTS.test('what does a container do')).toBe(false)
  expect(PUBLISHES('mcp__gtm__publish_container_version')).toBe(true)
  expect(PUBLISHES('mcp__gtm__create_workspace')).toBe(false)
  expect(SAYS_PUBLISH.test('looks good, publish it')).toBe(true)
})

test('a GTM ID in the first message sets the source', async ($, on) => {
  passPrompts(on); quietUi(on)
  await $.prompt.submit({ text: 'edit my container GTM-abc1234' })
  const r = await $.command.run({ command: 'edit-container', args: '' })
  expect(r.text).toContain('GTM-ABC1234 (gtm)')
})

test('changes are counted', async ($, on) => {
  passPrompts(on); quietUi(on)
  await $.prompt.submit({ text: 'edit my container' })
  await $.tool.call({ tool: 'mcp__container-editor__source', kind: 'export', path: 'c.json', publicId: 'gtm-zzz9999' } as never)
  await $.tool.call({ tool: 'mcp__container-editor__change', kind: 'fix', summary: 'Set event name' } as never)
  await $.tool.call({ tool: 'mcp__container-editor__change', kind: 'pause', summary: 'Paused UA tag' } as never)
  const r = await $.command.run({ command: 'edit-container', args: '' })
  expect(r.text).toBe('Editing GTM-ZZZ9999 (export): 2 changes.')
})

test('publishing is blocked until the person says publish', async ($, on) => {
  passPrompts(on); quietUi(on)
  on('tool.call', { tool: 'mcp__gtm__publish_version' }, () => ({ result: { published: true } }) as never)
  await $.prompt.submit({ text: 'edit my container GTM-ABC1234' })
  const blocked = await $.tool.call({ tool: 'mcp__gtm__publish_version', id: '7' } as never)
  expect(Boolean(blocked.isError || ('deny' in blocked && blocked.deny))).toBe(true)
  await $.prompt.submit({ text: 'Looks right. Publish it.' })
  const ok = await $.tool.call({ tool: 'mcp__gtm__publish_version', id: '7' } as never)
  expect(Boolean(ok.isError || ('deny' in ok && ok.deny))).toBe(false)
})

test('the pane offers the three sources and asks for a GTM ID', async ($, on) => {
  passPrompts(on); quietUi(on)
  await $.command.run({ command: 'edit-container', args: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'container-editor', surface, component: 'Pane', props: {}, requestId: 'container-editor' } as never)
    expect(await ui.find({ key: 'pick-sample' })).toBeDefined()
    await ui.press({ key: 'pick-gtm' })
    expect(await ui.find({ key: 'gtm-id' })).toBeDefined()
    await ui.unmount()
  }
})
