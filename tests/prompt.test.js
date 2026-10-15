/**
 * Unit tests for the server-side prompt builder (lib/prompt.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatPrompt, buildMemoryPrompt, buildScenarioGenerationPrompt, readLlmSettings, responseTokensFor } from '../lib/prompt.js';

const llm = readLlmSettings(() => '');
const scenario = {
  backstory: 'A harbour town where {{user}} arrives.',
  customInstructions: '',
  characters: [{ name: 'Mara', description: 'Ferry keeper', personality: 'Dry wit' }],
  lorePieces: [
    { title: 'Lighthouse', content: 'Always lit.', pinned: true, smartActivation: false, triggers: [] },
    { title: 'Curse', content: 'Bound to the tide.', pinned: false, smartActivation: true, triggers: ['tide'] },
  ],
};
const chat = (over = {}) => ({
  settings: { responseLength: 'short', customInstructions: '' },
  userCharacter: { name: 'Rin', description: 'A wanderer' },
  memories: [],
  messages: [],
  ...over,
});

test('defaults when nothing is configured', () => {
  assert.equal(llm.temperature, 1.3);
  assert.equal(llm.memorySendInterval, 25);
  assert.equal(responseTokensFor('long', llm), 2000);
  assert.equal(responseTokensFor(undefined, llm), 800);
});

test('chat prompt: system prompt, history, then global rules last', () => {
  const messages = [{ role: 'user', content: 'I watch the tide, says {{user}}' }];
  const { messages: out, maxTokens } = buildChatPrompt({ messages, scenario, chat: chat({ messages }), llm });
  assert.equal(maxTokens, 300);
  assert.equal(out.length, 3);
  assert.match(out[0].content, /A harbour town where Rin arrives\./);
  assert.match(out[0].content, /- Lighthouse: Always lit\./);
  assert.match(out[0].content, /- Curse: Bound to the tide\./, 'triggered lore is included');
  assert.equal(out[1].content, 'I watch the tide, says Rin');
  assert.match(out[2].content, /^--- GLOBAL LLM INSTRUCTIONS/);
  assert.match(out[2].content, /Never speak for or act as Rin\./);
});

test('untriggered smart lore is left out', () => {
  const messages = [{ role: 'user', content: 'Hello' }];
  const { messages: out } = buildChatPrompt({ messages, scenario, chat: chat({ messages }), llm });
  assert.ok(!out[0].content.includes('Curse'));
});

test('memory and scenario generation prompts', () => {
  const m = buildMemoryPrompt([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 80);
  assert.match(m.messages[0].content, /max 80 words/);
  assert.equal(m.messages[1].content, 'user: a\nassistant: b');
  assert.equal(m.maxTokens, 160);
  const g = buildScenarioGenerationPrompt('Pirates');
  assert.equal(g.messages[1].content, 'Pirates');
  assert.equal(g.maxTokens, 4000);
});
