
import axios from 'axios';
import { storage } from './storage';

// Detect if we're running on a port that might have the API
const api = axios.create({
  baseURL: '/api',
});

// Use interceptor to add token if it exists
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fl_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const isLocalOnly = () => {
  // If we're not on the server port or in a preview environment without the real server
  return window.location.port === '5173'; 
};

export const apiService = {
  // Auth
  login: async (username: string, password?: string) => {
    if (isLocalOnly()) {
      console.log('Local Mode: Simulating login');
      const mockUser = { id: 'local-user', username, role: 'admin', personas: JSON.parse(localStorage.getItem('fl_personas') || '[]') };
      localStorage.setItem('fl_user', JSON.stringify(mockUser));
      localStorage.setItem('fl_token', 'local-token');
      return mockUser;
    }

    try {
      const response = await api.post('/login', { username, password });
      const { user, token } = response.data;
      localStorage.setItem('fl_token', token);
      localStorage.setItem('fl_user', JSON.stringify(user));
      return user;
    } catch (err: any) {
      console.error('Login error:', err);
      // If 404, the server routes might not be set up or we are in a static preview
      if (err.response?.status === 404 || !err.response) {
        const mockUser = { id: 'local-user', username, role: 'admin', personas: JSON.parse(localStorage.getItem('fl_personas') || '[]') };
        localStorage.setItem('fl_user', JSON.stringify(mockUser));
        localStorage.setItem('fl_token', 'local-token');
        return mockUser;
      }
      throw err;
    }
  },
  register: async (username: string, password?: string) => {
    if (isLocalOnly()) {
      console.log('Local Mode: Simulating registration');
      const mockUser = { id: 'local-user', username, role: 'admin', personas: [] };
      localStorage.setItem('fl_user', JSON.stringify(mockUser));
      localStorage.setItem('fl_token', 'local-token');
      return mockUser;
    }

    try {
      const response = await api.post('/register', { username, password });
      const { user, token } = response.data;
      localStorage.setItem('fl_token', token);
      localStorage.setItem('fl_user', JSON.stringify(user));
      return user;
    } catch (err: any) {
      console.error('Registration error:', err);
      if (err.response?.status === 404 || !err.response) {
        const mockUser = { id: 'local-user', username, role: 'admin', personas: [] };
        localStorage.setItem('fl_user', JSON.stringify(mockUser));
        localStorage.setItem('fl_token', 'local-token');
        return mockUser;
      }
      throw err;
    }
  },
  getCurrentUser: () => {
    const data = localStorage.getItem('fl_user');
    return data ? JSON.parse(data) : null;
  },
  logout: () => {
    localStorage.removeItem('fl_user');
    localStorage.removeItem('fl_token');
  },

  // Personas
  getPersonas: (): any[] => {
    const user = apiService.getCurrentUser();
    return user?.personas || [];
  },
  savePersona: async (persona: any) => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      const personas = JSON.parse(localStorage.getItem('fl_personas') || '[]');
      const index = personas.findIndex((p: any) => p.id === persona.id);
      if (index >= 0) personas[index] = persona;
      else personas.push(persona);
      localStorage.setItem('fl_personas', JSON.stringify(personas));
      
      const user = apiService.getCurrentUser();
      if (user) {
        user.personas = personas;
        localStorage.setItem('fl_user', JSON.stringify(user));
      }
      return persona;
    }

    const response = await api.post('/personas', persona);
    const user = apiService.getCurrentUser();
    if (user) {
      const index = user.personas.findIndex((p: any) => p.id === persona.id);
      if (index >= 0) user.personas[index] = response.data;
      else user.personas.push(response.data);
      localStorage.setItem('fl_user', JSON.stringify(user));
    }
    return response.data;
  },
  deletePersona: async (id: string) => {
    await api.delete(`/personas/${id}`);
    const user = apiService.getCurrentUser();
    if (user) {
      user.personas = user.personas.filter((p: any) => p.id !== id);
      localStorage.setItem('fl_user', JSON.stringify(user));
    }
  },

  // System Settings (Admin only)
  getSystemSettings: async () => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      const settings = localStorage.getItem('fl_system_settings');
      return settings ? JSON.parse(settings) : { deepseekKey: storage.getApiKey() };
    }
    const response = await api.get('/system/settings');
    return response.data;
  },
  updateSystemSettings: async (settings: any) => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      localStorage.setItem('fl_system_settings', JSON.stringify(settings));
      return settings;
    }
    const response = await api.post('/system/settings', settings);
    return response.data;
  },

  // Scenarios
  getScenarios: async () => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      const local = storage.getScenarios();
      return local;
    }
    try {
      const response = await api.get('/scenarios');
      return response.data;
    } catch (e) {
      return storage.getScenarios();
    }
  },
  saveScenario: async (scenario: any) => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      storage.saveScenario(scenario);
      return scenario;
    }
    const response = await api.post('/scenarios', scenario);
    return response.data;
  },
  deleteScenario: async (id: string) => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      storage.deleteScenario(id);
      return;
    }
    await api.delete(`/scenarios/${id}`);
  },

  // Chats
  getChats: async () => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      return storage.getChats();
    }
    try {
      const response = await api.get('/chats');
      return response.data;
    } catch (e) {
      return storage.getChats();
    }
  },
  saveChat: async (chat: any) => {
    if (localStorage.getItem('fl_token') === 'local-token') {
      storage.saveChat(chat);
      return chat;
    }
    const response = await api.post('/chats', chat);
    return response.data;
  }
};
