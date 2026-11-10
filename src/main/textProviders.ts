import { TEXT_PROVIDER_NAMES, type TextProviderId, type TextUsage } from '../shared/ipc.ts'
import { parseAnthropicResponse } from '../shared/anthropic.ts'
import { parseResponsesOutput } from '../shared/text.ts'
import { createAnthropicMessage } from './anthropic.ts'
import { createTextResponse, type OpenAIResult } from './openai.ts'

/**
 * One interface for every typed-reply provider. Adding a provider = one entry here plus its
 * request builder in src/shared. Request bodies are built by shared/text.ts buildProviderRequest.
 */
export interface TextProvider {
  id: TextProviderId
  name: string
  send(key: string, body: Record<string, unknown>): Promise<OpenAIResult<unknown>>
  parse(json: unknown): { text: string; usage: TextUsage; incomplete: string | null }
}

export const TEXT_PROVIDER_IMPLS: Record<TextProviderId, TextProvider> = {
  openai: { id: 'openai', name: TEXT_PROVIDER_NAMES.openai, send: createTextResponse, parse: parseResponsesOutput },
  anthropic: { id: 'anthropic', name: TEXT_PROVIDER_NAMES.anthropic, send: createAnthropicMessage, parse: parseAnthropicResponse },
}
