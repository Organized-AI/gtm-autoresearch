// Container Editor: say "edit my container" and Claude asks where the container comes from
// (a GTM ID with Google sign-in, an exported JSON file, or the Skyline Charters sample),
// loads it, and makes the changes you ask for. A pane shows the source and every change.
// Live containers are edited in a new workspace; nothing is published unless you type "publish".
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Session, SourceKind } from '../types'

const PANE = 'container-editor'
const GTM_MCP = 'https://gtm-mcp.stape.ai/mcp'
const session = atom({ plugin: 'container-editor', key: 'session' } as const, { active: false, changes: [] } as Session)

// "edit my container", "edit our GTM container", "edit the sample container", "edit container GTM-ABC123"
export const STARTS = /\bedit\b[^.\n]{0,30}\b(container|gtm)\b/i
// A publish request must come from the person, in their own latest message.
export const SAYS_PUBLISH = /\bpublish\b/i
// Tools that publish, whatever the GTM MCP calls them.
export const PUBLISHES = (tool: string) => /^mcp__/.test(tool) && /publish/i.test(tool)

export const PLAYBOOK = `You are running the Container Editor. The person wants to edit a Google Tag Manager container.

1. Source. The person can also choose in the Container pane, which sends you a message. Unless the source is already set (see "Current session" below), ask with AskUserQuestion, header "Container", question "Where is the container you want to edit?", these options in this order:
   - "GTM ID + Google sign-in": edit the live container. Ask for the GTM ID (GTM-XXXXXXX) with AskUserQuestion (they type it as "Other").
   - "Exported JSON file": they attach or give the path of a container export (GTM: Admin > Export Container).
   - "Sample container": the fictional Skyline Charters web container, for practice.
   Then call mcp__container-editor__source with what they chose.

2. Load it.
   - GTM ID: you need the GTM MCP server (tools named mcp__gtm__*). If those tools are missing, run: claude mcp add --transport http gtm ${GTM_MCP}  and tell the person: "Type /mcp, choose gtm, and press Authenticate to sign in with Google. Then say continue." Stop there until they say continue. Once connected, find the account and container whose publicId matches the ID, list its workspaces, and create a new workspace named "Claude edits <YYYY-MM-DD>" (never edit "Default Workspace"). Record it with mcp__container-editor__source (workspace).
   - Exported JSON: read the file and check it has containerVersion with tag/trigger/variable. If it is not a GTM export, say so and ask again.
   - Sample: call mcp__container-editor__sample; it saves the sample to the working folder and returns the path.
   Then give a five-line summary: container name and ID, counts of tags, triggers, variables, and the three most obvious problems you see (blank required settings, unused elements, duplicates, Universal Analytics tags).

3. Edit. Ask what they want to change, offering the problems you found as AskUserQuestion options (multiSelect) plus "Something else". Make one change at a time. After each change call mcp__container-editor__change with a one-line summary.
   - Live container: apply each change in the "Claude edits" workspace through the GTM MCP.
   - Export or sample: never overwrite the original file. Write the edited container to <original-name>-edited.json (same export format, exportFormatVersion 2) and record it with mcp__container-editor__source (output). Tell them how to import it: GTM > Admin > Import Container > choose the file > Existing workspace or New > Merge > Overwrite conflicting.

4. Finish. List the changes. For a live container, create a version in the workspace and show what it contains; publish only if the person's own message says "publish" (a guard blocks publish otherwise). Never delete a tag, trigger or variable without asking first.

Keep messages short. Never print access tokens.`

const ID = /^GTM-[A-Z0-9]{4,12}$/

// Pane choices hand the work to Claude as if the person had typed it.
async function choose($: EngineInterface, kind: SourceKind, value?: string) {
  try {
    if (kind === 'gtm') {
      const id = String(value || '').trim().toUpperCase()
      if (!ID.test(id)) { await update($, session, (x: Session): Session => ({ ...x, error: 'That is not a GTM ID. It looks like GTM-ABC1234.' })); return }
      await update($, session, (x: Session): Session => ({ ...x, active: true, source: 'gtm', publicId: id, picking: undefined, error: undefined }))
      await $.prompt.submit({ text: `Edit my container ${id}: load it with Google sign-in.`, asUser: true })
    } else if (kind === 'export') {
      const path = String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ')
      let ok = false
      try { const doc = JSON.parse(await $.fs.read(path)); ok = !!(doc && (doc.containerVersion || doc.tag)) } catch (err) { ok = false }
      if (!ok) { await update($, session, (x: Session): Session => ({ ...x, error: 'That file is not a GTM container export (Admin > Export Container).' })); return }
      await update($, session, (x: Session): Session => ({ ...x, active: true, source: 'export', path, picking: undefined, error: undefined }))
      await $.prompt.submit({ text: `Edit my container from the export at ${path}.`, asUser: true })
    } else {
      await update($, session, (x: Session): Session => ({ ...x, active: true, source: 'sample', picking: undefined, error: undefined }))
      await $.prompt.submit({ text: 'Edit the sample container: save it with the sample tool and load it.', asUser: true })
    }
  } catch (err) { $.ui.toast('Could not start: ' + String((err as Error)?.message || err)) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'edit-container', description: 'Edit a GTM container: by GTM ID with Google sign-in, from an export file, or the sample ("reset" clears)' })
    await $.tool.register({
      name: 'source',
      description: 'Container Editor: record where the container comes from and where edits go. kind is gtm, export or sample; set publicId, name, path, workspace (live edits) or output (edited file) as they become known.',
      inputSchema: { type: 'object', properties: {
        kind: { type: 'string', enum: ['gtm', 'export', 'sample'] }, publicId: { type: 'string' }, name: { type: 'string' },
        path: { type: 'string' }, workspace: { type: 'string' }, output: { type: 'string' } }, required: ['kind'] },
    })
    await $.tool.register({
      name: 'change',
      description: 'Container Editor: log one change you made to the container, so the person sees it in the Container pane.',
      inputSchema: { type: 'object', properties: {
        kind: { type: 'string', enum: ['add', 'edit', 'rename', 'pause', 'unpause', 'move', 'delete', 'fix'] },
        summary: { type: 'string', description: 'One line, e.g. "Set event name of GA4 - add_to_cart to add_to_cart"' },
        element: { type: 'string' } }, required: ['kind', 'summary'] },
    })
    await $.tool.register({
      name: 'sample',
      description: 'Container Editor: save the fictional Skyline Charters sample (a web container, and its server container) to the working folder and return the file paths.',
      inputSchema: { type: 'object', properties: { includeServer: { type: 'boolean' } } },
    })
    const s = await read($, session)
    if (s.active) void $.ui.open({ id: PANE, title: 'Container' }).catch(() => undefined)
    return next(e)
  })

  // The person's own words: what starts an edit session, and the only place "publish" counts.
  on('prompt.submit', async ($, e, next) => {
    try {
      const fromPerson = !e.origin || e.origin.kind !== 'plugin'
      if (fromPerson) {
        const starting = STARTS.test(e.text)
        const s = await read($, session)
        if (starting && !s.active) {
          const id = /\bGTM-[A-Z0-9]{4,12}\b/i.exec(e.text)
          await update($, session, () => ({ active: true, changes: [], lastPrompt: e.text, ...(id ? { source: 'gtm' as SourceKind, publicId: id[0].toUpperCase() } : /\bsample\b/i.test(e.text) ? { source: 'sample' as SourceKind } : {}) }))
          void $.ui.open({ id: PANE, title: 'Container' }).catch(() => undefined)
        } else if (s.active) await update($, session, x => ({ ...x, lastPrompt: e.text }))
      }
    } catch (err) { /* the prompt goes through either way */ }
    return next(e)
  })

  on('command.run', { command: 'edit-container' }, async ($, e) => {
    if (/\breset\b/i.test(e.args)) { await update($, session, () => ({ active: false, changes: [] })); return { text: 'Container Editor cleared.' } }
    const before = await read($, session)
    if (!before.active) await update($, session, (): Session => ({ active: true, changes: [] }))
    await $.ui.open({ id: PANE, title: 'Container' })
    const s = await read($, session)
    return { text: s.source ? `Editing ${s.publicId || s.name || 'a container'} (${s.source}): ${s.changes.length} changes.` : 'Choose where the container comes from in the Container pane, or say "edit my container".' }
  })

  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const s = await read($, session)
    if (!s.active) return out
    const cur = `Current session: source ${s.source || 'not chosen'}${s.publicId ? ', ' + s.publicId : ''}${s.path ? ', file ' + s.path : ''}${s.workspace ? ', workspace ' + s.workspace : ''}${s.output ? ', edits saved to ' + s.output : ''}; ${s.changes.length} changes so far.`
    return { sections: [...out.sections, { id: 'container-editor:playbook', text: PLAYBOOK + '\n\n' + cur, scope: 'session' as const }] }
  })

  on('tool.call', { tool: 'mcp__container-editor__source' }, async ($, e) => {
    try {
      const i = e as unknown as { kind: SourceKind; publicId?: string; name?: string; path?: string; workspace?: string; output?: string }
      await update($, session, s => ({ ...s, active: true, source: i.kind, publicId: i.publicId ? i.publicId.toUpperCase() : s.publicId, name: i.name ?? s.name, path: i.path ?? s.path, workspace: i.workspace ?? s.workspace, output: i.output ?? s.output }))
      return { result: { ok: true } }
    } catch (err) { return { deny: 'Could not record the source: ' + String((err as Error)?.message || err) } }
  })

  on('tool.call', { tool: 'mcp__container-editor__change' }, async ($, e) => {
    try {
      const i = e as unknown as { kind: string; summary: string; element?: string }
      const s = await update($, session, x => ({ ...x, changes: [...x.changes, { at: Date.now(), kind: i.kind, summary: String(i.summary).slice(0, 200), element: i.element }].slice(-100) }))
      $.ui.status(`GTM edits: ${s.changes.length}`)
      return { result: { ok: true, changes: s.changes.length } }
    } catch (err) { return { deny: 'Could not log the change: ' + String((err as Error)?.message || err) } }
  })

  on('tool.call', { tool: 'mcp__container-editor__sample' }, async ($, e) => {
    try {
      const i = e as unknown as { includeServer?: boolean }
      const web = await $.fs.read(`${$.plugin.root}/samples/skyline-web.json`)
      await $.fs.write('skyline-sample-web.json', web)
      const paths = ['skyline-sample-web.json']
      if (i.includeServer) { await $.fs.write('skyline-sample-server.json', await $.fs.read(`${$.plugin.root}/samples/skyline-server.json`)); paths.push('skyline-sample-server.json') }
      await update($, session, (s): Session => ({ ...s, active: true, source: 'sample', publicId: 'GTM-SKY7Q2L', name: 'skylinecharters.com (sample)', path: paths[0] }))
      return { result: { ok: true, paths, note: 'Fictional container for practice. GTM ID GTM-SKY7Q2L; it is not published anywhere.' } }
    } catch (err) { return { deny: 'Could not save the sample: ' + String((err as Error)?.message || err) } }
  })

  // Guard: no GTM publish unless the person's own latest message says "publish".
  on('tool.call', async ($, e, next) => {
    if (!PUBLISHES(e.tool)) return next(e)
    let s: Session | null = null
    try { s = await read($, session) } catch (err) { s = null }
    if (!s || !SAYS_PUBLISH.test(s.lastPrompt || '')) {
      return { deny: 'Publishing is blocked by the Container Editor: the person has not asked to publish. Show them the version and its changes, and publish only after their own message says "publish".' }
    }
    const ran = await next(e)
    try { if (!ran.isError && !('deny' in ran && ran.deny)) { await update($, session, x => ({ ...x, changes: [...x.changes, { at: Date.now(), kind: 'publish', summary: 'Published the version' }], lastPrompt: '' })); $.ui.toast('Container published.') } } catch (err) { /* best effort */ }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Input = 'Input' in ui ? ui.Input : null
    const s = await read($, session)
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 12)
    const where = s.source === 'gtm' ? 'Live container (Google sign-in)' : s.source === 'export' ? 'Exported JSON file' : s.source === 'sample' ? 'Sample container (fictional)' : 'Not chosen yet'
    return (
      <Box flexDirection="column">
        <Text bold>{s.publicId || 'GTM container'}{s.name ? ' · ' + s.name : ''}</Text>
        <Text dimColor>{where}</Text>
        {s.path ? <Text dimColor>File: {s.path}</Text> : null}
        {s.workspace ? <Text dimColor>Workspace: {s.workspace}</Text> : null}
        {s.output ? <Text dimColor>Edits saved to: {s.output}</Text> : null}
        {!s.source && s.active ? (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Where is the container?</Text>
            <Button key="pick-gtm" label="GTM ID + Google sign-in" variant={s.picking === 'gtm' ? 'primary' : 'secondary'} onPress={() => update($, session, (x: Session): Session => ({ ...x, picking: 'gtm', error: undefined }))} />
            <Button key="pick-export" label="Exported JSON file" variant={s.picking === 'export' ? 'primary' : 'secondary'} onPress={() => update($, session, (x: Session): Session => ({ ...x, picking: 'export', error: undefined }))} />
            <Button key="pick-sample" label="Sample container (practice)" onPress={() => choose($, 'sample')} />
            {s.picking === 'gtm' && Input ? <Input key="gtm-id" label="GTM ID" placeholder="GTM-ABC1234" autoFocus onSubmit={(v: string) => choose($, 'gtm', v)} /> : null}
            {s.picking === 'export' && Input ? <Input key="export-path" label="File path" placeholder="Drag the export here, or type its path" autoFocus onSubmit={(v: string) => choose($, 'export', v)} /> : null}
            {s.error ? <Text color="red">{s.error}</Text> : null}
          </Box>
        ) : null}
        <Text> </Text>
        <Text bold>Changes · {s.changes.length}</Text>
        {s.changes.length === 0 ? <Text dimColor>None yet.</Text> : null}
        {s.changes.slice(-room).map(c => <Text color={c.kind === 'publish' ? 'green' : c.kind === 'delete' ? 'red' : undefined}>{c.kind === 'publish' ? '✓' : '•'} {c.summary}</Text>)}
        <Text> </Text>
        <Text dimColor>{s.source === 'gtm' ? 'Nothing is published until you type "publish".' : s.source ? 'The original file is never overwritten.' : 'Say "edit my container" to start.'}</Text>
      </Box>
    )
  })
}
