/**
 * Reads the scene line many scenarios ask the AI to start each reply with,
 * e.g. "[Day 1 ✦ Monday 6:42 PM ✦ Gym Storage Room]" or
 * "[ Kitchen - Tuesday - 08:30am ]". The parts come in any order and with
 * many separators, so each part is classified by what it looks like.
 *
 * @module scene
 */

export interface Scene {
  /** Where it is ("Gym Storage Room"); '' when the header names no place */
  place: string;
  /** "Day 3", "Monday", "14 March" ... */
  day: string;
  /** "6:42 PM", "evening" ... */
  time: string;
  /** Every part as written, in order */
  parts: string[];
}

/** Common separators, plus decorative emoji used between parts ("🌹") */
const SEPARATORS = /\s*(?:✦|✧|★|☆|•|·|\||—|–|\s-\s|,|;|\s\p{Extended_Pictographic}️?\s)\s*/u;
/** Emoji or symbol labels at the start of a part ("📍 Library", "🕦 11:30") */
const LEADING_SYMBOLS = /^[\p{Extended_Pictographic}\p{So}️‍\s:]+/u;
const TIME = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s?(?:am|pm)\b|\b(?:dawn|morning|noon|midday|afternoon|evening|dusk|night|midnight|late night)\b/i;
const DAY = /\bday\s*\d+\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:spring|summer|autumn|fall|winter)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/i;

/**
 * The scene line at the top of a message, or null when there is none.
 * Out-of-character notes ("[OOC: ...]") are not scene lines.
 */
export function parseSceneHeader(text: string): Scene | null {
  const first = String(text || '').trim().split('\n')[0].trim();
  const match = first.match(/^\[([^\]]{3,160})\]/);
  if (!match || /^\s*(?:ooc|note|system)\b/i.test(match[1])) return null;
  const parts = match[1].split(SEPARATORS).map(p => p.replace(LEADING_SYMBOLS, '').trim()).filter(Boolean);
  if (parts.length < 2) return null;

  let day = '';
  let time = '';
  const rest: string[] = [];
  for (const part of parts) {
    // "Monday 6:42 PM" holds both: split the time off the end
    const timeMatch = part.match(TIME);
    const dayMatch = part.match(DAY);
    if (dayMatch && timeMatch) {
      const dayPart = part.slice(0, timeMatch.index).trim() || dayMatch[0];
      day = day ? `${day} · ${dayPart}` : dayPart;
      time = time || part.slice(timeMatch.index).trim();
    } else if (dayMatch) {
      day = day ? `${day} · ${part}` : part;
    } else if (timeMatch && !time && part.length <= 30) {
      time = part;
    } else {
      rest.push(part);
    }
  }
  // Something that only says the day or time is still a scene line; the place is what is left
  if (!day && !time && rest.length < 2) return null;
  return { place: rest.join(' · '), day, time, parts };
}

/** The latest scene in a conversation (newest AI message with a scene line) */
export function latestScene(messages: Array<{ role: string; content: string }>): Scene | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    const scene = parseSceneHeader(messages[i].content);
    if (scene) return scene;
  }
  return null;
}
