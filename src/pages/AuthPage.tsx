
import React, { useState } from 'react';
import { LogIn, User, Sparkles, Shield, Key } from 'lucide-react';
import { apiService } from '../services/api';

export const AuthPage: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegistering) {
        await apiService.register(username, password);
      } else {
        await apiService.login(username, password);
      }
      onLogin();
    } catch (err: any) {
      console.error('Auth detail error:', err);
      const msg = err.response?.data?.error || err.message || 'Authentication failed';
      setError(msg);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 bg-zinc-900 border border-zinc-800 p-8 rounded-3xl shadow-2xl relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl" />
        
        <div className="text-center relative">
          <div className="inline-flex p-4 bg-indigo-600/10 rounded-2xl mb-4">
             <Sparkles className="text-indigo-500" size={32} />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">FictionLab</h1>
          <p className="text-zinc-500 mt-2">{isRegistering ? 'Create your account to start roleplaying' : 'Sign in to access your stories'}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 relative">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1">Username</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={20} />
              <input 
                type="text"
                placeholder="Enter your username"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1">Password</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={20} />
              <input 
                type="password" 
                placeholder="••••••••"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error && <p className="text-red-500 text-xs text-center font-bold">{error}</p>}

          <button 
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-indigo-900/20 transition-all active:scale-95"
          >
            <LogIn size={20} />
            {isRegistering ? 'GET STARTED' : 'SIGN IN'}
          </button>
        </form>

        <div className="text-center pt-4 relative">
          <button 
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-sm text-zinc-500 hover:text-indigo-400 font-bold transition-colors"
          >
            {isRegistering ? 'Already have an account? Sign in' : "Don't have an account? Register"}
          </button>
        </div>

        <div className="pt-8 border-t border-zinc-800 flex items-center justify-center gap-4 relative">
           <div className="flex items-center gap-1 text-[10px] text-zinc-700 font-black uppercase">
              <Shield size={12} /> Privacy Guaranteed
           </div>
           <div className="w-1 h-1 bg-zinc-800 rounded-full" />
           <div className="flex items-center gap-1 text-[10px] text-zinc-700 font-black uppercase">
              Encrypted Local Data
           </div>
        </div>
      </div>
    </div>
  );
};
