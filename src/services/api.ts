/**
 * API Client & Service Layer
 * 
 * Provides a centralized Axios-based HTTP client with automatic JWT auth token
 * injection, plus a comprehensive `apiService` object with methods for every
 * server endpoint used in the application.
 * 
 * Tokens and user data are cached in localStorage under the `fl_token` and
 * `fl_user` keys respectively.
 * 
 * @module api
 */

import axios from 'axios';
import { Scenario } from '../types';

/** What a re-import changes (see lib/fictionlabReimport.js summarizeReimport) */
/** A backup file kept on the server (error set when it cannot be restored) */
export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  version?: string;
  label?: string;
  pictures?: number | null;
  counts?: { users: number; scenarios: number; chats: number } | null;
  error?: string;
}

/** Nightly backup: hour is server time; last is when it last ran (ms, 0 = never) */
export interface BackupSchedule {
  enabled: boolean;
  hour: number;
  keep: number;
  last: number;
  error?: string;
}

export interface ReimportSummary {
  fields: string[];
  /** The file is missing its lore text (hidden by its creator); it will not be applied */
  hollow?: boolean;
  /** The file has no lore cards (made before Fictionlab had lore): the scenario keeps its lore */
  keepsLore?: boolean;
  lore: {
    before: number; after: number; added: string[]; removed: string[];
    neverSentBefore: number; neverSentAfter: number; workingLinksBefore: number; workingLinksAfter: number;
  };
  characters: { before: number; after: number };
}

/** One file in the admin's bulk re-import dry run */
export interface ReimportRow {
  fileName: string;
  title?: string;
  status: 'source' | 'name' | 'ambiguous' | 'none' | 'not a scenario';
  candidates?: Array<{ id: string; name: string }>;
  summary?: ReimportSummary;
}

/** What the server makes of a Fictionlab export (see lib/fictionlab.js) */
export interface FictionlabImport {
  draft: Omit<Scenario, 'id' | 'createdAt' | 'image'> & { sourceId?: string };
  report: {
    pieces: number;
    rescaledWeights: boolean;
    mergedRules: string[];
    noTriggers: string[];
    subPieces: string[];
    storyCards: number;
    charReplaced: number;
    droppedLinks: number;
  };
  /** Remote images to download: cover, avatars by character/lore id, introduction images */
  imageUrls: { cover: string; characters: Record<string, string>; lore: Record<string, string>; introduction: string[] };
}

/**
 * Pre-configured Axios instance with base URL pointing to the server API.
 * All requests automatically include the auth token from localStorage.
 */
export const api = axios.create({
  baseURL: '/api',
});

/**
 * Request interceptor that adds the JWT Bearer token to every outgoing request.
 * The token is read from localStorage (`fl_token`) on each request.
 */
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fl_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Response interceptor that catches 401 Unauthorized responses.
 * When the server rejects a token (e.g., after a server restart with a new JWT secret),
 * this clears the stored auth data and redirects to the login page.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('fl_token');
      localStorage.removeItem('fl_user');
      // Dispatch a custom event so the React app can react without a full page reload
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    if (error.response?.status === 429) {
      // Dispatch a custom event so the React app can show a toast notification
      window.dispatchEvent(new CustomEvent('ratelimit:exceeded', {
        detail: error.response.data?.error || 'Too many requests. Please try again later.'
      }));
    }
    return Promise.reject(error);
  }
);

/**
 * Complete API service with methods for all backend endpoints.
 * 
 * Organized by domain:
 * - Auth: login, register, logout, session management
 * - Personas: CRUD for user character personas
 * - System Settings: Admin-only global configuration
 * - LLM Settings: LLM parameters (readable by any authenticated user)
 * - User Settings: Per-user preferences (colors, etc.)
 * - Scenarios: CRUD for story scenarios
 * - Chats: CRUD for chat sessions
 * - Trash: Soft-delete, restore, permanent delete for chats and scenarios
 * - Admin/Users: Admin-only user management
 */
export const apiService = {
  // ── Auth ──
  
  /**
   * Authenticates a user and stores the JWT + user data in localStorage.
   * @param username - The user's login name
   * @param password - The user's password
   * @returns The authenticated user object
   */
  login: async (username: string, password: string) => {
    const response = await api.post('/login', { username, password });
    const { user, token } = response.data;
    localStorage.setItem('fl_token', token);
    localStorage.setItem('fl_user', JSON.stringify(user));
    return user;
  },

  /**
   * Registers a new user account and automatically logs them in.
   * @param username - Desired username
   * @param password - Desired password
   * @returns The newly created user object
   */
  register: async (username: string, password: string) => {
    const response = await api.post('/register', { username, password });
    const { user, token } = response.data;
    localStorage.setItem('fl_token', token);
    localStorage.setItem('fl_user', JSON.stringify(user));
    return user;
  },

  /**
   * Retrieves the currently logged-in user from localStorage cache.
   * @returns The user object, or null if not logged in
   */
  getCurrentUser: () => {
    const data = localStorage.getItem('fl_user');
    return data ? JSON.parse(data) : null;
  },

  /**
   * Clears local auth data (logs the user out client-side).
   */
  logout: () => {
    localStorage.removeItem('fl_user');
    localStorage.removeItem('fl_token');
  },

  /**
   * Fetches the latest user data from the server (includes persona list).
   * Falls back to cached user if the server request fails.
   * @returns The refreshed user object
   */
  refreshCurrentUser: async () => {
    try {
      const response = await api.get('/users/me');
      const user = response.data;
      localStorage.setItem('fl_user', JSON.stringify(user));
      return user;
    } catch {
      return apiService.getCurrentUser();
    }
  },

  // ── Personas ──

  /**
   * Fetches all personas for the current user.
   * @returns Array of persona objects (empty on failure)
   */
  getPersonas: async (): Promise<any[]> => {
    try {
      const response = await api.get('/personas');
      return response.data;
    } catch (e) {
      console.error('Failed to fetch personas', e);
      return [];
    }
  },

  /**
   * Creates or updates a persona. Uses upsert semantics (saves by ID).
   * @param persona - The persona object to save
   * @returns The saved persona
   */
  savePersona: async (persona: any) => {
    const response = await api.post('/personas', persona);
    return response.data;
  },

  /**
   * Deletes a persona by its ID.
   * @param id - The persona's unique identifier
   */
  deletePersona: async (id: string) => {
    await api.delete(`/personas/${id}`);
  },

  // ── System Settings (Admin only) ──

  /**
   * Fetches all system settings (API key, site name, LLM params).
   * @returns The system settings object
   */
  getSystemSettings: async () => {
    const response = await api.get('/system/settings');
    return response.data;
  },

  /**
   * Updates system settings (admin only on server side).
   * @param settings - Partial settings object to update
   * @returns The updated settings
   */
  updateSystemSettings: async (settings: any) => {
    const response = await api.post('/system/settings', settings);
    return response.data;
  },

  // ── LLM Settings (any authenticated user can read) ──

  /**
   * Fetches LLM configuration (temperature, token limits, memory intervals, etc.).
   * Unlike system settings, these are readable by any authenticated user.
   * @returns The LLM settings object
   */
  getLlmSettings: async () => {
    const response = await api.get('/system/llm-settings');
    return response.data;
  },

  // ── User Settings ──

  /**
   * Fetches the current user's personal settings (color preferences, etc.).
   * @returns The user settings object
   */
  getUserSettings: async () => {
    const response = await api.get('/users/settings');
    return response.data;
  },

  /**
   * Updates the current user's personal settings.
   * @param settings - The settings object to save
   * @returns The updated settings
   */
  updateUserSettings: async (settings: any) => {
    const response = await api.post('/users/settings', settings);
    return response.data;
  },

  // ── DeepSeek Models ──

  /**
   * Fetches available model IDs from the DeepSeek API.
   * Admin-only endpoint that proxies DeepSeek's list-models API.
   * @returns The DeepSeek API response with model data, or null on failure
   */
  getDeepseekModels: async () => {
    try {
      const response = await api.get('/deepseek/models');
      return response.data;
    } catch (e) {
      console.error('Failed to fetch DeepSeek models:', e);
      return null;
    }
  },

  // ── Scenarios ──

  /**
   * Fetches scenarios accessible to the current user with pagination.
   * @param page - Page number (1-based, defaults to 1)
   * @param limit - Items per page (defaults to 50, max 100)
   * @returns Object with `scenarios` array and `pagination` metadata
   */
  getScenarios: async (
    page: number = 1,
    limit: number = 50,
    filters: { tab?: 'explore' | 'mine-public' | 'mine-private'; q?: string } = {}
  ) => {
    // Errors are thrown so the page can show them instead of "no results"
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters.tab) params.set('tab', filters.tab);
    if (filters.q) params.set('q', filters.q);
    const response = await api.get(`/scenarios?${params}`);
    return response.data;
  },

  /**
   * Fetches a single scenario by its ID.
   * @param id - The scenario's unique identifier
   * @returns The scenario object
   */
  getScenario: async (id: string) => {
    const response = await api.get(`/scenarios/${id}`);
    return response.data;
  },

  /**
   * Creates or updates a scenario (upsert semantics by ID).
   * @param scenario - The scenario object to save
   * @returns The saved scenario
   */
  saveScenario: async (scenario: any) => {
    const response = await api.post('/scenarios', scenario);
    return response.data;
  },

  /**
   * Turns a Fictionlab export (the parsed file) into a scenario draft on the
   * server. Nothing is saved. Throws with the server's message if the file is
   * not a scenario.
   */
  parseFictionlab: async (file: unknown): Promise<FictionlabImport> => {
    try {
      const response = await api.post('/import/fictionlab', { file });
      return response.data;
    } catch (e: any) {
      throw new Error(e?.response?.data?.error || 'Could not read this file');
    }
  },

  /**
   * Updates an existing scenario from a Fictionlab export, keeping its id,
   * chats, name, settings and pictures. Without apply, returns only what
   * would change.
   */
  reimportScenario: async (scenarioId: string, file: unknown, apply: boolean): Promise<{ summary: ReimportSummary }> => {
    try {
      const response = await api.post(`/scenarios/${scenarioId}/reimport`, { file, apply });
      return response.data;
    } catch (e: any) {
      throw new Error(e?.response?.data?.error || 'Could not update from this file');
    }
  },

  /** Admin: lore health of every scenario (dry run) */
  getLoreHealth: async (): Promise<{ totals: Record<string, number>; rows: Array<{ id: string; name: string; counts: Record<string, number>; safeChanges: string[] }> }> => {
    const response = await api.get('/admin/lore-health');
    return response.data;
  },

  /** Admin: applies the safe lore fixes to every scenario (backs up first) */
  applyLoreHealth: async (): Promise<{ backup: string; changed: number; failed: Array<{ id: string; name: string; error: string }> }> => {
    const response = await api.post('/admin/lore-health/apply');
    return response.data;
  },

  /** Admin: backups kept on the server, newest first */
  listBackups: async (): Promise<{ backups: BackupInfo[]; folder: string; schedule: BackupSchedule }> => {
    const response = await api.get('/admin/backups');
    return response.data;
  },

  /** Admin: nightly backup settings */
  saveBackupSchedule: async (schedule: Partial<Pick<BackupSchedule, 'enabled' | 'hour' | 'keep'>>): Promise<void> => {
    await api.post('/admin/backups/schedule', schedule);
  },

  /** Admin: makes a backup of the database and every picture */
  createBackup: async (): Promise<BackupInfo> => {
    const response = await api.post('/admin/backups', undefined, { timeout: 0 });
    return response.data;
  },

  /** Admin: deletes a backup */
  deleteBackup: async (name: string): Promise<void> => {
    await api.delete(`/admin/backups/${encodeURIComponent(name)}`);
  },

  /** Admin: a one-time link that downloads a backup */
  backupDownloadUrl: async (name: string): Promise<string> => {
    const response = await api.post(`/admin/backups/${encodeURIComponent(name)}/link`);
    return response.data.url;
  },

  /** Admin: replaces everything with a backup (a safety backup is made first) */
  restoreBackup: async (name: string): Promise<{ safetyBackup: string; counts: { users: number; scenarios: number; chats: number } }> => {
    const response = await api.post(`/admin/backups/${encodeURIComponent(name)}/restore`, undefined, { timeout: 0 });
    return response.data;
  },

  /** Admin: uploads a backup file (checked, not restored); onProgress gets 0-1 */
  uploadBackup: async (file: File, onProgress: (share: number) => void): Promise<BackupInfo> => {
    const response = await api.post('/admin/backups/upload', file, {
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 0,
      onUploadProgress: e => onProgress(e.total ? e.loaded / e.total : 0),
    });
    return response.data;
  },

  /** Admin: matches export files to scenarios (dry run) */
  matchFictionlabFiles: async (files: Array<{ name: string; file: unknown }>): Promise<{ rows: ReimportRow[] }> => {
    const response = await api.post('/admin/fictionlab/match', { files });
    return response.data;
  },

  /** Admin: re-imports files into the chosen scenarios (send backup: true with the first batch) */
  applyFictionlabFiles: async (items: Array<{ scenarioId: string; file: unknown }>, backup: boolean): Promise<{ backup?: string; results: Array<{ scenarioId: string; ok: boolean; error?: string; summary?: ReimportSummary }> }> => {
    const response = await api.post('/admin/fictionlab/apply', { items, backup });
    return response.data;
  },

  /**
   * Deletes (soft-deletes) a scenario by its ID — moves to trash.
   * @param id - The scenario's unique identifier
   */
  deleteScenario: async (id: string) => {
    await api.delete(`/scenarios/${id}`);
  },

  // ── Chats ──

  /**
   * Fetches all chats for the current user (or all chats for admins).
   * @returns Array of chat objects (empty on failure)
   */
  getChats: async () => {
    // Errors are thrown so the page can show them instead of "no chats"
    const response = await api.get('/chats');
    return response.data;
  },

  /**
   * Fetches a single chat by its ID, with full messages and memories.
   * @param id - The chat's unique identifier
   * @returns The chat object
   */
  getChat: async (id: string) => {
    const response = await api.get(`/chats/${id}`);
    return response.data;
  },

  /**
   * Creates or updates a chat (upsert semantics by ID).
   * @param chat - The chat object to save
   * @returns The saved chat
   */
  saveChat: async (chat: any) => {
    const response = await api.post('/chats', chat);
    return response.data;
  },

  /**
   * Deletes (soft-deletes) a chat by its ID — moves to trash.
   * @param id - The chat's unique identifier
   */
  deleteChat: async (id: string) => {
    await api.delete(`/chats/${id}`);
  },

  /**
   * Changes the current user's password (requires current password verification).
   * @param currentPassword - The user's existing password
   * @param newPassword - The desired new password
   * @returns The server response
   */
  changePassword: async (currentPassword: string, newPassword: string) => {
    const response = await api.post('/users/change-password', { currentPassword, newPassword });
    // Changing the password signs out all sessions; keep this one with the new token
    if (response.data?.token) localStorage.setItem('fl_token', response.data.token);
    return response.data;
  },

  /**
   * Deletes ALL chats belonging to the current user.
   */
  deleteAllChats: async () => {
    await api.delete('/chats/all');
  },

  // ── Trash / Recycle Bin ──

  /**
   * Fetches all trashed items (chats and scenarios) for the current user.
   * @returns An object with `chats` and `scenarios` arrays
   */
  getTrash: async (): Promise<{ chats: any[]; scenarios: any[] }> => {
    try {
      const response = await api.get('/trash');
      return response.data;
    } catch (e) {
      console.error('Failed to fetch trash', e);
      return { chats: [], scenarios: [] };
    }
  },

  /**
   * Restores a soft-deleted chat from the trash.
   * @param id - The chat's unique identifier
   */
  restoreChat: async (id: string) => {
    const response = await api.post(`/trash/restore/chat/${id}`);
    return response.data;
  },

  /**
   * Restores a soft-deleted scenario from the trash.
   * @param id - The scenario's unique identifier
   */
  restoreScenario: async (id: string) => {
    const response = await api.post(`/trash/restore/scenario/${id}`);
    return response.data;
  },

  /**
   * Permanently deletes a chat from the trash (final deletion).
   * @param id - The chat's unique identifier
   */
  permanentlyDeleteChat: async (id: string) => {
    await api.delete(`/trash/chat/${id}`);
  },

  /**
   * Permanently deletes a scenario from the trash (final deletion).
   * @param id - The scenario's unique identifier
   */
  permanentlyDeleteScenario: async (id: string) => {
    await api.delete(`/trash/scenario/${id}`);
  },

  /**
   * Empties all trashed items for the current user.
   * Permanently deletes all trashed chats and scenarios.
   */
  emptyTrash: async () => {
    const response = await api.delete('/trash/empty');
    return response.data;
  },

  // ── Admin: User Management ──

  /**
   * Fetches all users (admin only).
   * @returns Array of user objects with metadata
   */
  getAdminUsers: async () => {
    const response = await api.get('/admin/users');
    return response.data;
  },

  /**
   * Creates a new user (admin only).
   * @param user - Object with username, password, and role
   * @returns The created user
   */
  createAdminUser: async (user: any) => {
    const response = await api.post('/admin/users', user);
    return response.data;
  },

  /**
   * Updates an existing user's properties (admin only).
   * @param id - The user's ID
   * @param updates - Object with fields to update (username, password, role)
   * @returns The updated user
   */
  updateAdminUser: async (id: string, updates: any) => {
    const response = await api.put(`/admin/users/${id}`, updates);
    return response.data;
  },

  /**
   * Deletes a user and all their associated data (admin only).
   * @param id - The user's ID to delete
   */
  deleteAdminUser: async (id: string) => {
    await api.delete(`/admin/users/${id}`);
  },
};
