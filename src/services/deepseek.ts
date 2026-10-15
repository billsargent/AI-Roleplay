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
import { Memory } from '../types';

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
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        backstory: parsed.backstory || '',
        greetingMessage: parsed.greetingMessage || '',
        customInstructions: parsed.customInstructions || '',
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        lorePieces: Array.isArray(parsed.lorePieces) ? parsed.lorePieces : [],
      };
    } catch (parseError: any) {
      console.error('Failed to parse AI-generated scenario JSON:', parseError.message);
      console.error('Raw AI output:', content);
      throw new Error('The AI returned an invalid response. Please try again with a more detailed description.');
    }
  },

  /**
   * Gets the AI's reply to the last user message of a saved chat.
   * The chat must be saved first: the server builds the prompt from it.
   *
   * @param chatId - The chat to answer
   * @param signal - Optional AbortSignal to cancel the request
   * @returns The AI's response text
   * @throws If the API call fails
   */
  async chat(chatId: string, signal?: AbortSignal): Promise<string> {
    try {
      const response = await api.post(`/chats/${chatId}/reply`, { stream: false }, { signal });
      return response.data.choices[0].message.content;
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
   * @param onChunk - Callback fired with each text chunk as it streams in
   * @param signal - Optional AbortSignal to stop the stream (Stop button, leaving the page)
   * @returns The complete assembled response text
   * @throws If the API call fails or the stream breaks
   */
  async chatStream(chatId: string, onChunk: (chunk: string) => void, signal?: AbortSignal): Promise<string> {
    const token = localStorage.getItem('fl_token');

    try {
      const response = await fetch(`/api/chats/${chatId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ stream: true }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to connect to DeepSeek API`);
      }

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
            onChunk(delta); // Deliver chunk to the UI callback
          }
        }
      }

      return fullContent;
    } catch (error: any) {
      console.error('DeepSeek streaming error:', error.message);
      throw new Error(error.message || 'Failed to connect to DeepSeek API');
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
