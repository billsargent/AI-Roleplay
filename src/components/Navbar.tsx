/**
 * ─── Navigation Bar ───
 *
 * Responsive bottom/top navigation bar with icon links.
 * - On mobile (default): fixed to the bottom of the viewport (bottom-0)
 * - On md+ screens: fixed to the top of the viewport (md:top-0)
 *
 * Links:
 *   Explore (/scenarios) — Scenario discovery / browsing (was "Home")
 *   Create (/create)     — Scenario editor
 *   Chats (/chats)       — Chat history
 *   Admin (/admin)       — Admin panel (only visible if user.role === 'admin')
 *   Settings (/settings) — User settings & personas
 *
 * Active link is highlighted with indigo-500 via NavLink's isActive prop.
 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { PlusSquare, Settings, MessageSquare, Book, Shield } from 'lucide-react';
import { apiService } from '../services/api';

export const Navbar: React.FC = () => {
  const user = apiService.getCurrentUser();
  const isAdmin = user?.role === 'admin';

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-zinc-900 border-t border-zinc-800 flex items-center justify-around px-4 z-50 md:top-0 md:bottom-auto md:border-t-0 md:border-b">
      {/* Explore — scenario discovery and browsing */}
      <NavLink 
        to="/scenarios" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <Book size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Explore</span>
      </NavLink>

      {/* Create — scenario editor */}
      <NavLink 
        to="/create" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <PlusSquare size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Create</span>
      </NavLink>

      {/* Chats — chat history list */}
      <NavLink 
        to="/chats" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <MessageSquare size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Chats</span>
      </NavLink>

      {/* Admin — only shown for admin users */}
      {isAdmin && (
        <NavLink 
          to="/admin" 
          className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
        >
          <Shield size={20} />
          <span className="text-[10px] uppercase font-bold tracking-wider">Admin</span>
        </NavLink>
      )}

      {/* Settings — user preferences & personas */}
      <NavLink 
        to="/settings" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <Settings size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">My Profile</span>
      </NavLink>
    </nav>
  );
};
