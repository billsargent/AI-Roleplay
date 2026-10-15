/**
 * Unit tests for the scene line parser (src/utils/scene.ts, #46).
 * Needs a Node version that can run TypeScript directly (22.6+ with type
 * stripping); skipped otherwise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const canRunTs = !!process.features?.typescript;
const scene = canRunTs ? await import('../src/utils/scene.ts') : null;

test('scene lines in the common shapes', { skip: !canRunTs && 'Node cannot run TypeScript here' }, () => {
  const { parseSceneHeader } = scene;
  assert.deepEqual(parseSceneHeader('[Day 1 ✦ Monday 6:42 PM ✦ Gym Storage Room]\n\n*The bolt slides shut.*'),
    { place: 'Gym Storage Room', day: 'Day 1 · Monday', time: '6:42 PM', parts: ['Day 1', 'Monday 6:42 PM', 'Gym Storage Room'] });
  const kitchen = parseSceneHeader('[ Kitchen - Tuesday - 08:30am ]');
  assert.deepEqual([kitchen.place, kitchen.day, kitchen.time], ['Kitchen', 'Tuesday', '08:30am']);
  const emoji = parseSceneHeader('[Day 3 – 📍 Old Library – 🕦 11:30 PM]');
  assert.deepEqual([emoji.place, emoji.day, emoji.time], ['Old Library', 'Day 3', '11:30 PM']);
  const roses = parseSceneHeader('[Ballroom 🌹 03-20-2026 🌹 12:00 🌹 West Wing]');
  assert.deepEqual([roses.place, roses.day, roses.time], ['Ballroom · West Wing', '03-20-2026', '12:00']);
  assert.equal(parseSceneHeader('[Mara]: "Come in."'), null, 'a speaker tag is not a scene line');
  const pipes = parseSceneHeader('[March 14 | Evening | Rooftop Garden]');
  assert.deepEqual([pipes.place, pipes.day, pipes.time], ['Rooftop Garden', 'March 14', 'Evening']);
});

test('things that are not scene lines', { skip: !canRunTs && 'Node cannot run TypeScript here' }, () => {
  const { parseSceneHeader, latestScene } = scene;
  assert.equal(parseSceneHeader('[OOC: red]'), null);
  assert.equal(parseSceneHeader('*She smiles.* [later]'), null);
  assert.equal(parseSceneHeader('[Just a thought]'), null);
  assert.equal(parseSceneHeader('No header here'), null);
  const msgs = [
    { role: 'assistant', content: '[Day 1 | Morning | Dorm]\nHi' },
    { role: 'user', content: '[Day 9 | Night | Moon]' },
    { role: 'assistant', content: 'No header this time' },
  ];
  assert.equal(latestScene(msgs).place, 'Dorm', 'user messages and messages without a header are skipped');
});
