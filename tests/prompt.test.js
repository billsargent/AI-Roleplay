/**
 * Unit tests for the server-side prompt builder (lib/prompt.js):
 * lore selection (#14), rolling memories (#13), history budget (#12),
 * prompt cleanups (#15).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatPrompt, buildMemoryPrompt, buildScenarioGenerationPrompt, readLlmSettings, responseTokensFor,
  triggerMatches, selectLore, selectHistory, estimateTokens, memoryDue, messagesSinceLastMemory, htmlToText, stopSequencesFor,
  parseLoreSuggestions, buildLoreSuggestPrompt, buildEnhancePrompt, cleanEnhanced,
} from '../lib/prompt.js';

const llm = readLlmSettings(() => '');
const lore = (title, over = {}) => ({ title, content: `${title} lore.`, pinned: false, smartActivation: true, triggers: [], weight: 100, ...over });
const scenario = (over = {}) => ({
  backstory: 'A harbour town where {{user}} arrives.',
  customInstructions: '',
  characters: [{ name: 'Mara', description: 'Ferry keeper.', personality: 'Dry wit.' }],
  lorePieces: [lore('Lighthouse', { pinned: true, smartActivation: false }), lore('Curse', { triggers: ['tide'] })],
  settings: {},
  ...over,
});
const chat = (over = {}) => ({
  settings: { responseLength: 'short', customInstructions: '' },
  userCharacter: { name: 'Rin', description: 'A wanderer' },
  memories: [],
  messages: [],
  ...over,
});
const msg = (role, content, timestamp = 0) => ({ role, content, timestamp });

test('defaults when nothing is configured', () => {
  assert.equal(llm.temperature, 1.0);
  assert.equal(llm.utilityTemperature, 0.5);
  assert.equal(llm.stopOnPlayerLines, true);
  assert.equal(llm.memoryGenerateInterval, 25);
  assert.equal(llm.contextTokenBudget, 32000);
  assert.equal(llm.loreActiveMax, 5);
  assert.equal(responseTokensFor('long', llm), 2000);
  assert.equal(responseTokensFor(undefined, llm), 800);
});

// ── Prompt layout and cleanups (#15) ──
test('system prompt, history, then global rules last', () => {
  const messages = [msg('user', 'I watch the tide, says {{user}}')];
  const { messages: out, maxTokens } = buildChatPrompt({ messages, scenario: scenario(), chat: chat(), llm });
  assert.equal(maxTokens, 300);
  assert.equal(out.length, 3);
  assert.match(out[0].content, /A harbour town where Rin arrives\./);
  assert.equal(out[1].content, 'I watch the tide, says Rin');
  assert.match(out[2].content, /^--- GLOBAL LLM INSTRUCTIONS/);
  assert.match(out[2].content, /Never speak for or act as Rin\./);
});

test('cast lines have no doubled punctuation', () => {
  const { messages: out } = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario(), chat: chat(), llm });
  assert.match(out[0].content, /- Mara: Ferry keeper\. Personality: Dry wit\./);
  assert.ok(!out[0].content.includes('..'));
});

test('length guidance is concrete', () => {
  const { messages: out } = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario(), chat: chat(), llm });
  assert.match(out[2].content, /Length: about 210 words or fewer \(short\)/);
});

test('the asterisk formatting rule can be turned off per scenario', () => {
  const on = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario(), chat: chat(), llm }).messages[2].content;
  const off = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario({ settings: { asteriskFormatting: false } }), chat: chat(), llm }).messages[2].content;
  assert.match(on, /\*asterisks\*/);
  assert.ok(!off.includes('*asterisks*'));
});

test('system notices in the chat are not sent to the AI', () => {
  const messages = [msg('assistant', 'Hello'), msg('system', '[System: Persona changed]'), msg('user', 'Hi')];
  const { messages: out } = buildChatPrompt({ messages, scenario: scenario(), chat: chat(), llm });
  assert.ok(!out.some(m => m.content.includes('Persona changed')));
  assert.equal(out.length, 4);
});

test('the introduction is sent only when the author opts in', () => {
  const s = { introduction: '<h1>Welcome</h1><p>The &quot;fog&quot; rolls in.</p>' };
  const off = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario(s), chat: chat(), llm }).messages[0].content;
  const on = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario({ ...s, settings: { sendIntroduction: true } }), chat: chat(), llm }).messages[0].content;
  assert.ok(!off.includes('fog'));
  assert.match(on, /SCENARIO INTRODUCTION[\s\S]*Welcome\nThe "fog" rolls in\./);
  assert.equal(htmlToText('<p>a</p><p>b&amp;c</p>'), 'a\nb&c');
});

// ── Lore (#14) ──
test('triggers match whole words only, case-insensitive, any script', () => {
  assert.equal(triggerMatches('Art is long', 'art'), true);
  assert.equal(triggerMatches('what a party', 'art'), false);
  assert.equal(triggerMatches('the Dark Forest looms', 'dark forest'), true);
  assert.equal(triggerMatches('a café opens', 'café'), true);
  assert.equal(triggerMatches('cafés', 'café'), false);
  assert.equal(triggerMatches('price (5$)', '5$'), true, 'regex characters are literal');
  assert.equal(triggerMatches('anything', ''), false);
});

test('only recent messages trigger lore', () => {
  const pieces = [lore('Curse', { triggers: ['tide'] })];
  const old = [msg('user', 'the tide rises'), ...Array.from({ length: 10 }, () => msg('assistant', 'quiet'))];
  assert.equal(selectLore(pieces, old, [], llm).triggered.length, 0, 'mentioned 11 messages ago');
  assert.equal(selectLore(pieces, old.slice(-5).concat(msg('user', 'tide!')), [], llm).triggered.length, 1);
});

test('lore is ordered by weight and capped', () => {
  const pieces = Array.from({ length: 8 }, (_, i) => lore(`L${i}`, { triggers: ['go'], weight: i * 10 }));
  const { triggered } = selectLore(pieces, [msg('user', 'go')], [], llm);
  assert.deepEqual(triggered.map(p => p.title), ['L7', 'L6', 'L5', 'L4', 'L3']);
  const pinned = Array.from({ length: 12 }, (_, i) => lore(`P${i}`, { pinned: true }));
  assert.equal(selectLore(pinned, [], [], llm).pinned.length, 10);
});

test('linked lore is sent right after the piece that brought it in', () => {
  const pieces = [
    lore('Ship', { id: 's', triggers: ['ship'], linkedPieces: ['c', 'gone'] }),
    lore('Captain', { id: 'c', smartActivation: false }), // draft: only sent through the link
    lore('Port', { id: 'p', pinned: true, smartActivation: false, linkedPieces: ['c'] }),
  ];
  const { pinned, triggered } = selectLore(pieces, [msg('user', 'board the ship')], [], llm);
  assert.deepEqual(pinned.map(p => p.title), ['Port', 'Captain']);
  assert.deepEqual(triggered.map(p => p.title), ['Ship'], 'Captain already sent; unknown ids ignored');
  // Links count toward the cap
  const capped = selectLore(pieces.slice(0, 2), [msg('user', 'ship')], [], { ...llm, loreActiveMax: 1 });
  assert.deepEqual(capped.triggered.map(p => p.title), ['Ship']);
});

test('character lore that repeats a cast member is skipped', () => {
  const pieces = [lore('Mara', { type: 'character', pinned: true }), lore('Harbour', { pinned: true })];
  const { pinned } = selectLore(pieces, [], [{ name: 'Mara' }], llm);
  assert.deepEqual(pinned.map(p => p.title), ['Harbour']);
});

// ── Memories (#13) ──
test('all memories are sent every turn, oldest first', () => {
  const memories = [
    { content: 'Second', pinned: false, timestamp: 2 },
    { content: 'Key fact', pinned: true, timestamp: 0 },
    { content: 'First', pinned: false, timestamp: 1 },
  ];
  const sys = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario(), chat: chat({ memories }), llm }).messages[0].content;
  assert.match(sys, /- \[PINNED\] Key fact\n- First\n- Second/);
  assert.ok(!sys.includes('memories available'));
});

test('a memory covers everything since the previous one', () => {
  const messages = [
    msg('user', 'a', 1), msg('assistant', 'b', 2), msg('user', 'c', 3), msg('system', 'notice', 4),
    msg('user', '*continue*', 5), msg('assistant', 'd', 6),
  ];
  const c = chat({ messages, memories: [{ content: 'm', pinned: false, timestamp: 99, coveredUntil: 2 }] });
  assert.deepEqual(messagesSinceLastMemory(c).map(m => m.content), ['c', 'd']);
  // Older memories without coveredUntil count from when they were made
  assert.deepEqual(messagesSinceLastMemory(chat({ messages, memories: [{ content: 'm', timestamp: 5 }] })).map(m => m.content), ['d']);
  // A memory the player wrote does not count as a summary
  assert.deepEqual(messagesSinceLastMemory(chat({ messages, memories: [{ content: 'note', timestamp: 99, source: 'user' }] })).map(m => m.content), ['a', 'b', 'c', 'd']);
});

test('a memory is due after enough real user messages since the last one', () => {
  const few = { ...llm, memoryGenerateInterval: 3 };
  const messages = [msg('user', 'a', 1), msg('user', '*continue*', 2), msg('user', 'b', 3)];
  assert.equal(memoryDue(chat({ messages }), few), false, '*continue* does not count');
  assert.equal(memoryDue(chat({ messages: [...messages, msg('user', 'c', 4)] }), few), true);
  assert.equal(memoryDue(chat({ messages: [...messages, msg('user', 'c', 4)], memories: [{ timestamp: 9, coveredUntil: 4 }] }), few), false);
});

test('memory prompt summarises the given messages', () => {
  const m = buildMemoryPrompt([msg('user', 'a'), msg('assistant', 'b')], 80);
  assert.match(m.messages[0].content, /max 80 words/);
  assert.equal(m.messages[1].content, 'user: a\nassistant: b');
  assert.equal(m.maxTokens, 160);
});

// ── History budget (#12) ──
test('token estimate is conservative for English and other scripts', () => {
  assert.ok(estimateTokens('hello world') >= 3);
  assert.ok(estimateTokens('こんにちは') >= 5);
});

test('the newest history that fits the budget is sent, the rest is noted', () => {
  const long = 'word '.repeat(400); // ~ 570 tokens each
  const messages = Array.from({ length: 200 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `${i}: ${long}`));
  const small = { ...llm, contextTokenBudget: 12000 };
  const { messages: out, omitted } = buildChatPrompt({ messages, scenario: scenario(), chat: chat(), llm: small });
  assert.ok(omitted > 150, `omitted ${omitted}`);
  assert.ok(out[1].content.startsWith(`${omitted}: `), 'history starts right after the omitted part');
  assert.ok(out[out.length - 2].content.startsWith('199: '), 'the newest message is always sent');
  assert.match(out[0].content, new RegExp(`NOTE: The ${omitted} earliest messages`));
  const total = out.reduce((n, m) => n + estimateTokens(m.content), 0) + 300;
  assert.ok(total <= 12000, `prompt ~${total} tokens`);
  // A short chat sends everything and no note
  const short = buildChatPrompt({ messages: messages.slice(-4), scenario: scenario(), chat: chat(), llm });
  assert.equal(short.omitted, 0);
  assert.ok(!short.messages[0].content.includes('NOTE:'));
});

test('selectHistory always keeps the last message', () => {
  const { history } = selectHistory([msg('user', 'x'.repeat(100000))], 10);
  assert.equal(history.length, 1);
});

// ── Stop sequences (#34) ──
test('replies stop when the AI starts a line for the player', () => {
  const { stop } = buildChatPrompt({ messages: [msg('user', 'hi')], scenario: scenario(), chat: chat(), llm });
  assert.deepEqual(stop, ['\nRin:', '\n**Rin:**']);
  const custom = readLlmSettings(k => ({ stopOnPlayerLines: 'false', stopSequences: '\\n{{user}} says\r\nTHE END\n\n' })[k] || '');
  assert.deepEqual(stopSequencesFor(custom, 'Rin'), ['\nRin says', 'THE END']);
  const many = { ...llm, stopSequences: Array.from({ length: 30 }, (_, i) => `s${i}`) };
  assert.equal(stopSequencesFor(many, 'Rin').length, 16);
});

// ── Reply modes (#18, #19) ──
test('continue with prefix ends with the unfinished reply', () => {
  const messages = [msg('user', 'Tell {{user}} a tale'), msg('assistant', 'Once, {{user}} sailed')];
  const { messages: out } = buildChatPrompt({ messages, scenario: scenario(), chat: chat(), llm, mode: 'continue', prefix: true });
  assert.deepEqual(out[out.length - 1], { role: 'assistant', content: 'Once, Rin sailed', prefix: true });
  assert.match(out[out.length - 2].content, /^--- GLOBAL LLM INSTRUCTIONS/);
  assert.equal(out[out.length - 3].content, 'Tell Rin a tale');
});

test('continue without prefix asks the model to carry on', () => {
  const messages = [msg('user', 'Go on'), msg('assistant', 'The door')];
  const { messages: out } = buildChatPrompt({ messages, scenario: scenario(), chat: chat(), llm, mode: 'continue' });
  assert.equal(out[out.length - 2].content, 'The door');
  assert.match(out[out.length - 1].content, /GLOBAL LLM INSTRUCTIONS[\s\S]*CONTINUATION/);
  assert.ok(!out.some(m => m.prefix));
});

test('opening sends a request for the first scene and no history', () => {
  const { messages: out } = buildChatPrompt({ messages: [], scenario: scenario(), chat: chat(), llm, mode: 'opening' });
  assert.equal(out.length, 3);
  assert.equal(out[1].role, 'user');
  assert.match(out[1].content, /The story begins now/);
});

// ── Lore suggestions (#35) ──
test('lore suggestions are validated', () => {
  const text = '```json\n' + JSON.stringify({ lore: [
    { title: ' Bell ', type: 'weird', content: ' Rings. ', triggers: ['bell', 'bell', ' toll '], mode: 'triggered' },
    { title: 'Core', type: 'event', content: 'Always true.', triggers: [], mode: 'always' },
    { title: 'bell', content: 'Repeat of a title', triggers: ['x'] },
    { title: 'Pier', content: 'Exists already', triggers: ['pier'] },
    { title: 'Quiet', content: 'No triggers', triggers: [] },
    { title: '', content: 'No title', triggers: ['y'] },
    null, 'text',
  ] }) + '\n```';
  assert.deepEqual(parseLoreSuggestions(text, ['PIER']), [
    { title: 'Bell', type: 'other', content: 'Rings.', triggers: ['bell', 'toll'], mode: 'triggered' },
    { title: 'Core', type: 'event', content: 'Always true.', triggers: [], mode: 'always' },
  ]);
  assert.deepEqual(parseLoreSuggestions('not json'), []);
  const many = JSON.stringify({ lore: Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, content: 'c', triggers: ['t'] })) });
  assert.equal(parseLoreSuggestions(many).length, 8);
});

test('lore suggestion prompt includes the draft and the focus', () => {
  const { messages } = buildLoreSuggestPrompt({ name: 'N', backstory: 'B', characters: [{ name: 'Mara', description: 'Keeper' }], loreTitles: ['Pier'] }, 'ships');
  assert.match(messages[0].content, /JSON object/);
  assert.match(messages[1].content, /BACKSTORY:\nB/);
  assert.match(messages[1].content, /- Mara: Keeper/);
  assert.match(messages[1].content, /- Pier/);
  assert.match(messages[1].content, /CARDS ABOUT: ships/);
});

// ── AI Enhance (#37) ──
test('enhanced text is unwrapped from fences and whole-text quotes only', () => {
  assert.equal(cleanEnhanced('```\nFixed text.\n```'), 'Fixed text.');
  assert.equal(cleanEnhanced('"Fixed text."'), 'Fixed text.');
  assert.equal(cleanEnhanced('"Hi," she said. "Bye."'), '"Hi," she said. "Bye."', 'dialogue keeps its quotes');
  assert.equal(cleanEnhanced('  '), '');
});

test('enhance prompt keeps placeholders and sizes the reply to the text', () => {
  const p = buildEnhancePrompt('loreContent', 'a'.repeat(1000));
  assert.match(p.messages[0].content, /\{\{user\}\}/);
  assert.match(p.messages[0].content, /lore card/);
  assert.equal(p.maxTokens, 700);
  assert.equal(p.temperature, 0.3);
  assert.equal(buildEnhancePrompt('backstory', 'x', {}, 'vivid').temperature, 0.8);
});

test('scenario generation prompt', () => {
  const g = buildScenarioGenerationPrompt('Pirates');
  assert.equal(g.messages[1].content, 'Pirates');
  assert.equal(g.maxTokens, 4000);
});
