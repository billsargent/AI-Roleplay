/**
 * Unit tests for lore checks and safe fixes (lib/loreDoctor.js, #45).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLore, applySafeFixes, cleanTriggers, isNeverSent } from '../lib/loreDoctor.js';

const piece = (over = {}) => ({ id: `p${Math.random().toString(36).slice(2, 7)}`, type: 'location', title: 'Docks', content: 'Wet.', weight: 3, pinned: false, smartActivation: true, triggers: ['docks'], linkedPieces: [], ...over });
const kinds = (issues) => issues.map(i => i.kind).sort();

test('AI lore fixes are validated: known cards only, links by title, triggers required', async () => {
  const { parseLoreFixes, buildLoreFixPrompt } = await import('../lib/prompt.js');
  const all = [piece({ id: 'a', title: 'Tower' }), piece({ id: 'b', title: 'Bell' }), piece({ id: 'c', title: 'Moat' })];
  const asked = [all[0], all[1]];
  const text = JSON.stringify({ fixes: [
    { id: 'a', triggers: ['tower', 'Tower', 'x', 'spire'], mode: 'triggered', links: ['bell', 'Tower', 'Nowhere'], description: 'The old tower.' },
    { id: 'b', triggers: [], mode: 'triggered' },
    { id: 'c', triggers: ['moat'] },
    { id: 'a', triggers: ['again'] },
  ] });
  assert.deepEqual(parseLoreFixes(text, asked, all), [{ id: 'a', triggers: ['tower', 'spire'], mode: 'triggered', linkedPieces: ['b'], description: 'The old tower.' }]);
  assert.deepEqual(parseLoreFixes('{"fixes":[{"id":"b","mode":"always"}]}', asked, all)[0].mode, 'always');
  assert.deepEqual(parseLoreFixes('nonsense', asked, all), []);
  const p = buildLoreFixPrompt({ name: 'N', backstory: 'B', characters: [{ name: 'Oz' }], lorePieces: all }, asked);
  assert.match(p.messages[1].content, /\[id: a\] Tower/);
  assert.match(p.messages[1].content, /ALL CARD TITLES:\n- Tower\n- Bell\n- Moat/);
});

test('trigger words are tidied', () => {
  assert.deepEqual(cleanTriggers([' Docks ', 'docks', 'the', 'x', 'pier', 7]), ['Docks', 'pier']);
  assert.deepEqual(cleanTriggers(['`"Route Tango"`', '*whisper*', '“moon”']), ['Route Tango', 'whisper', 'moon'], 'quotes and markdown around a trigger are removed');
  // A trailing space alone is a change worth saving
  const { changes, lorePieces } = applySafeFixes({ lorePieces: [piece({ triggers: ['docks '], weight: 100 })] });
  assert.deepEqual([changes, lorePieces[0].triggers], [['Tidied trigger words on 1 card(s)'], ['docks']]);
});

test('a piece is never sent without triggers, always-on or a link to it', () => {
  const p = piece({ triggers: [] });
  assert.equal(isNeverSent(p, new Set()), true);
  assert.equal(isNeverSent(p, new Set([p.id])), false, 'linked from another piece');
  assert.equal(isNeverSent({ ...p, pinned: true }, new Set()), false);
  assert.equal(isNeverSent({ ...p, smartActivation: false, triggers: ['x1'] }, new Set()), true, 'a draft with triggers is still never sent');
});

test('checks find the imported problems', () => {
  const lone = piece({ id: 'lone', title: 'Quiet', triggers: [] });
  const rule = piece({ id: 'rule', type: 'rule', title: 'No godmodding', content: 'Never decide for the player.', triggers: [] });
  const broken = piece({ id: 'b', linkedPieces: ['gone'], triggers: ['docks', 'the'] });
  const charDup = piece({ id: 'c', type: 'character', title: 'Mara', content: '{{char}} keeps the ferry.' });
  const empty = piece({ id: 'e', content: '  ' });
  const long = piece({ id: 'l', content: 'x'.repeat(3001) });
  const issues = checkLore({ lorePieces: [lone, rule, broken, charDup, empty, long], characters: [{ name: 'Mara' }] }, { lorePinnedMax: 10 });
  assert.deepEqual(kinds(issues), ['badTriggers', 'brokenLinks', 'castDuplicate', 'charPlaceholder', 'empty', 'neverSent', 'ruleCard', 'tooLong', 'weightScale']);
  assert.ok(issues.find(i => i.kind === 'neverSent').pieceId === 'lone');
  assert.equal(issues.find(i => i.kind === 'castDuplicate').safe, false);
  // The usual Fictionlab copy (same text as the cast member) is not reported
  const copy = piece({ id: 'k', type: 'character', title: 'Mara', content: 'Keeps  the ferry.', weight: 60 });
  assert.deepEqual(kinds(checkLore({ lorePieces: [copy], characters: [{ name: 'Mara', description: 'Keeps the ferry.' }] })), []);
  const capped = checkLore({ lorePieces: Array.from({ length: 3 }, () => piece({ pinned: true, weight: 100 })) }, { lorePinnedMax: 2 });
  assert.deepEqual(kinds(capped), ['overAlwaysCap']);
});

test('safe fixes repair what they can, and running them twice changes nothing more', () => {
  const scenario = {
    customInstructions: 'Be gothic.',
    characters: [{ name: 'Oz' }],
    lorePieces: [
      piece({ id: 'a', title: 'Tower', content: '{{char}} lives here.', linkedPieces: ['gone', 'b'], weight: 5 }),
      piece({ id: 'b', title: 'Oz: Secrets', type: 'character', content: '{{char}} hides it.', triggers: ['secret', 'Secret', 'a'], weight: 2 }),
      piece({ id: 'r', type: 'rule', title: 'No godmodding', content: 'Never decide for the player.', triggers: [] }),
      piece({ id: 'e', content: '' }),
    ],
  };
  const once = applySafeFixes(scenario);
  assert.deepEqual(once.lorePieces.map(p => p.id), ['a', 'b']);
  assert.deepEqual(once.lorePieces[0].linkedPieces, ['b']);
  assert.deepEqual(once.lorePieces.map(p => p.weight), [100, 40]);
  assert.equal(once.lorePieces[0].content, 'Oz lives here.');
  assert.equal(once.lorePieces[1].content, 'Oz hides it.');
  assert.deepEqual(once.lorePieces[1].triggers, ['secret']);
  assert.equal(once.customInstructions, 'Be gothic.\n\n## House rules (imported)\n- No godmodding: Never decide for the player.');
  assert.equal(once.changes.length, 6);

  const twice = applySafeFixes({ ...scenario, lorePieces: once.lorePieces, customInstructions: once.customInstructions });
  assert.deepEqual(twice.changes, []);
  assert.equal(twice.customInstructions, once.customInstructions);
  // A rule card already merged before is not added twice
  const again = applySafeFixes({ ...scenario, customInstructions: once.customInstructions });
  assert.equal(again.customInstructions.match(/No godmodding/g).length, 1);
});
