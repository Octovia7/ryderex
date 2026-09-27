// The SaathiRide-owned AI strategy interface (architecture.md §16/§17) —
// mirrors MapProvider/PaymentProvider exactly: the domain never imports a
// vendor SDK, only this interface. A single method, `complete`, matching
// architecture.md's own interface table (`AIProvider | complete`).

export type AIMessageRole = 'user' | 'assistant' | 'tool';

// One entry per persisted SupportMessage row, replayed to the provider on
// every turn. `toolCalls` is only ever set on an `assistant` message that
// requested tool calls; `toolCallId` is only ever set on a `tool` message
// (which of the preceding assistant message's toolCalls it answers).
export interface AIMessage {
  role: AIMessageRole;
  content?: string;
  toolCalls?: AIToolCall[];
  toolCallId?: string;
}

// A provider-agnostic JSON-schema-shaped tool declaration — never the
// vendor's own `FunctionDeclaration`/`Schema` types. `additionalProperties:
// false` on every tool (architecture.md §18's security control list) is the
// caller's responsibility, not this interface's.
export interface AIToolParameterSchema {
  type: 'object';
  properties: Record<string, { type: 'string'; description?: string }>;
  required: string[];
  additionalProperties: false;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: AIToolParameterSchema;
}

// A tool call the model requested. `arguments` is always a plain object —
// never re-interpreted as JSON here, the provider already parsed it.
// `providerState` is an opaque, vendor-specific field (architecture.md §16:
// "AIToolCall.providerState exists because newer Gemini models reject a
// functionCall replayed on a later turn unless its original
// thought_signature is echoed back") — persisted and replayed verbatim by
// the service, never interpreted by it. Providers that don't need it never
// set it.
export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  providerState?: string;
}

export type AICompletionResult =
  | { type: 'text'; content: string; totalTokens?: number }
  | { type: 'tool_calls'; toolCalls: AIToolCall[]; totalTokens?: number };

export interface AICompletionInput {
  systemInstruction: string;
  messages: AIMessage[];
  // Omitted entirely (not an empty array) on the final, budget-exhausted
  // completion — architecture.md §17: "on exhaustion, one final completion
  // with the tools WITHHELD — the model must answer from what is already in
  // context."
  tools?: AIToolDefinition[];
}

export interface AIProvider {
  complete(input: AICompletionInput): Promise<AICompletionResult>;
}
