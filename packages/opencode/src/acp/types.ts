import type { McpServer } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

export interface ProofBinding {
  file: string
  position: { line: number; character: number }
  updated: number
  stale: boolean
}

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
  modeId?: string
  proof?: ProofBinding
}

export interface ACPConfig {
  sdk: OpencodeClient
  defaultModel?: {
    providerID: string
    modelID: string
  }
}
