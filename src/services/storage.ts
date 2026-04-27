
import { Scenario, Chat, UserCharacter } from '../types';

const STORAGE_KEYS = {
  SCENARIOS: 'fictionlab_scenarios',
  CHATS: 'fictionlab_chats',
  USER_CHARACTERS: 'fictionlab_user_characters',
  API_KEY: 'fictionlab_deepseek_key',
};

export const storage = {
  getScenarios: (): Scenario[] => {
    const data = localStorage.getItem(STORAGE_KEYS.SCENARIOS);
    return data ? JSON.parse(data) : [];
  },
  saveScenario: (scenario: Scenario) => {
    const scenarios = storage.getScenarios();
    const index = scenarios.findIndex(s => s.id === scenario.id);
    if (index >= 0) {
      scenarios[index] = scenario;
    } else {
      scenarios.push(scenario);
    }
    localStorage.setItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(scenarios));
  },
  deleteScenario: (id: string) => {
    const scenarios = storage.getScenarios().filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEYS.SCENARIOS, JSON.stringify(scenarios));
  },
  getChats: (): Chat[] => {
    const data = localStorage.getItem(STORAGE_KEYS.CHATS);
    return data ? JSON.parse(data) : [];
  },
  saveChat: (chat: Chat) => {
    const chats = storage.getChats();
    const index = chats.findIndex(c => c.id === chat.id);
    if (index >= 0) {
      chats[index] = chat;
    } else {
      chats.push(chat);
    }
    localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
  },
  deleteChat: (id: string) => {
    const chats = storage.getChats().filter(c => c.id !== id);
    localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
  },
  getUserCharacters: (): UserCharacter[] => {
    const data = localStorage.getItem(STORAGE_KEYS.USER_CHARACTERS);
    return data ? JSON.parse(data) : [];
  },
  saveUserCharacter: (char: UserCharacter) => {
    const chars = storage.getUserCharacters();
    const index = chars.findIndex(c => c.id === char.id);
    if (index >= 0) {
      chars[index] = char;
    } else {
      chars.push(char);
    }
    localStorage.setItem(STORAGE_KEYS.USER_CHARACTERS, JSON.stringify(chars));
  },
  getApiKey: (): string => {
    return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
  },
  saveApiKey: (key: string) => {
    localStorage.setItem(STORAGE_KEYS.API_KEY, key);
  }
};
