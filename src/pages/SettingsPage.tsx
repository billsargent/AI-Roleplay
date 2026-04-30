import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User as UserIcon, Trash2, AlertTriangle, Save, CheckCircle, LogOut, Palette, Lock, Archive } from 'lucide-react';

import { apiService } from '../services/api';
import { PersonaManager } from '../components/PersonaManager';
import { useNotifications } from '../utils/notifications';

export const SettingsPage: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const navigate = useNavigate();

  const [siteName, setSiteName] = useState('');

  // User settings
  const [dialogColor, setDialogColor] = useState('#ffa742');
  const [narrationColor, setNarrationColor] = useState('#b0b0b0');
  const [chatBubbleColor, setChatBubbleColor] = useState('#413e74');
  const [userSettingsSaved, setUserSettingsSaved] = useState(false);

  // Change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const user = apiService.getCurrentUser();

  const handleChangePassword = async () => {
    if (!currentPassword) {
      showToast('Please enter your current password', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('New password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }
    setChangingPassword(true);
    try {
      await apiService.changePassword(currentPassword, newPassword);
      showToast('Password changed successfully', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to change password';
      showToast(msg, 'error');
    } finally {
      setChangingPassword(false);
    }
  };


  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load site name for footer (regular users must use llm-settings endpoint)
        const settings = await apiService.getLlmSettings();
        setSiteName(settings.siteName || '');

        // Load user settings (dialog/narration colors)
        const userSettings = await apiService.getUserSettings();
        if (userSettings.dialogColor) setDialogColor(userSettings.dialogColor);
        if (userSettings.narrationColor) setNarrationColor(userSettings.narrationColor);
        if (userSettings.chatBubbleColor) setChatBubbleColor(userSettings.chatBubbleColor);
      } catch (e) {
        console.error('Failed to load settings', e);
      }
    };
    loadSettings();
  }, []);

  const handleSaveUserSettings = async () => {
    try {
      await apiService.updateUserSettings({
        dialogColor,
        narrationColor,
        chatBubbleColor,
      });
      setUserSettingsSaved(true);
      setTimeout(() => setUserSettingsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save user settings:', err);
    }
  };

  const clearAllData = async () => {
    if (await showConfirm('WARNING: This will clear your local session. You will need to log in again. Are you sure?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const deleteAllChats = async () => {
    if (await showConfirm('WARNING: This will permanently delete ALL your chats from the server. This cannot be undone. Are you sure?')) {
      try {
        await apiService.deleteAllChats();
        showToast('All chats have been deleted.', 'success');
      } catch (err) {
        showToast('Failed to delete chats.', 'error');
      }
    }
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-zinc-400">Manage your account and preferences</p>
      </div>

      {/* User Profile */}
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

        {/* Login Name */}
        <div className="border-t border-zinc-800 pt-6">
          <div className="flex items-center gap-3 mb-2">
            <UserIcon size={18} className="text-indigo-500" />
            <h3 className="text-lg font-bold text-white">Account</h3>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-1">Logged in as</p>
            <p className="text-xl font-bold text-white">{user?.username || 'Unknown'}</p>
            {user?.role && (
              <span className="inline-block mt-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-600/10 text-indigo-400 border border-indigo-600/20">
                {user.role}
              </span>
            )}
          </div>
        </div>

        {/* Change Password */}
        <div className="border-t border-zinc-800 pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={18} className="text-indigo-500" />
            <h3 className="text-lg font-bold text-white">Change Password</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase tracking-wider">Current Password</label>
              <input 
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Enter current password"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase tracking-wider">New Password</label>
              <input 
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="At least 6 characters"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase tracking-wider">Confirm New Password</label>
              <input 
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Re-enter new password"
              />
            </div>
            <button 
              onClick={handleChangePassword}
              disabled={changingPassword}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2"
            >
              <Lock size={18} />
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>

        {/* Dialog & Narration Colors */}

        <div className="border-t border-zinc-800 pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={18} className="text-indigo-500" />

            <h3 className="text-lg font-bold text-white">Chat Appearance</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                Dialog Highlight Color
              </label>
              <div className="flex items-center gap-3">
                <input 
                  type="color"
                  value={dialogColor}
                  onChange={(e) => setDialogColor(e.target.value)}
                  className="w-12 h-12 rounded-xl border border-zinc-700 bg-transparent cursor-pointer"
                />
                <input 
                  type="text"
                  value={dialogColor}
                  onChange={(e) => setDialogColor(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">Color for quoted dialogue text in messages</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                Narration Color
              </label>
              <div className="flex items-center gap-3">
                <input 
                  type="color"
                  value={narrationColor}
                  onChange={(e) => setNarrationColor(e.target.value)}
                  className="w-12 h-12 rounded-xl border border-zinc-700 bg-transparent cursor-pointer"
                />
                <input 
                  type="text"
                  value={narrationColor}
                  onChange={(e) => setNarrationColor(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">Color of AI narration in chat</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                Chat Bubble Color
              </label>
              <div className="flex items-center gap-3">
                <input 
                  type="color"
                  value={chatBubbleColor}
                  onChange={(e) => setChatBubbleColor(e.target.value)}
                  className="w-12 h-12 rounded-xl border border-zinc-700 bg-transparent cursor-pointer"
                />
                <input 
                  type="text"
                  value={chatBubbleColor}
                  onChange={(e) => setChatBubbleColor(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <p className="mt-1 text-[10px] text-zinc-600">Background color of your chat message bubbles</p>
            </div>
          </div>
          <button 
            onClick={handleSaveUserSettings}
            className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2"
          >
            {userSettingsSaved ? <CheckCircle size={18} /> : <Save size={18} />}
            {userSettingsSaved ? 'Saved' : 'Save Colors'}
          </button>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="bg-zinc-900 border border-red-900/30 rounded-3xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-2">
           <div className="p-2 bg-red-900/20 text-red-500 rounded-lg">
              <AlertTriangle size={20} />
           </div>
           <h2 className="text-xl font-bold text-white">Danger Zone</h2>
        </div>

        <div>
          <button 
            onClick={() => navigate('/trash')}
            className="w-full flex items-center justify-center gap-2 py-4 bg-amber-900/10 text-amber-500 border border-amber-900/30 rounded-2xl hover:bg-amber-900/20 transition-all font-bold"
          >
            <Archive size={20} />
            Trash (Deleted Items)
          </button>
          <p className="mt-2 text-xs text-center text-zinc-600">
            View and manage your recently deleted chats and scenarios.
          </p>
        </div>

        <div className="border-t border-red-900/20 pt-4">
          <button 
            onClick={clearAllData}
            className="w-full flex items-center justify-center gap-2 py-4 bg-red-900/10 text-red-500 border border-red-900/30 rounded-2xl hover:bg-red-900/20 transition-all font-bold"
          >
            <LogOut size={20} />
            Clear Local Session & Logout
          </button>
          <p className="mt-2 text-xs text-center text-zinc-600">
            Clears your local auth session. Server data (API key, scenarios, chats) is unaffected.
          </p>
        </div>

        <div className="border-t border-red-900/20 pt-4">
          <button 
            onClick={deleteAllChats}
            className="w-full flex items-center justify-center gap-2 py-4 bg-red-900/10 text-red-500 border border-red-900/30 rounded-2xl hover:bg-red-900/20 transition-all font-bold"
          >
            <Trash2 size={20} />
            Delete All My Chats
          </button>
          <p className="mt-2 text-xs text-center text-zinc-600">
            Permanently deletes ALL your chats from the server. This cannot be undone.
          </p>
        </div>

      </section>

      <div className="text-center pt-8">
         <p className="text-xs text-zinc-700 font-bold uppercase tracking-[0.2em]">{siteName || (localStorage.getItem('fl_siteName') || 'AI Roleplay')} v1.0.0</p>
      </div>

    </div>
  );
};
