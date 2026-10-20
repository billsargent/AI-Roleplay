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

// ── Re-import in place (#43) ──
import fs from 'node:fs';

/** Saves a scenario as the old importer left it, plus a chat on it */
async function oldImport(token, name) {
  const id = randomUUID();
  const lore = [
    { id: randomUUID(), type: 'location', title: 'Docks', content: 'Old text.', weight: 3, pinned: false, smartActivation: false, triggers: [], linkedPieces: ['lp-old'] },
    { id: randomUUID(), type: 'rule', title: 'Gone Rule', content: 'Old rule.', weight: 3, pinned: false, smartActivation: false, triggers: [], linkedPieces: [] },
  ];
  await srv.request('POST', '/api/scenarios', { token, body: {
    id, name, description: 'old', tags: [], backstory: 'old backstory', customInstructions: 'old rules',
    characters: [{ id: randomUUID(), name: 'Mara', description: 'old', personality: '' }], lorePieces: lore,
    settings: { isPublic: false, hidePrompts: true },
  } });
  const chatId = randomUUID();
  await srv.request('POST', '/api/chats', { token, body: { id: chatId, scenarioId: id, title: 't', createdAt: Date.now(), settings: {}, userCharacter: { name: 'Rin' }, memories: [],
    messages: [{ id: randomUUID(), role: 'assistant', content: 'Hello', timestamp: Date.now() }] } });
  return { id, chatId };
}

/** A fresh export of that scenario: triggers, links, descriptions (no images, so no downloads) */
const freshFile = (name) => topLevel({
  id: `fl-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, displayName: name, mainImage: '', customIntroduction: '<p>New intro</p>',
  lorePieces: [
    piece({ id: 'lp-1', title: 'Docks', content: 'New text.', triggers: ['docks'], description: 'Where boats land.', linkedPieces: ['lp-2'] }),
    piece({ id: 'lp-2', title: 'Lighthouse', content: 'Dark.', triggers: ['lighthouse'], weight: 5 }),
  ],
  characters: [{ displayName: 'Mara', description: 'Ferry keeper.' }],
});

test('re-importing a file updates the scenario in place and keeps its chats', async () => {
  const { id, chatId } = await oldImport(owner.token, 'Harbour Tale');
  const preview = await srv.request('POST', `/api/scenarios/${id}/reimport`, { token: owner.token, body: { file: freshFile('Harbour Tale') } });
  assert.equal(preview.status, 200, preview.text);
  const s = preview.json.summary;
  assert.deepEqual([s.lore.before, s.lore.after, s.lore.neverSentBefore, s.lore.neverSentAfter, s.lore.workingLinksBefore, s.lore.workingLinksAfter], [2, 2, 2, 0, 0, 1]);
  assert.deepEqual(s.lore.added, ['Lighthouse']);
  assert.deepEqual(s.lore.removed, ['Gone Rule']);
  assert.equal((await srv.request('GET', `/api/scenarios/${id}`, { token: owner.token })).json.backstory, 'old backstory', 'preview changes nothing');

  const other = await srv.register();
  assert.equal((await srv.request('POST', `/api/scenarios/${id}/reimport`, { token: other.token, body: { file: freshFile('Harbour Tale'), apply: true } })).status, 403);

  const applied = await srv.request('POST', `/api/scenarios/${id}/reimport`, { token: owner.token, body: { file: freshFile('Harbour Tale'), apply: true } });
  assert.equal(applied.status, 200, applied.text);
  const after = (await srv.request('GET', `/api/scenarios/${id}`, { token: owner.token })).json;
  assert.equal(after.name, 'Harbour Tale');
  assert.equal(after.backstory, '{{user}} arrives.');
  assert.equal(after.settings.hidePrompts, true, 'settings are kept');
  assert.equal(after.sourceId, 'fl-harbour-tale');
  const docks = after.lorePieces.find(p => p.title === 'Docks');
  const lighthouse = after.lorePieces.find(p => p.title === 'Lighthouse');
  assert.deepEqual(docks.linkedPieces, [lighthouse.id], 'links work');
  assert.equal(docks.description, 'Where boats land.');
  assert.equal(lighthouse.weight, 100);
  const chat = await srv.request('GET', `/api/chats/${chatId}`, { token: owner.token });
  assert.equal(chat.status, 200);
  assert.equal(chat.json.scenarioId, id, 'the chat still belongs to the scenario');
});

test('bulk re-import: dry run matches files, apply backs up first', async () => {
  const a = await oldImport(owner.token, 'Bulk One');
  await oldImport(owner.token, 'Twin');
  await oldImport(owner.token, 'Twin');
  const files = [
    { name: 'one.json', file: freshFile('bulk one') },
    { name: 'twin.json', file: freshFile('Twin') },
    { name: 'none.json', file: freshFile('Nobody Has This') },
    { name: 'chat.json', file: { app: 'x', scenario: { id: 'a', name: 'n' }, messages: [] } },
  ];
  const other = await srv.register();
  assert.equal((await srv.request('POST', '/api/admin/fictionlab/match', { token: other.token, body: { files } })).status, 403);
  const dry = await srv.request('POST', '/api/admin/fictionlab/match', { token: owner.token, body: { files } });
  assert.equal(dry.status, 200, dry.text);
  assert.deepEqual(dry.json.rows.map(r => r.status), ['name', 'ambiguous', 'none', 'not a scenario']);
  assert.equal(dry.json.rows[0].candidates[0].id, a.id);
  assert.equal(dry.json.rows[1].candidates.length, 2);
  assert.equal(dry.json.rows[0].summary.lore.neverSentAfter, 0);

  const run = await srv.request('POST', '/api/admin/fictionlab/apply', { token: owner.token, body: { backup: true, items: [{ scenarioId: a.id, file: freshFile('bulk one') }, { scenarioId: 'nope', file: freshFile('x') }] } });
  assert.equal(run.status, 200, run.text);
  assert.ok(run.json.backup && fs.existsSync(`${srv.dir}/${run.json.backup}`), 'backup written next to the database');
  assert.deepEqual(run.json.results.map(r => r.ok), [true, false]);
  assert.equal((await srv.request('GET', `/api/scenarios/${a.id}`, { token: owner.token })).json.sourceId, 'fl-bulk-one');
  // Now the Fictionlab id matches first, even after a rename on Fictionlab
  const again = await srv.request('POST', '/api/admin/fictionlab/match', { token: owner.token, body: { files: [{ name: 'renamed.json', file: { ...freshFile('Renamed On Fictionlab'), id: 'fl-bulk-one' } }] } });
  assert.deepEqual([again.json.rows[0].status, again.json.rows[0].candidates[0].id], ['source', a.id]);
});

test('a hollow export is refused; an export from before lore existed keeps the lore', async () => {
  const { id } = await oldImport(owner.token, 'Hollow Tale');
  // Cards present, text missing (the creator hid the prompts on Fictionlab)
  const hollow = topLevel({ id: 'fl-hollow', displayName: 'Hollow Tale', backStory: '', lorePieces: [piece({ title: 'A', content: '' }), piece({ title: 'B', content: '' })] });
  const preview = await srv.request('POST', `/api/scenarios/${id}/reimport`, { token: owner.token, body: { file: hollow } });
  assert.equal(preview.json.summary.hollow, true);
  const refused = await srv.request('POST', `/api/scenarios/${id}/reimport`, { token: owner.token, body: { file: hollow, apply: true } });
  assert.equal(refused.status, 422);
  assert.match(refused.json.error, /missing its lore text/);
  assert.equal((await srv.request('GET', `/api/scenarios/${id}`, { token: owner.token })).json.backstory, 'old backstory', 'nothing changed');

  // No lore cards at all: an export from before Fictionlab had lore
  const early = topLevel({ id: 'fl-early', displayName: 'Hollow Tale', backStory: 'Newer backstory.', lorePieces: [] });
  const p2 = await srv.request('POST', `/api/scenarios/${id}/reimport`, { token: owner.token, body: { file: early } });
  assert.deepEqual([p2.json.summary.hollow, p2.json.summary.keepsLore, p2.json.summary.lore.after], [false, true, 2]);
  assert.equal((await srv.request('POST', `/api/scenarios/${id}/reimport`, { token: owner.token, body: { file: early, apply: true } })).status, 200);
  const after = (await srv.request('GET', `/api/scenarios/${id}`, { token: owner.token })).json;
  assert.equal(after.backstory, 'Newer backstory.');
  assert.deepEqual(after.lorePieces.map(p => p.title).sort(), ['Docks', 'Gone Rule'], 'the scenario keeps its lore');
});

test('pieces that share an id in the file still get their own ids', () => {
  const { draft } = parseFictionlab(topLevel({
    lorePieces: [piece({ id: 'dup', title: 'A' }), piece({ id: 'dup', title: 'B' }), piece({ id: 'x', title: 'C', linkedPieces: ['dup'] })],
    storyCards: [{ id: 'dup', cardName: 'D', cardContent: 'd', cardTriggers: ['d'] }],
  }), { newId });
  const ids = draft.lorePieces.map(p => p.id);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(draft.lorePieces[2].linkedPieces, [ids[0]], 'the link follows the first piece with that id');
});

test('images are listed for download', () => {
  const { imageUrls } = parseFictionlab(topLevel({ lorePieces: [piece({ avatarURL: 'lore/x.webp' })] }), { newId });
  assert.equal(imageUrls.cover, 'scenarios/cover.webp');
  assert.deepEqual(Object.values(imageUrls.lore), ['lore/x.webp']);
  assert.deepEqual(imageUrls.introduction, ['https://example.test/a.webp']);
});
