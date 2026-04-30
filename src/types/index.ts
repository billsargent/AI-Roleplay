/**
 * ─── TypeScript Type Definitions ───
 * All shared interfaces used across the frontend application.
 *
 * These types correspond to the database schema in database/index.js
 * and are used by the API service (src/services/api.ts), page components,
 * and AI prompt assembly (src/services/deepseek.ts).
 */

/** Full scenario with all characters, lore, and settings */
export interface Scenario {
  id: string;
  userId?: string;
  /** Display name of the scenario creator (for Explore tab attribution) */
  creatorName?: string;
  name: string;
  description: string;
  /** Base64 or URL scenario image */
  image?: string;
  tags: string[];
  backstory: string;
  /** Optional first message from the AI when starting a new chat */
  greetingMessage?: string;
  customInstructions?: string;
  lorePieces: LorePiece[];
  characters: StoryCharacter[];
  settings: ScenarioSettings;
  createdAt: number;
}

/** An NPC or major character within a scenario */
export interface StoryCharacter {
  id: string;
  name: string;
  description: string;
  personality: string;
  /** Base64 or URL character avatar */
  avatar?: string;
}

/** A registered user (returned by the API, includes personas) */
export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  personas: Persona[];
}

/** A user-created persona used when roleplaying as a character in a scenario */
export interface Persona {
  id: string;
  name: string;
  description: string;
  /** Base64 or URL persona avatar */
  avatar?: string;
}

/** Thematic category for a lore piece */
export type LorePieceType = 'character' | 'location' | 'object' | 'event' | 'other';

/** A single piece of world lore — can be pinned (always sent) or smart-activated (triggered by keywords) */
export interface LorePiece {
  id: string;
  type: LorePieceType;
  title: string;
  description: string;
  content: string;
  /** Priority weight (higher = more important) */
  weight: number;
  /** Always include in the AI prompt (bypasses smart activation) */
  pinned: boolean;
  /** Whether this piece can be roleplayed as a playable character */
  playable?: boolean;
  /** If true, this lore is visible to the AI but hidden from users in the prompt viewer */
  hidden?: boolean;
  /** When true, lore is only included when certain trigger words appear in recent context */
  smartActivation: boolean;
  /** Keywords/phrases that activate this lore piece */
  triggers: string[];
  /** IDs of other lore pieces linked to this one (e.g., a location linked to an event) */
  linkedPieces: string[];
  /** Base64 or URL lore image */
  avatar?: string;
}

/** Toggleable scenario behavior flags */
export interface ScenarioSettings {
  /** If set, forces the AI to always roleplay as this specific character */
  forceCharacter?: string;
  /** Whether the user plays as their own persona instead of an NPC */
  separateUserCharacter: boolean;
  /** Content warning (18+ flag) */
  sensitiveContent: boolean;
  /** Visible to all users (vs. only the owner) */
  isPublic: boolean;
  /** Allow other users to customize the scenario */
  allowCustomization: boolean;
  /** Hide backstory/lore from the detail view (only owner sees it) */
  hidePrompts: boolean;
  /** Allow users to leave comments on the scenario */
  allowCommenting: boolean;
}

/** A single chat session tied to a scenario */
export interface Chat {
  id: string;
  userId?: string;
  scenarioId: string;
  title: string;
  messages: Message[];
  memories: Memory[];
  /** The persona the user chose when starting this chat */
  userCharacter?: UserCharacter;
  settings: ChatSettings;
  createdAt: number;
  /** Username of the chat owner (included when admin views other users' chats) */
  ownerUsername?: string;
}

/** A single message exchanged in a chat */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Name of the character who sent this message (for AI responses) */
  characterName?: string;
  /** Alternative message versions (for undo/edit) */
  versions?: string[];
  /** Index of the currently active version */
  currentVersionIndex?: number;
}

/** An AI-generated memory about the conversation */
export interface Memory {
  id: string;
  content: string;
  /** Pinned memories are never trimmed */
  pinned: boolean;
  timestamp: number;
}

/** The persona the user chose to play as in a chat session */
export interface UserCharacter {
  id: string;
  name: string;
  description: string;
  avatar?: string;
}

/** Per-chat configuration that can be changed by the user */
export interface ChatSettings {
  model: string;
  responseLength: 'short' | 'medium' | 'long';
  streamResponse: boolean;
  showSuggestions: boolean;
  fontSize: number;
  typingSpeed: number;
  customInstructions?: string;
}

/** Per-user appearance preferences (stored per-user, not per-chat) */
export interface UserSettings {
  /** Color used for quoted dialogue text in chat messages */
  dialogColor?: string;
  /** Color used for AI narration text */
  narrationColor?: string;
  /** Background color of the user's own message bubbles */
  chatBubbleColor?: string;
}

/** Global LLM configuration managed by admins */
export interface LlmSettings {
  globalInstructions: string;
  temperature: string;
  maxTokens: string;
  tokenShort: string;
  tokenMedium: string;
  tokenLong: string;
  frequencyPenalty?: string;
  presencePenalty?: string;
  siteName?: string;
  /** How often (in messages) the AI's recent context is sent as memory to the LLM */
  memorySendInterval?: string;
  /** How often (in user messages) a new memory is auto-generated */
  memoryGenerateInterval?: string;
  /** Target word count for each generated memory */
  memoryWordCount?: string;
  /** Maximum number of memories to retain (oldest are trimmed) */
  memoryMaxCount?: string;
}
