
export interface Scenario {
  id: string;
  userId?: string;
  creatorName?: string;
  name: string;
  description: string;
  image?: string;
  tags: string[];
  backstory: string;
  greetingMessage?: string;
  customInstructions?: string;
  lorePieces: LorePiece[];
  characters: StoryCharacter[];
  settings: ScenarioSettings;
  createdAt: number;
}

export interface StoryCharacter {
  id: string;
  name: string;
  description: string;
  personality: string;
  avatar?: string;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  personas: Persona[];
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar?: string;
}

export type LorePieceType = 'character' | 'location' | 'object' | 'event' | 'other';

export interface LorePiece {
  id: string;
  type: LorePieceType;
  title: string;
  description: string;
  content: string;
  weight: number;
  pinned: boolean;
  playable?: boolean;
  hidden?: boolean;
  smartActivation: boolean;
  triggers: string[];
  linkedPieces: string[];
  avatar?: string;
}

export interface ScenarioSettings {
  forceCharacter?: string;
  separateUserCharacter: boolean;
  sensitiveContent: boolean;
  isPublic: boolean;
  allowCustomization: boolean;
  hidePrompts: boolean;
  allowCommenting: boolean;
}

export interface Chat {
  id: string;
  scenarioId: string;
  title: string;
  messages: Message[];
  memories: Memory[];
  userCharacter?: UserCharacter;
  settings: ChatSettings;
  createdAt: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  characterName?: string;
  versions?: string[];
  currentVersionIndex?: number;
}

export interface Memory {
  id: string;
  content: string;
  pinned: boolean;
  timestamp: number;
}

export interface UserCharacter {
  id: string;
  name: string;
  description: string;
  avatar?: string;
}

export interface ChatSettings {
  model: string;
  responseLength: 'short' | 'medium' | 'long';
  streamResponse: boolean;
  showSuggestions: boolean;
  fontSize: number;
  typingSpeed: number;
  customInstructions?: string;
}
