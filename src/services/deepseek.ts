/**
 * DeepSeek AI Integration Service
 *
 * Thin client for the server's AI endpoints. The server builds every prompt
 * (world, cast, lore, memories, global instructions; see lib/prompt.js) from
 * the stored chat and scenario, and keeps the API key. The browser only says
 * which chat to answer, so the global instructions cannot be bypassed.
 *
 * Includes:
 * - Non-streaming and streaming (SSE) replies for a saved chat
 * - Memory card generation for a saved chat
 * - Scenario draft generation from a description
 *
 * @module deepseek
 */

import { api } from './api';
import { Memory, ReplyContext } from '../types';

/**
 * Interface for the JSON structure returned by the LLM during scenario generation.
 */
export interface AiGeneratedScenarioData {
  name: string;
  description: string;
  tags: string[];
  backstory: string;
  greetingMessage: string;
  customInstructions: string;
  characters: Array<{
    name: string;
    description: string;
    personality: string;
  }>;
  lorePieces: Array<{
    type: string;
    title: string;
    content: string;
    triggers: string[];
  }>;
}

/**
 * What to ask the reply endpoint for:
 * - reply: answer the user's last message
 * - regenerate: a new version of the last AI message
 * - continue: more of the last AI message
 * - opening: the first message of a chat with no conversation yet
 */
export type ReplyMode = 'reply' | 'regenerate' | 'continue' | 'opening';

/** Result of a reply request */
export interface ReplyResult {
  content: string;
  /** "length" when the reply hit the token limit (it was cut off) */
  finishReason?: string;
  /**
   * For continue: "prefix" means the text follows on exactly; "instruct"
   * means it is a new piece of text that may need a space before it
   */
  continueMode?: 'prefix' | 'instruct';
  /** What the AI was given for this reply */
  context?: ReplyContext;
}

/** Reads the X-Reply-Context header (URI-encoded JSON) */
function parseReplyContext(header: string | null | undefined): ReplyContext | undefined {
  if (!header) return undefined;
  try {
    const v = JSON.parse(decodeURIComponent(header));
    return {
      memoryIds: Array.isArray(v.memoryIds) ? v.memoryIds.filter((x: unknown) => typeof x === 'string') : [],
      lore: Array.isArray(v.lore) ? v.lore.filter((x: unknown) => typeof x === 'string') : [],
      hiddenLore: Number(v.hiddenLore) || 0,
      listed: Number(v.listed) || 0,
      omitted: Number(v.omitted) || 0,
    };
  } catch {
    return undefined;
  }
}

/** Editor fields AI Enhance works on (the server keeps the same list) */
export type EnhanceField = 'description' | 'backstory' | 'greeting' | 'customInstructions' | 'characterDescription' | 'characterPersonality' | 'loreContent';

/** What the lore suggester reads from the editor */
export interface LoreSuggestDraft {
  name: string;
  description: string;
  backstory: string;
  /** Plain text of the introduction (no HTML or images) */
  introduction: string;
  customInstructions: string;
  characters: Array<{ name: string; description: string }>;
  loreTitles: string[];
}

/** A lore card proposed by the AI (validated by the server) */
export interface LoreSuggestion {
  title: string;
  type: 'location' | 'event' | 'object' | 'character' | 'other';
  content: string;
  triggers: string[];
  mode: 'triggered' | 'always';
}

/** A trimmed string, or '' for anything that is not a string (AI output is untrusted) */
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Turns an axios error into a readable message */
function errorMessage(error: any, fallback: string): string {
  return error?.response?.data?.error || error?.message || fallback;
}

export const deepseek = {
  /**
   * Uses the AI to generate a complete scenario draft from a natural language description.
   *
   * @param userDescription - The user's natural language description of the desired scenario
   * @returns The parsed AI-generated scenario data
   * @throws If the API call fails or the response JSON is invalid
   */
  async generateScenario(userDescription: string): Promise<AiGeneratedScenarioData> {
    let content: string;
    try {
      const response = await api.post('/deepseek/generate', { description: userDescription });
      content = response.data.choices[0].message.content;
    } catch (error: any) {
      throw new Error(errorMessage(error, 'Failed to generate a scenario'));
    }

    // Strip any markdown code block fences the LLM might wrap the JSON in
    const jsonStr = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(jsonStr);
      // Validate required fields exist
      if (!parsed.name || !parsed.backstory) {
        throw new Error('Generated scenario is missing required fields (name, backstory).');
      }
      return {
        name: parsed.name || '',
        description: parsed.description || '',
        tags: (Array.isArray(parsed.tags) ? parsed.tags : []).map(text).filter(Boolean),
        backstory: parsed.backstory || '',
        greetingMessage: parsed.greetingMessage || '',
        customInstructions: parsed.customInstructions || '',
        characters: (Array.isArray(parsed.characters) ? parsed.characters : [])
          .filter((c: any) => c && typeof c === 'object' && text(c.name))
          .map((c: any) => ({ name: text(c.name), description: text(c.description), personality: text(c.personality) })),
        lorePieces: (Array.isArray(parsed.lorePieces) ? parsed.lorePieces : [])
          .filter((p: any) => p && typeof p === 'object' && (text(p.title) || text(p.content)))
          .map((p: any) => ({
            type: text(p.type) || 'other',
            title: text(p.title),
            content: text(p.content),
            triggers: (Array.isArray(p.triggers) ? p.triggers : []).map(text).filter(Boolean),
          })),
      };
    } catch (parseError: any) {
      console.error('Failed to parse AI-generated scenario JSON:', parseError.message);
      console.error('Raw AI output:', content);
      throw new Error('The AI returned an invalid response. Please try again with a more detailed description.');
    }
  },

  /**
   * Gets AI text for a saved chat (see ReplyMode).
   * The chat must be saved first: the server builds the prompt from it.
   *
   * @param chatId - The chat to answer
   * @param signal - Optional AbortSignal to cancel the request
   * @param mode - What to generate (default: answer the user's last message)
   * @throws If the API call fails
   */
  async chat(chatId: string, signal?: AbortSignal, mode: ReplyMode = 'reply'): Promise<ReplyResult> {
    try {
      const response = await api.post(`/chats/${chatId}/reply`, { stream: false, mode }, { signal });
      const choice = response.data.choices?.[0];
      return {
        content: choice?.message?.content || '',
        finishReason: choice?.finish_reason,
        continueMode: response.headers?.['x-continue-mode'],
        context: parseReplyContext(response.headers?.['x-reply-context']),
      };
    } catch (error: any) {
      console.error('DeepSeek API error:', error.response?.data || error.message);
      throw new Error(errorMessage(error, 'Failed to connect to DeepSeek API'));
    }
  },

  /**
   * Streams the AI's reply (Server-Sent Events) to the last user message of
   * a saved chat. Each text chunk is delivered via onChunk as it arrives.
   *
   * Uses fetch (not axios) for stream handling, with the JWT from localStorage.
   *
   * @param chatId - The chat to answer
   * @param onChunk - Callback fired with each text chunk as it streams in,
   *   with the continue mode (for continue requests) known from the headers
   * @param signal - Optional AbortSignal to stop the stream (Stop button, leaving the page)
   * @param mode - What to generate (default: answer the user's last message)
   * @returns The complete assembled text and why it ended
   * @throws If the API call fails or the stream breaks
   */
  async chatStream(
    chatId: string,
    onChunk: (chunk: string, continueMode?: ReplyResult['continueMode']) => void,
    signal?: AbortSignal,
    mode: ReplyMode = 'reply',
  ): Promise<ReplyResult> {
    const token = localStorage.getItem('fl_token');

    try {
      const response = await fetch(`/api/chats/${chatId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ stream: true, mode }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to connect to DeepSeek API`);
      }
      const continueMode = (response.headers.get('X-Continue-Mode') || undefined) as ReplyResult['continueMode'];
      let finishReason: string | undefined;

      // Read the stream using the ReadableStream API
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body for streaming');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode the incoming chunk and split by newlines (SSE format)
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue; // Stream termination signal

          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // Skip malformed SSE chunks
          }
          // The server sends an error event if the stream breaks part-way
          if (parsed.error) {
            throw new Error(parsed.error.message || 'The AI response was interrupted');
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onChunk(delta, continueMode); // Deliver chunk to the UI callback
          }
          // The last chunk says why the reply ended ("length" = cut off)
          if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
        }
      }

      return { content: fullContent, finishReason, continueMode, context: parseReplyContext(response.headers.get('X-Reply-Context')) };
    } catch (error: any) {
      console.error('DeepSeek streaming error:', error.message);
      throw new Error(error.message || 'Failed to connect to DeepSeek API');
    }
  },

  /**
   * Asks the AI to propose lore cards for a scenario draft (saved or not).
   * Nothing is stored; the author picks which cards to add.
   *
   * @param draft - The editor's current fields; introduction as plain text
   * @param focus - Optional wish, e.g. "factions" or "the harbour"
   * @throws With the server's message if nothing usable came back
   */
  async suggestLore(draft: LoreSuggestDraft, focus = ''): Promise<LoreSuggestion[]> {
    try {
      const response = await api.post('/deepseek/lore-suggest', { draft, focus });
      return Array.isArray(response.data?.suggestions) ? response.data.suggestions : [];
    } catch (error: any) {
      throw new Error(errorMessage(error, 'Could not get lore suggestions'));
    }
  },

  /**
   * AI Enhance: returns an improved version of one editor field for the
   * author to accept or not ("fix" = spelling, grammar, clarity only).
   * @throws With the server's message on failure
   */
  async enhanceText(field: EnhanceField, text: string, context: { name?: string; description?: string }, mode: 'fix' | 'vivid' = 'fix'): Promise<string> {
    try {
      const response = await api.post('/deepseek/enhance', { field, text, context, mode });
      return String(response.data?.text || '');
    } catch (error: any) {
      throw new Error(errorMessage(error, 'Could not enhance the text'));
    }
  },

  /**
   * Asks the server for a memory card covering everything since the previous
   * memory of a saved chat. With auto, the server only writes one when enough
   * new user messages arrived (admin setting) and otherwise returns nothing.
   *
   * @param chatId - The chat to summarise
   * @param auto - Only if due (after a reply), instead of on request
   * @returns The new memory (not yet added to the chat), or null
   */
  async generateMemory(chatId: string, auto = false): Promise<Memory | null> {
    try {
      const response = await api.post(`/chats/${chatId}/memory`, { auto });
      return response.data?.memory || null;
    } catch (error) {
      console.error('Failed to generate memory:', error);
      return null; // Memory generation is non-critical
    }
  },
};
