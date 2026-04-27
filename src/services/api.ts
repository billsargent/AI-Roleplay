import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// Add auth token interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fl_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const apiService = {
  // Auth
  login: async (username: string, password: string) => {
    const response = await api.post('/login', { username, password });
    const { user, token } = response.data;
    localStorage.setItem('fl_token', token);
    localStorage.setItem('fl_user', JSON.stringify(user));
    return user;
  },
  register: async (username: string, password: string) => {
    const response = await api.post('/register', { username, password });
    const { user, token } = response.data;
    localStorage.setItem('fl_token', token);
    localStorage.setItem('fl_user', JSON.stringify(user));
    return user;
  },
  getCurrentUser: () => {
    const data = localStorage.getItem('fl_user');
    return data ? JSON.parse(data) : null;
  },
  logout: () => {
    localStorage.removeItem('fl_user');
    localStorage.removeItem('fl_token');
  },
  // Refresh user from server (includes personas)
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

  // Personas
  getPersonas: async (): Promise<any[]> => {
    try {
      const response = await api.get('/personas');
      return response.data;
    } catch (e) {
      console.error('Failed to fetch personas', e);
      return [];
    }
  },
  savePersona: async (persona: any) => {
    const response = await api.post('/personas', persona);
    return response.data;
  },
  deletePersona: async (id: string) => {
    await api.delete(`/personas/${id}`);
  },

  // System Settings (Admin only)
  getSystemSettings: async () => {
    const response = await api.get('/system/settings');
    return response.data;
  },
  updateSystemSettings: async (settings: any) => {
    const response = await api.post('/system/settings', settings);
    return response.data;
  },

  // Scenarios
  getScenarios: async () => {
    try {
      const response = await api.get('/scenarios');
      return response.data;
    } catch (e) {
      console.error('Failed to fetch scenarios', e);
      return [];
    }
  },
  getScenario: async (id: string) => {
    const response = await api.get(`/scenarios/${id}`);
    return response.data;
  },
  saveScenario: async (scenario: any) => {
    const response = await api.post('/scenarios', scenario);
    return response.data;
  },
  deleteScenario: async (id: string) => {
    await api.delete(`/scenarios/${id}`);
  },

  // Chats
  getChats: async () => {
    try {
      const response = await api.get('/chats');
      return response.data;
    } catch (e) {
      console.error('Failed to fetch chats', e);
      return [];
    }
  },
  getChat: async (id: string) => {
    const response = await api.get(`/chats/${id}`);
    return response.data;
  },
  saveChat: async (chat: any) => {
    const response = await api.post('/chats', chat);
    return response.data;
  },
  deleteChat: async (id: string) => {
    await api.delete(`/chats/${id}`);
  },
};
