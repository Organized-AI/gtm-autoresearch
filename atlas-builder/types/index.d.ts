export type StepStatus = 'todo' | 'active' | 'you' | 'done' | 'skipped' | 'blocked'
export type StepState = { id: string; status: StepStatus; note?: string }
export type Build = {
  active: boolean
  startedAt?: number
  steps: StepState[]
  jev?: 'own' | 'hosted'
  url?: string
}

declare module 'claude-code' {
  interface PluginState {
    'atlas-builder': { build: Build }
  }
}
