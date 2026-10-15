/**
 * Helpers for showing memories to players: the order they were made in,
 * which messages each one covers, and progress toward the next one.
 * Mirrors the rules in lib/prompt.js (rolling memories, "*continue*" and
 * player-written memories do not count).
 *
 * @module memories
 */
import { Memory, Message } from '../types';

/** Real story messages (no notices, no old "*continue*" turns) */
export const storyMessages = (messages: Message[]) =>
  messages.filter(m => (m.role === 'user' || m.role === 'assistant') && !(m.role === 'user' && m.content.trim() === '*continue*'));

/** Up to which message time a memory summarises (older memories: when it was made) */
export const coverageEnd = (m: Memory) => m.coveredUntil || m.timestamp;

/** Memories in story order, each with its chapter number and covered message range */
export interface Chapter {
  memory: Memory;
  number: number;
  /** 1-based positions of the first and last story message covered, if they still exist */
  from?: number;
  to?: number;
  /** Id of the first covered message (for "jump to") */
  firstMessageId?: string;
  /** Id of the message the memory's marker follows in the chat */
  anchorMessageId?: string;
}

export function chapters(memories: Memory[], messages: Message[]): Chapter[] {
  const story = storyMessages(messages);
  const sorted = [...memories].sort((a, b) => coverageEnd(a) - coverageEnd(b));
  let previousEnd = 0;
  return sorted.map((memory, i) => {
    const end = coverageEnd(memory);
    const start = memory.coveredFrom ?? (memory.source === 'user' ? end : previousEnd + 1);
    if (memory.source !== 'user') previousEnd = Math.max(previousEnd, end);
    const covered = story
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => m.timestamp >= start && m.timestamp <= end);
    const before = story.filter(m => m.timestamp <= end);
    return {
      memory,
      number: i + 1,
      from: covered.length ? covered[0].index + 1 : undefined,
      to: covered.length ? covered[covered.length - 1].index + 1 : undefined,
      firstMessageId: covered[0]?.m.id,
      anchorMessageId: before[before.length - 1]?.id,
    };
  });
}

/** Real user messages since the last summarising memory (the next one is made at the interval) */
export function messagesSinceLastMemory(memories: Memory[], messages: Message[]): number {
  const since = memories.filter(m => m.source !== 'user').reduce((t, m) => Math.max(t, coverageEnd(m)), 0);
  return storyMessages(messages).filter(m => m.role === 'user' && m.timestamp > since).length;
}
