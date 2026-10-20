/**
 * ─── Fictionlab import ───
 *
 * Turns a Fictionlab export (any of its shapes) into a scenario draft for
 * this app. Pure: no I/O. Images are returned as remote URLs for the caller
 * to download.
 *
 * Shapes seen in real exports:
 * - the scenario object at the top level (most exports)
 * - wrapped in { scenario: {...} } or { data: {...} }
 * - a saved session: { app: 'fictionlab-scenario-save', save: { scenarioKey, data: {...} } }
 * Field names differ between versions (displayName/title, backStory/backstory,
 * customIntroduction/introduction, mainImage/croppedImage['main-image'],
 * settings at the top level or under settings), and very old exports keep lore
 * in storyCards (cardName, cardContent, cardType, cardTriggers).
 *
 * @module fictionlab
 */
import { randomUUID } from 'node:crypto';

const str = (v) => (typeof v === 'string' ? v : '');
const strArr = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean) : []);
const objArr = (v) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []);
const bool = (v, fallback) => (v === undefined || v === null ? fallback : !!v);

/** Finds the scenario object inside an export, and the Fictionlab id if there is one */
export function unwrapFictionlab(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (json.save && typeof json.save === 'object' && json.save.data && typeof json.save.data === 'object') {
    return { data: json.save.data, sourceId: str(json.save.scenarioKey) || str(json.save.data.id) };
  }
  for (const key of ['scenario', 'data']) {
    const inner = json[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && (inner.lorePieces || inner.displayName || inner.title || inner.backStory || inner.backstory)) {
      return { data: inner, sourceId: str(inner.id) || str(inner._id) };
    }
  }
  return { data: json, sourceId: str(json.id) || str(json._id) };
}

/** True when the export looks like a scenario at all */
export function looksLikeFictionlab(json) {
  const u = unwrapFictionlab(json);
  const d = u?.data;
  return !!d && !!(d.displayName || d.title || d.name || d.backStory || d.backstory || Array.isArray(d.lorePieces) || Array.isArray(d.storyCards));
}

/** "Damon: In Bed", "Eli - Routine", "Owen (obsession)" are sub-pieces of another character */
function isSubPiece(title, otherNames) {
  const t = title.trim().toLowerCase();
  return otherNames.some(n => n && n !== t && (t.startsWith(`${n}:`) || t.startsWith(`${n} -`) || t.startsWith(`${n} –`) || t.startsWith(`${n} (`)));
}

/** A character piece's own name: the part before ":" / " -" / " (" */
const baseName = (title) => title.split(/\s*[:(]|\s[-–]\s/)[0].trim() || title.trim();

/**
 * Parses a Fictionlab export.
 * @param {unknown} json - The parsed file
 * @param {{ newId?: () => string }} [opts]
 * @returns {{ draft: object, report: object, imageUrls: { cover: string, characters: Record<string,string>, lore: Record<string,string>, introduction: string[] } } | null}
 *   null when the file is not a scenario
 */
export function parseFictionlab(json, { newId = randomUUID } = {}) {
  if (!looksLikeFictionlab(json)) return null;
  const { data: d, sourceId } = unwrapFictionlab(json);
  const settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
  const report = { pieces: 0, rescaledWeights: false, mergedRules: [], noTriggers: [], subPieces: [], storyCards: 0, charReplaced: 0, droppedLinks: 0 };

  // ── Lore (lorePieces, plus very old storyCards) ──
  const rawLore = [
    ...objArr(d.lorePieces),
    ...objArr(d.storyCards).map(c => ({
      id: str(c.id), title: str(c.cardName), content: str(c.cardContent), type: str(c.cardType),
      triggers: Array.isArray(c.cardTriggers) ? c.cardTriggers : str(c.cardTriggers).split(','),
    })),
  ];
  report.storyCards = objArr(d.storyCards).length;
  const weights = rawLore.map(p => p.weight).filter(w => typeof w === 'number' && Number.isFinite(w));
  const oneToFive = weights.length > 0 && weights.every(w => w >= 0 && w <= 5);
  report.rescaledWeights = oneToFive;
  // Every piece gets its own new id (some files repeat an id); links follow
  // the first piece that had the old id
  const ids = new Map();
  const ownIds = rawLore.map(p => {
    const id = newId();
    if (str(p.id) && !ids.has(str(p.id))) ids.set(str(p.id), id);
    return id;
  });

  const characterNames = rawLore.filter(p => str(p.type).toLowerCase() === 'character').map(p => str(p.title).trim().toLowerCase());
  let lore = rawLore.map((p, index) => {
    const title = str(p.title).trim();
    const type = str(p.type).trim() || 'other';
    const triggers = [...new Set(strArr(p.triggers))];
    const pinned = !!p.pinned;
    let content = str(p.content);
    // {{char}} in a character's own piece is that character
    if (type.toLowerCase() === 'character' && /\{\{char\}\}/i.test(content)) {
      content = content.replace(/\{\{char\}\}/gi, baseName(title));
      report.charReplaced++;
    }
    const links = strArr(p.linkedPieces);
    const linkedPieces = links.map(id => ids.get(id)).filter(Boolean);
    report.droppedLinks += links.length - linkedPieces.length;
    const weight = typeof p.weight === 'number' && Number.isFinite(p.weight) ? (oneToFive ? Math.round(p.weight * 20) : Math.round(p.weight)) : 100;
    return {
      id: ownIds[index],
      type,
      title,
      description: str(p.description).trim(),
      content,
      weight,
      pinned,
      // A piece is sent when triggered unless it is always on
      smartActivation: !pinned,
      triggers,
      linkedPieces,
      hidden: !!p.hidden,
      traits: strArr(p.traits),
      isStartLocation: !!p.isStartLocation,
      _avatar: str(p.avatarURL),
    };
  }).filter(p => p.title || p.content.trim());
  report.pieces = lore.length;

  // ── Cast: the characters array, else character lore that is not a sub-piece ──
  let cast = objArr(d.characters).map(c => ({
    id: newId(),
    name: (str(c.displayName) || str(c.name)).trim(),
    description: str(c.description),
    personality: str(c.personality) || strArr(c.traits).join(', '),
    traits: strArr(c.traits),
    hidden: !!c.isHidden,
    _avatar: str(c.avatarURL),
  })).filter(c => c.name);
  for (const p of lore.filter(p => p.type.toLowerCase() === 'character')) {
    if (isSubPiece(p.title, characterNames)) { report.subPieces.push(p.title); continue; }
    if (cast.some(c => c.name.toLowerCase() === p.title.toLowerCase())) continue;
    cast.push({ id: newId(), name: p.title || 'Unknown', description: p.content, personality: p.traits.join(', '), traits: p.traits, hidden: p.hidden, _avatar: p._avatar });
  }
  // {{char}} elsewhere means the only character, when there is exactly one
  const onlyName = cast.length === 1 ? cast[0].name : '';
  const replaceChar = (text) => {
    if (!onlyName || !/\{\{char\}\}/i.test(text)) return text;
    report.charReplaced++;
    return text.replace(/\{\{char\}\}/gi, onlyName);
  };
  cast = cast.map(c => ({ ...c, description: replaceChar(c.description), personality: replaceChar(c.personality) }));
  lore = lore.map(p => ({ ...p, content: replaceChar(p.content) }));

  // ── Rule cards nobody could ever trigger go into the instructions ──
  let customInstructions = replaceChar(str(d.customInstructions));
  const ruleCards = lore.filter(p => p.type.toLowerCase() === 'rule' && !p.pinned && p.triggers.length === 0);
  if (ruleCards.length) {
    const block = ruleCards.map(r => `- ${r.title ? `${r.title}: ` : ''}${r.content.trim()}`).join('\n');
    customInstructions = `${customInstructions.trim()}${customInstructions.trim() ? '\n\n' : ''}## House rules (imported)\n${block}`;
    report.mergedRules = ruleCards.map(r => r.title);
    const gone = new Set(ruleCards.map(r => r.id));
    lore = lore.filter(p => !gone.has(p.id)).map(p => ({ ...p, linkedPieces: p.linkedPieces.filter(id => !gone.has(id)) }));
  }
  report.noTriggers = lore.filter(p => !p.pinned && p.triggers.length === 0).map(p => p.title);

  // ── Images to download (remote URLs, keyed by the new ids) ──
  const croppedImage = d.croppedImage && typeof d.croppedImage === 'object' ? d.croppedImage : {};
  const imageUrls = {
    cover: str(d.mainImage) || str(croppedImage['main-image']) || str(d.avatarURL),
    characters: Object.fromEntries(cast.filter(c => c._avatar).map(c => [c.id, c._avatar])),
    lore: Object.fromEntries(lore.filter(p => p._avatar).map(p => [p.id, p._avatar])),
    introduction: [...str(d.customIntroduction || d.introduction).matchAll(/<img[^>]+src="([^"]+)"/gi)].map(m => m[1]),
  };

  const draft = {
    sourceId,
    name: (str(d.displayName) || str(d.title) || str(d.name)).trim() || 'Imported Scenario',
    description: str(d.description),
    tags: strArr(d.genres).length ? strArr(d.genres) : strArr(d.tags),
    backstory: replaceChar(str(d.backStory) || str(d.backstory)),
    greetingMessage: replaceChar(str(d.customGreeting) || str(d.greetingMessage) || str(d.greeting)),
    customInstructions,
    introduction: str(d.customIntroduction) || str(d.introduction),
    characters: cast.map(({ _avatar, ...c }) => c),
    lorePieces: lore.map(({ _avatar, ...p }) => p),
    settings: {
      separateUserCharacter: bool(d.separateUser ?? settings.separateUser, true),
      sensitiveContent: bool(d.sensitiveContent ?? settings.sensitiveContent, false),
      isPublic: bool(d.isPublic ?? settings.publicScenario ?? settings.isPublic, true),
      allowCustomization: bool(d.allowEditing ?? settings.allowEditing, true),
      hidePrompts: bool(d.hidePrompts ?? settings.hidePrompts, false),
      allowCommenting: bool(d.allowComments ?? settings.allowComments, true),
    },
  };
  return { draft, report, imageUrls };
}
