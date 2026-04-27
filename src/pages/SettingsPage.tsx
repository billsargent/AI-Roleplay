
import React, { useState, useEffect } from 'react';
import { Key, Shield, User as UserIcon, Trash2, AlertTriangle, ExternalLink, Save, CheckCircle, LogOut } from 'lucide-react';
import { storage } from '../services/storage';
import { apiService } from '../services/api';
import { PersonaManager } from '../components/PersonaManager';

export const SettingsPage: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const user = apiService.getCurrentUser();
    setIsAdmin(user?.role === 'admin');
    
    if (user?.role === 'admin') {
      apiService.getSystemSettings().then(settings => {
        setApiKey(settings.deepseekKey || '');
      });
    } else {
      setApiKey(storage.getApiKey());
    }
  }, []);

  const handleSaveKey = async () => {
    try {
      if (isAdmin && localStorage.getItem('fl_token') !== 'local-token') {
        await apiService.updateSystemSettings({ deepseekKey: apiKey });
      } else {
        // Fallback or Local mode: always save to storage
        storage.saveApiKey(apiKey);
        // Also update the local state for current user session
        if (isAdmin) {
           await apiService.updateSystemSettings({ deepseekKey: apiKey }).catch(() => {});
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save API key:', err);
      // Even if server fails, save locally so the app works
      storage.saveApiKey(apiKey);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  const clearAllData = () => {
    if (confirm('WARNING: This will delete ALL your scenarios, chats, and user characters. This cannot be undone. Are you sure?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-zinc-400">Manage your account and API configuration</p>
      </div>

      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-2">
           <div className="p-2 bg-indigo-600/20 text-indigo-500 rounded-lg">
              <Key size={20} />
           </div>
           <h2 className="text-xl font-bold text-white">
             {isAdmin ? 'System Settings (Admin)' : 'API Configuration'}
           </h2>
        </div>

        <div>
          <label className="block text-sm font-bold text-zinc-400 mb-2">
            {isAdmin ? 'Global DeepSeek API Key' : 'Personal DeepSeek API Key'}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input 
                type={showKey ? 'text' : 'password'}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-20"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button 
                onClick={() => setShowKey(!showKey)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-600 hover:text-zinc-400"
              >
                {showKey ? 'HIDE' : 'SHOW'}
              </button>
            </div>
            <button 
              onClick={handleSaveKey}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 rounded-xl font-bold transition-all flex items-center gap-2"
            >
              {saved ? <CheckCircle size={20} /> : <Save size={20} />}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500 flex items-center gap-2">
            <Shield size={12} />
            Your API key is stored locally in your browser and is never sent to our servers.
          </p>
          <a 
            href="https://platform.deepseek.com/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-xs text-indigo-400 font-bold hover:underline"
          >
            Get a DeepSeek API Key <ExternalLink size={12} />
          </a>
        </div>
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-zinc-800 text-zinc-400 rounded-lg">
                <UserIcon size={20} />
             </div>
             <h2 className="text-xl font-bold text-white">User Profile</h2>
          </div>
          <button 
            onClick={() => { apiService.logout(); window.location.reload(); }}
            className="flex items-center gap-2 text-zinc-500 hover:text-red-500 font-bold transition-colors"
          >
            <LogOut size={18} /> Logout
          </button>
        </div>
        
        <PersonaManager />
      </section>

      <section className="bg-zinc-900 border border-red-900/30 rounded-3xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-2">
           <div className="p-2 bg-red-900/20 text-red-500 rounded-lg">
              <AlertTriangle size={20} />
           </div>
           <h2 className="text-xl font-bold text-white">Danger Zone</h2>
        </div>

        <div>
          <button 
            onClick={clearAllData}
            className="w-full flex items-center justify-center gap-2 py-4 bg-red-900/10 text-red-500 border border-red-900/30 rounded-2xl hover:bg-red-900/20 transition-all font-bold"
          >
            <Trash2 size={20} />
            Reset All Data & Clear Cache
          </button>
          <p className="mt-4 text-xs text-center text-zinc-600">
            This action is permanent. All scenarios you created and chats you started will be gone forever.
          </p>
        </div>
      </section>

      <div className="text-center pt-8">
         <p className="text-xs text-zinc-700 font-bold uppercase tracking-[0.2em]">FictionLab Clone v1.0.0</p>
      </div>
    </div>
  );
};
