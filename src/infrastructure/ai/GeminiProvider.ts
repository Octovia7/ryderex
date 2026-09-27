import { randomUUID } from 'node:crypto';
import { ApiError, GoogleGenAI, Type } from '@google/genai';
import type { Content, FunctionResponse, Part, Schema, Tool } from '@google/genai';
import { AppError } from '../../shared/AppError';
import type {
  AICompletionInput,
  AICompletionResult,
  AIMessage,
  AIToolCall,
  AIToolDefinition,
} from './AIProvider';

// The SDK is taken here (unlike GeoapifyMapProvider's raw `fetch`) because the
// tool-calling wire format is intricate and easy to get subtly wrong
// (architecture.md §16: "the tool-calling wire format is intricate — and it
// is the code path enforcing the ownership boundary").
export class GeminiProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeoutSeconds: number;

  constructor(apiKey: string, model: string, timeoutSeconds: number) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
    this.timeoutSeconds = timeoutSeconds;
  }

  async complete(input: AICompletionInput): Promise<AICompletionResult> {
    const contents = toGeminiContents(input.messages);
    const tools = input.tools ? toGeminiTools(input.tools) : undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: input.systemInstruction,
          tools,
          abortSignal: controller.signal,
        },
      });

      return toCompletionResult(response);
    } catch (error) {
      throw mapGeminiError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}

// Gemini's `Schema` only needs STRING/OBJECT for the four documented tools —
// this converter is deliberately as narrow as the actual tool set, not a
// general-purpose JSON-schema translator.
function toGeminiSchema(parameters: AIToolDefinition['parameters']): Schema {
  const properties: Record<string, Schema> = {};

  for (const [key, value] of Object.entries(parameters.properties)) {
    properties[key] = { type: Type.STRING, description: value.description };
  }

  return {
    type: Type.OBJECT,
    properties,
    required: parameters.required,
  };
}

function toGeminiTools(tools: AIToolDefinition[]): Tool[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiSchema(tool.parameters),
      })),
    },
  ];
}

// Builds the full turn history Gemini expects: `user`/`model` are the only
// two roles the API recognises — a tool RESULT is sent back as a `user`
// turn containing a `functionResponse` part, never a third role (the
// long-documented Gemini function-calling convention). A `tool` message's
// function NAME isn't stored a second time on the row — it's looked up here
// from the preceding assistant message's own toolCalls by `toolCallId`, the
// same array that message already persisted.
function toGeminiContents(messages: AIMessage[]): Content[] {
  const toolNameByCallId = new Map<string, string>();
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content ?? '' }] });
      continue;
    }

    if (message.role === 'assistant') {
      if (message.toolCalls && message.toolCalls.length > 0) {
        for (const call of message.toolCalls) {
          toolNameByCallId.set(call.id, call.name);
        }

        contents.push({
          role: 'model',
          parts: message.toolCalls.map((call) => toGeminiFunctionCallPart(call)),
        });
      } else {
        contents.push({ role: 'model', parts: [{ text: message.content ?? '' }] });
      }
      continue;
    }

    // role === 'tool'
    const name = message.toolCallId ? toolNameByCallId.get(message.toolCallId) : undefined;
    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: toGeminiFunctionResponse(
            message.toolCallId,
            name ?? 'unknown_tool',
            message.content,
          ),
        },
      ],
    });
  }

  return contents;
}

function toGeminiFunctionCallPart(call: AIToolCall): Part {
  return {
    functionCall: { id: call.id, name: call.name, args: call.arguments },
    thoughtSignature: call.providerState,
  };
}

// Gemini rejects a non-object `functionResponse.response` ("Proto field is
// not repeating, cannot start list") — our own tool results are frequently
// JSON arrays (e.g. `getMyRecentBookings` returns `[]`). Anything that isn't
// already a plain object is wrapped as `{ result: ... }`.
function toGeminiFunctionResponse(
  id: string | undefined,
  name: string,
  content: string | undefined,
): FunctionResponse {
  let parsed: unknown = null;

  if (content !== undefined) {
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = content;
    }
  }

  const response =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { result: parsed };

  return { id, name, response };
}

// Reads the raw candidate parts directly — NOT `response.functionCalls`,
// the SDK's own flattened getter, which silently drops `thoughtSignature`
// (architecture.md §16).
function toCompletionResult(response: {
  candidates?: Array<{ content?: { parts?: Part[] } }>;
  usageMetadata?: { totalTokenCount?: number };
}): AICompletionResult {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const totalTokens = response.usageMetadata?.totalTokenCount;

  const functionCallParts = parts.filter((part) => part.functionCall);

  if (functionCallParts.length > 0) {
    const toolCalls: AIToolCall[] = functionCallParts.map((part) => ({
      id: part.functionCall?.id ?? randomUUID(),
      name: part.functionCall?.name ?? '',
      arguments: part.functionCall?.args ?? {},
      providerState: part.thoughtSignature,
    }));

    return { type: 'tool_calls', toolCalls, totalTokens };
  }

  const text = parts
    .filter((part) => part.text !== undefined && !part.thought)
    .map((part) => part.text)
    .join('');

  return { type: 'text', content: text, totalTokens };
}

// Controlled mapping only — never the raw provider error message or any
// part of the request (which could carry the API key in a URL, the same
// discipline map-provider errors already follow). `cause` carries the
// original error for logs only, never serialized into a response.
function mapGeminiError(error: unknown): AppError {
  if (error instanceof Error && error.name === 'AbortError') {
    return new AppError({
      statusCode: 504,
      code: 'AI_PROVIDER_TIMEOUT',
      message: 'The AI assistant took too long to respond.',
      cause: error,
    });
  }

  if (error instanceof ApiError && error.status === 429) {
    // Deliberately not forwarded as a 429 to our own client — SaathiRide's
    // own per-user limits govern the caller, not the vendor's quota.
    return new AppError({
      statusCode: 503,
      code: 'AI_PROVIDER_RATE_LIMITED',
      message: 'The AI assistant is temporarily unavailable. Please try again shortly.',
      cause: error,
    });
  }

  return new AppError({
    statusCode: 502,
    code: 'AI_PROVIDER_ERROR',
    message: 'The AI assistant could not process this request.',
    cause: error,
  });
}
