/**
 * Unit tests for the Fictionlab import parser (lib/fictionlab.js, #42).
 * Fixtures copy the shapes of real exports with made-up content.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFictionlab, unwrapFictionlab, looksLikeFictionlab } from '../lib/fictionlab.js';

let n = 0;
const newId = () => `new-${++n}`;
const piece = (over = {}) => ({
  id: `lp-${Math.random().toString(36).slice(2, 8)}`, title: 'Harbour', content: 'Wet docks.', description: '',
  type: 'location', triggers: ['harbour'], linkedPieces: [], weight: 3, pinned: false, traits: [], ...over,
});

/** The common shape: everything at the top level */
const topLevel = (over = {}) => ({
  id: 'fl-123', displayName: 'Saltmarsh', description: 'A smuggler town.', genres: ['mystery'],
  backStory: '{{user}} arrives.', customGreeting: 'Welcome.', customInstructions: 'Be gothic.',
  customIntroduction: '<p>Intro <img src="https://example.test/a.webp"></p>', mainImage: 'scenarios/cover.webp',
  separateUser: true, sensitiveContent: true, isPublic: false, allowEditing: true, hidePrompts: false, allowComments: true,
  lorePieces: [piece()],
  ...over,
});

test('every export shape is unwrapped', () => {
  const inner = topLevel();
  assert.equal(unwrapFictionlab(inner).data, inner);
  assert.equal(unwrapFictionlab({ scenario: inner }).data, inner);
  assert.equal(unwrapFictionlab({ data: inner }).data, inner);
  const save = { v: 1, app: 'fictionlab-scenario-save', save: { scenarioKey: 'key-9', data: { title: 'T', backstory: 'b', lorePieces: [] } } };
  assert.equal(unwrapFictionlab(save).sourceId, 'key-9');
  assert.equal(parseFictionlab(save, { newId }).draft.name, 'T');
  // A chat export is not a scenario
  assert.equal(looksLikeFictionlab({ app: 'x', scenario: { id: 'a', name: 'n', description: 'd', createdBy: 'u' }, messages: [] }), false);
  assert.equal(parseFictionlab([1, 2]), null);
});

test('old and new field names both work', () => {
  const old = parseFictionlab(topLevel(), { newId }).draft;
  assert.equal(old.name, 'Saltmarsh');
  assert.equal(old.backstory, '{{user}} arrives.');
  assert.equal(old.greetingMessage, 'Welcome.');
  assert.match(old.introduction, /Intro/);
  assert.equal(old.sourceId, 'fl-123');
  assert.deepEqual(old.settings, { separateUserCharacter: true, sensitiveContent: true, isPublic: false, allowCustomization: true, hidePrompts: false, allowCommenting: true });
  const fresh = parseFictionlab({ save: { scenarioKey: 'k', data: {
    title: 'New', backstory: 'b2', introduction: '<p>i</p>', croppedImage: { 'main-image': 'https://example.test/m.webp' },
    settings: { separateUser: false, publicScenario: false }, genres: ['a'], lorePieces: [],
  } } }, { newId });
  assert.equal(fresh.draft.backstory, 'b2');
  assert.equal(fresh.draft.introduction, '<p>i</p>');
  assert.equal(fresh.imageUrls.cover, 'https://example.test/m.webp');
  assert.equal(fresh.draft.settings.isPublic, false);
  assert.equal(fresh.draft.settings.separateUserCharacter, false);
});

test('lore keeps types, descriptions, traits and links; weights 1-5 are rescaled', () => {
  const a = piece({ id: 'lp-a', title: 'The Deal', type: 'premise', weight: 5, pinned: true, description: 'The core bargain.', linkedPieces: ['lp-b', 'lp-gone'] });
  const b = piece({ id: 'lp-b', title: 'Schedule', type: 'routine', weight: 2, traits: ['daily'], isStartLocation: true });
  const { draft, report } = parseFictionlab(topLevel({ lorePieces: [a, b] }), { newId });
  const [deal, schedule] = draft.lorePieces;
  assert.equal(deal.type, 'premise');
  assert.equal(deal.weight, 100);
  assert.equal(schedule.weight, 40);
  assert.equal(deal.description, 'The core bargain.');
  assert.equal(deal.pinned, true);
  assert.equal(deal.smartActivation, false);
  assert.deepEqual(deal.linkedPieces, [schedule.id], 'links follow the new ids; unknown ones are dropped');
  assert.equal(report.droppedLinks, 1);
  assert.deepEqual(schedule.traits, ['daily']);
  assert.equal(schedule.isStartLocation, true);
  assert.equal(report.rescaledWeights, true);
  // Weights already on the 100 scale stay
  assert.equal(parseFictionlab(topLevel({ lorePieces: [piece({ weight: 80 })] }), { newId }).draft.lorePieces[0].weight, 80);
});

test('the cast comes from the characters array, else from character lore without sub-pieces', () => {
  const withArray = parseFictionlab(topLevel({
    characters: [{ displayName: 'Mara', description: 'Ferry keeper.', traits: ['Dry'], isHidden: true, avatarURL: 'chars/m.webp' }],
    lorePieces: [piece({ title: 'Mara', type: 'character', content: 'Ferry keeper.' })],
  }), { newId });
  assert.deepEqual(withArray.draft.characters.map(c => [c.name, c.personality, c.hidden]), [['Mara', 'Dry', true]]);
  assert.equal(Object.values(withArray.imageUrls.characters)[0], 'chars/m.webp');

  const fromLore = parseFictionlab(topLevel({ lorePieces: [
    piece({ title: 'Damon', type: 'character', content: 'Captain.', traits: ['Calm'] }),
    piece({ title: 'Damon: In Bed', type: 'character', content: 'Private.', hidden: true }),
    piece({ title: 'Eli - Routine', type: 'character', content: 'Schedule.' }),
    piece({ title: 'Eli', type: 'character', content: 'Boyfriend.' }),
  ] }), { newId });
  assert.deepEqual(fromLore.draft.characters.map(c => c.name), ['Damon', 'Eli']);
  assert.deepEqual(fromLore.report.subPieces, ['Damon: In Bed', 'Eli - Routine']);
  assert.equal(fromLore.draft.lorePieces.length, 4, 'sub-pieces stay as lore');
});

test('{{char}} becomes the right name', () => {
  const { draft } = parseFictionlab(topLevel({ lorePieces: [
    piece({ title: 'Oz: Secrets', type: 'character', content: '{{char}} hides it.' }),
    piece({ title: 'Oz', type: 'character', content: '{{char}} is ancient.' }),
    piece({ title: 'Tower', content: '{{char}} lives here.' }),
  ], backStory: '{{char}} waits for {{user}}.' }), { newId });
  assert.equal(draft.lorePieces[0].content, 'Oz hides it.');
  assert.equal(draft.lorePieces[1].content, 'Oz is ancient.');
  assert.equal(draft.lorePieces[2].content, 'Oz lives here.', 'the only cast member');
  assert.equal(draft.backstory, 'Oz waits for {{user}}.');
});

test('rule cards nobody can trigger are merged into the instructions', () => {
  const rule = piece({ id: 'lp-r', title: 'No godmodding', type: 'rule', content: 'Never decide for the player.', triggers: [] });
  const kept = piece({ id: 'lp-k', title: 'Curfew', type: 'rule', content: 'Lights out at ten.', triggers: ['curfew'] });
  const linker = piece({ id: 'lp-l', title: 'Town', linkedPieces: ['lp-r', 'lp-k'] });
  const { draft, report } = parseFictionlab(topLevel({ lorePieces: [rule, kept, linker] }), { newId });
  assert.match(draft.customInstructions, /^Be gothic\.\n\n## House rules \(imported\)\n- No godmodding: Never decide for the player\.$/);
  assert.deepEqual(draft.lorePieces.map(p => p.title), ['Curfew', 'Town']);
  assert.equal(draft.lorePieces[1].linkedPieces.length, 1, 'links to the merged card are removed');
  assert.deepEqual(report.mergedRules, ['No godmodding']);
});

test('old story cards become lore; trigger-less pieces are reported', () => {
  const { draft, report } = parseFictionlab(topLevel({
    lorePieces: [piece({ title: 'Quiet', triggers: [] })],
    storyCards: [{ id: 's1', cardName: 'The Bell', cardContent: 'It rings.', cardType: 'item', cardTriggers: 'bell, toll' }],
  }), { newId });
  const bell = draft.lorePieces.find(p => p.title === 'The Bell');
  assert.deepEqual(bell.triggers, ['bell', 'toll']);
  assert.equal(bell.type, 'item');
  assert.equal(report.storyCards, 1);
  assert.deepEqual(report.noTriggers, ['Quiet']);
});

// ── End to end: the import route and the stored fields ──
import { before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server.js';

let srv, owner;
before(async () => {
  srv = await startServer();
  owner = await srv.register();
});
after(async () => { await srv?.stop(); });

test('the import route returns a draft, and refuses chat exports', async () => {
  const r = await srv.request('POST', '/api/import/fictionlab', { token: owner.token, body: { file: { scenario: topLevel() } } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.draft.name, 'Saltmarsh');
  assert.equal(r.json.draft.lorePieces[0].weight, 60);
  const chat = await srv.request('POST', '/api/import/fictionlab', { token: owner.token, body: { file: { app: 'x', scenario: { id: 'a', name: 'n' }, messages: [] } } });
  assert.equal(chat.status, 400);
  assert.match(chat.json.error, /chat export/);
  assert.equal((await srv.request('POST', '/api/import/fictionlab', { body: { file: topLevel() } })).status, 401);
});

test('imported details are stored; hidden characters stay with the author', async () => {
  const { draft } = parseFictionlab(topLevel({
    characters: [{ displayName: 'Mara', description: 'Keeper', traits: ['Dry'] }, { displayName: 'Ghost', description: 'Secret', isHidden: true }],
    lorePieces: [piece({ title: 'Docks', description: 'Where boats land.', traits: ['wet'], isStartLocation: true, weight: 0 })],
  }));
  const id = randomUUID();
  // Not open for customization, so other players get the filtered view
  const save = await srv.request('POST', '/api/scenarios', { token: owner.token, body: { ...draft, id, settings: { ...draft.settings, isPublic: true, allowCustomization: false } } });
  assert.equal(save.status, 200, save.text);
  const back = (await srv.request('GET', `/api/scenarios/${id}`, { token: owner.token })).json;
  assert.equal(back.sourceId, 'fl-123');
  assert.deepEqual(back.lorePieces[0].traits, ['wet']);
  assert.equal(back.lorePieces[0].description, 'Where boats land.');
  assert.equal(back.lorePieces[0].isStartLocation, true);
  assert.equal(back.lorePieces[0].weight, 0, 'a weight of 0 is kept');
  assert.deepEqual(back.characters.map(c => [c.name, c.hidden, c.traits]), [['Mara', false, ['Dry']], ['Ghost', true, []]]);
  // Saving without a source id keeps the stored one
  const { sourceId, ...rest } = back;
  assert.equal((await srv.request('POST', '/api/scenarios', { token: owner.token, body: rest })).status, 200);
  assert.equal((await srv.request('GET', `/api/scenarios/${id}`, { token: owner.token })).json.sourceId, 'fl-123');
  // Another player does not see the hidden character
  const other = await srv.register();
  const seen = (await srv.request('GET', `/api/scenarios/${id}`, { token: other.token })).json;
  assert.deepEqual(seen.characters.map(c => c.name), ['Mara']);
});

test('images are listed for download', () => {
  const { imageUrls } = parseFictionlab(topLevel({ lorePieces: [piece({ avatarURL: 'lore/x.webp' })] }), { newId });
  assert.equal(imageUrls.cover, 'scenarios/cover.webp');
  assert.deepEqual(Object.values(imageUrls.lore), ['lore/x.webp']);
  assert.deepEqual(imageUrls.introduction, ['https://example.test/a.webp']);
});
