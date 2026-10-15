/**
 * ─── Lore health: checks and safe fixes ───
 *
 * Finds lore that does not work (never sent, broken links, imported quirks)
 * and fixes what can be fixed without judgement. Pure functions: callers
 * pass the scenario and save the result themselves.
 *
 * Safe fixes (applySafeFixes), all idempotent:
 * - remove links to pieces that do not exist
 * - rescale Fictionlab weights (all between 0 and 5) to the 0-100 scale
 * - remove cards with no content
 * - move rule cards that could never be sent into the custom instructions
 * - replace {{char}} with the character's name where it is unambiguous
 * - tidy trigger words (trim, no duplicates, no stop words or single letters)
 *
 * Everything else is reported for a person (or the AI suggestions) to decide.
 *
 * @module loreDoctor
 */

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'he', 'she', 'it', 'they', 'you', 'i', 'we', 'his', 'her', 'is', 'was']);
/** Longest piece before it is flagged as costly when triggered (characters) */
export const LONG_PIECE_CHARS = 3000;
const RULES_HEADING = '## House rules (imported)';

const norm = (s) => String(s || '').trim().toLowerCase();
const isRule = (p) => norm(p.type) === 'rule';
const baseName = (title) => String(title || '').split(/\s*[:(]|\s[-–]\s/)[0].trim() || String(title || '').trim();

/** Trigger words as the engine can use them */
export function cleanTriggers(triggers) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(triggers) ? triggers : []) {
    const word = String(t || '').trim();
    const key = word.toLowerCase();
    if (word.length < 2 || STOP_WORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

/** Ids of the pieces some other piece links to */
const linkedTargets = (pieces) => new Set(pieces.flatMap(p => p.linkedPieces || []));

/** A piece the AI can never be given: not always on, and not triggerable, and nothing links to it */
export function isNeverSent(p, targets) {
  if (p.pinned) return false;
  if (p.smartActivation && cleanTriggers(p.triggers).length > 0) return false;
  return !targets.has(p.id);
}

/**
 * Lists what is wrong with a scenario's lore.
 * @param {object} scenario - { lorePieces, characters, customInstructions }
 * @param {{ lorePinnedMax: number }} llm
 * @returns {Array<{ kind: string, pieceId?: string, title?: string, message: string, safe: boolean }>}
 */
export function checkLore(scenario, llm = { lorePinnedMax: 10 }) {
  const pieces = scenario.lorePieces || [];
  const ids = new Set(pieces.map(p => p.id));
  const targets = linkedTargets(pieces);
  const cast = new Set((scenario.characters || []).map(c => norm(c.name)));
  const issues = [];
  const add = (kind, p, message, safe) => issues.push({ kind, ...(p ? { pieceId: p.id, title: p.title } : {}), message, safe });

  const weights = pieces.map(p => Number(p.weight)).filter(Number.isFinite);
  if (weights.length && weights.every(w => w >= 0 && w <= 5) && weights.some(w => w > 0)) {
    add('weightScale', null, 'Priorities are on the 1-5 scale from Fictionlab; new cards (priority 100) would always win.', true);
  }
  for (const p of pieces) {
    const broken = (p.linkedPieces || []).filter(id => !ids.has(id));
    if (broken.length) add('brokenLinks', p, `${broken.length} link(s) point at cards that no longer exist.`, true);
    if (!String(p.content || '').trim()) { add('empty', p, 'This card has no content.', true); continue; }
    if (isRule(p) && isNeverSent(p, targets)) add('ruleCard', p, 'A rule card nobody can trigger: it belongs in the Custom AI Instructions.', true);
    else if (isNeverSent(p, targets)) add('neverSent', p, 'Never sent to the AI: it has no trigger words and is not always on.', false);
    const cleaned = cleanTriggers(p.triggers);
    if ((p.triggers || []).length !== cleaned.length) add('badTriggers', p, 'Some trigger words are duplicates, too short or too common.', true);
    if (/\{\{char\}\}/i.test(p.content)) add('charPlaceholder', p, '{{char}} is not replaced in this app.', true);
    if (norm(p.type) === 'character' && cast.has(norm(p.title))) add('castDuplicate', p, 'The same character is in the cast, which is always sent; this card is skipped.', false);
    if (String(p.content).length > LONG_PIECE_CHARS) add('tooLong', p, `Over ${LONG_PIECE_CHARS.toLocaleString('en')} characters: costly every time it is sent.`, false);
  }
  const always = pieces.filter(p => p.pinned).length;
  if (always > llm.lorePinnedMax) add('overAlwaysCap', null, `${always} cards are always on, but only ${llm.lorePinnedMax} are sent; the lowest-priority ones are skipped.`, false);
  return issues;
}

/**
 * Applies the safe fixes.
 * @returns {{ lorePieces: object[], customInstructions: string, changes: string[] }}
 */
export function applySafeFixes(scenario) {
  let pieces = (scenario.lorePieces || []).map(p => ({ ...p, triggers: [...(p.triggers || [])], linkedPieces: [...(p.linkedPieces || [])] }));
  let instructions = String(scenario.customInstructions || '');
  const changes = [];

  // Empty cards
  const empty = pieces.filter(p => !String(p.content || '').trim());
  if (empty.length) {
    pieces = pieces.filter(p => String(p.content || '').trim());
    changes.push(`Removed ${empty.length} empty card(s)`);
  }

  // Rule cards nobody can trigger move into the instructions (once)
  const targets = linkedTargets(pieces);
  const rules = pieces.filter(p => isRule(p) && isNeverSent(p, targets));
  if (rules.length) {
    const lines = rules.map(r => `- ${r.title ? `${r.title}: ` : ''}${String(r.content).trim()}`).filter(line => !instructions.includes(line));
    if (lines.length) {
      instructions = instructions.includes(RULES_HEADING)
        ? `${instructions.trimEnd()}\n${lines.join('\n')}`
        : `${instructions.trim()}${instructions.trim() ? '\n\n' : ''}${RULES_HEADING}\n${lines.join('\n')}`;
    }
    const gone = new Set(rules.map(r => r.id));
    pieces = pieces.filter(p => !gone.has(p.id));
    changes.push(`Moved ${rules.length} rule card(s) into the Custom AI Instructions`);
  }

  // Links to cards that do not exist
  const ids = new Set(pieces.map(p => p.id));
  let dropped = 0;
  pieces = pieces.map(p => {
    const kept = p.linkedPieces.filter(id => ids.has(id));
    dropped += p.linkedPieces.length - kept.length;
    return { ...p, linkedPieces: kept };
  });
  if (dropped) changes.push(`Removed ${dropped} broken link(s)`);

  // Fictionlab's 1-5 priorities
  const weights = pieces.map(p => Number(p.weight)).filter(Number.isFinite);
  if (weights.length && weights.every(w => w >= 0 && w <= 5) && weights.some(w => w > 0)) {
    pieces = pieces.map(p => ({ ...p, weight: Math.round((Number(p.weight) || 0) * 20) }));
    changes.push('Rescaled priorities from 1-5 to 20-100');
  }

  // {{char}}
  const onlyCast = (scenario.characters || []).length === 1 ? scenario.characters[0].name : '';
  let charFixed = 0;
  pieces = pieces.map(p => {
    if (!/\{\{char\}\}/i.test(p.content)) return p;
    const name = norm(p.type) === 'character' ? baseName(p.title) : onlyCast;
    if (!name) return p;
    charFixed++;
    return { ...p, content: p.content.replace(/\{\{char\}\}/gi, name) };
  });
  if (charFixed) changes.push(`Replaced {{char}} in ${charFixed} card(s)`);

  // Trigger words
  let tidied = 0;
  pieces = pieces.map(p => {
    const cleaned = cleanTriggers(p.triggers);
    if (cleaned.length === p.triggers.length) return p;
    tidied++;
    return { ...p, triggers: cleaned };
  });
  if (tidied) changes.push(`Tidied trigger words on ${tidied} card(s)`);

  return { lorePieces: pieces, customInstructions: instructions, changes };
}
