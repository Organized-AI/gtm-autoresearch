export type SourceKind = 'gtm' | 'export' | 'sample'
export type Change = { at: number; kind: string; summary: string; element?: string }
export type Session = {
  active: boolean
  source?: SourceKind
  publicId?: string
  name?: string
  path?: string
  workspace?: string
  output?: string
  changes: Change[]
  lastPrompt?: string
  picking?: SourceKind
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'container-editor': { session: Session }
  }
}
