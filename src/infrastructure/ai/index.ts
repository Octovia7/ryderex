import { config } from '../../config';
import { ConsoleAIProvider } from './ConsoleAIProvider';
import { GeminiProvider } from './GeminiProvider';
import type { AIProvider } from './AIProvider';

export type {
  AICompletionInput,
  AICompletionResult,
  AIMessage,
  AIMessageRole,
  AIProvider,
  AIToolCall,
  AIToolDefinition,
  AIToolParameterSchema,
} from './AIProvider';

// Selection is a factory keyed off config, never a concrete class imported
// by a consumer — the same real-vs-fallback pattern as Brevo/Razorpay/FCM.
//
// AI has the same fallback-safety grade as Push, not Payment/Email
// (architecture.md §16's fallback-safety table: "Push / AI ... Yes,
// degraded — warns loudly") — nothing about auth, rides, or payments
// depends on the chatbot actually working.
function createAIProvider(): AIProvider {
  if (config.ai.geminiApiKey) {
    return new GeminiProvider(
      config.ai.geminiApiKey,
      config.ai.geminiModel,
      config.supportChat.providerTimeoutSeconds,
    );
  }

  console.warn('[ai] GEMINI_API_KEY not configured — falling back to ConsoleAIProvider.');
  return new ConsoleAIProvider();
}

export const aiProvider: AIProvider = createAIProvider();
