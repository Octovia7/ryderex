import type { AICompletionInput, AICompletionResult, AIProvider } from './AIProvider';

// The local-dev fallback: logs the turn instead of calling a real model, and
// always returns a canned text reply with no tool calls — so the chatbot
// loop terminates in one round when unconfigured (steps.md §15's own
// verification: "returns a well-formed result with no tool calls"). Selected
// the same way ConsolePushProvider is (architecture.md §16's fallback-safety
// table: "Push / AI ... Yes, degraded — warns loudly"), since nothing about
// auth, rides, or payments depends on the chatbot actually working.
export class ConsoleAIProvider implements AIProvider {
  complete(input: AICompletionInput): Promise<AICompletionResult> {
    const lastUserMessage = [...input.messages]
      .reverse()
      .find((message) => message.role === 'user');

    console.log(
      `[ai:console] completion requested (${input.messages.length} messages in context) — ` +
        `last user message: "${lastUserMessage?.content ?? ''}"`,
    );

    return Promise.resolve({
      type: 'text',
      content:
        "I'm a placeholder assistant right now — no AI provider is configured, so I can't " +
        'actually look anything up. Please try again once one is.',
    });
  }
}
