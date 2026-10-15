/**
 * ─── Re-importing Fictionlab files into existing scenarios ───
 *
 * Matches export files to scenarios already in the app and merges a file's
 * content into its scenario in place, so the scenario id (and every chat
 * that uses it) stays the same.
 *
 * What a re-import keeps from the existing scenario: id, owner, name,
 * settings (public/private and the rest), cover image, and the pictures of
 * characters and lore with the same name. Everything else (summary, tags,
 * backstory, greeting, instructions, introduction, cast, lore) comes from
 * the file.
 *
 * Image downloads are injected (fetchDataUrl), so this module does no I/O
 * of its own.
 *
 * @module fictionlabReimport
 */

/** Fictionlab image paths are relative to its image CDN */
export const FICTIONLAB_CDN = 'https://fictionlab.ai/image-cdn/';
export const flImageUrl = (path) => (/^https?:\/\//i.test(path) ? path : `${FICTIONLAB_CDN}${String(path).replace(/^\/+/, '')}`);

/** Names compared loosely: case, spacing and Unicode forms ignored */
export const normName = (s) => String(s || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Finds the scenario a file belongs to: by Fictionlab id first, then by name.
 * @param {{ sourceId?: string, name: string }} draft
 * @param {Array<{ id: string, name: string, sourceId?: string }>} scenarios - live scenarios
 * @returns {{ match: 'source'|'name'|'ambiguous'|'none', scenarioIds: string[] }}
 */
export function matchScenario(draft, scenarios) {
  if (draft.sourceId) {
    const bySource = scenarios.filter(s => s.sourceId && s.sourceId === draft.sourceId);
    if (bySource.length === 1) return { match: 'source', scenarioIds: [bySource[0].id] };
    if (bySource.length > 1) {
      // Several scenarios came from the same file: the name may tell them apart
      const named = bySource.filter(s => normName(s.name) === normName(draft.name));
      if (named.length === 1) return { match: 'source', scenarioIds: [named[0].id] };
      return { match: 'ambiguous', scenarioIds: bySource.map(s => s.id) };
    }
  }
  const byName = scenarios.filter(s => normName(s.name) === normName(draft.name));
  if (byName.length === 1) return { match: 'name', scenarioIds: [byName[0].id] };
  if (byName.length > 1) return { match: 'ambiguous', scenarioIds: byName.map(s => s.id) };
  return { match: 'none', scenarioIds: [] };
}

/** What a re-import would change, for the preview */
export function summarizeReimport(existing, draft) {
  const oldTitles = new Set((existing.lorePieces || []).map(p => normName(p.title)));
  const newTitles = new Set(draft.lorePieces.map(p => normName(p.title)));
  const fields = [
    ['description', 'summary'], ['backstory', 'backstory'], ['greetingMessage', 'greeting'],
    ['customInstructions', 'instructions'], ['introduction', 'introduction'],
  ].filter(([k]) => String(existing[k] || '').trim() !== String(draft[k] || '').trim()).map(([, label]) => label);
  const neverSent = (pieces) => pieces.filter(p => !p.pinned && !(p.smartActivation && (p.triggers || []).length)).length;
  const links = (pieces) => {
    const ids = new Set(pieces.map(p => p.id));
    return pieces.reduce((n, p) => n + (p.linkedPieces || []).filter(id => ids.has(id)).length, 0);
  };
  return {
    fields,
    lore: {
      before: (existing.lorePieces || []).length,
      after: draft.lorePieces.length,
      added: draft.lorePieces.filter(p => !oldTitles.has(normName(p.title))).map(p => p.title),
      removed: (existing.lorePieces || []).filter(p => !newTitles.has(normName(p.title))).map(p => p.title),
      neverSentBefore: neverSent(existing.lorePieces || []),
      neverSentAfter: neverSent(draft.lorePieces),
      workingLinksBefore: links(existing.lorePieces || []),
      workingLinksAfter: links(draft.lorePieces),
    },
    characters: { before: (existing.characters || []).length, after: draft.characters.length },
  };
}

/**
 * Builds the scenario to save: the file's content in the existing scenario.
 * @param {object} existing - getScenarioById() result
 * @param {{ draft: object, imageUrls: object }} parsed - parseFictionlab() result
 * @param {{ fetchDataUrl: (url: string) => Promise<string> }} io - downloads an image as a data URL
 */
export async function mergeReimport(existing, parsed, { fetchDataUrl }) {
  const { draft, imageUrls } = parsed;
  const image = async (path) => {
    if (!path) return '';
    try { return await fetchDataUrl(flImageUrl(path)); } catch { return ''; }
  };
  const oldChars = new Map((existing.characters || []).map(c => [normName(c.name), c]));
  const oldLore = new Map((existing.lorePieces || []).map(p => [normName(p.title), p]));

  const characters = [];
  for (const c of draft.characters) {
    const old = oldChars.get(normName(c.name));
    characters.push({ ...c, avatar: old?.avatar || await image(imageUrls.characters[c.id]) });
  }
  const lorePieces = [];
  for (const p of draft.lorePieces) {
    const old = oldLore.get(normName(p.title));
    lorePieces.push({ ...p, avatar: old?.avatar || await image(imageUrls.lore[p.id]) });
  }

  // Introduction images are embedded so they are stored with the scenario;
  // one that cannot be downloaded keeps its web address
  let introduction = draft.introduction || '';
  for (const src of [...new Set(imageUrls.introduction || [])]) {
    const data = await image(src);
    if (data) introduction = introduction.split(`src="${src}"`).join(`src="${data}"`);
  }

  return {
    ...existing,
    description: draft.description,
    tags: draft.tags,
    backstory: draft.backstory,
    greetingMessage: draft.greetingMessage,
    customInstructions: draft.customInstructions,
    introduction,
    characters,
    lorePieces,
    image: existing.image || await image(imageUrls.cover),
    sourceId: draft.sourceId || existing.sourceId || '',
  };
}
