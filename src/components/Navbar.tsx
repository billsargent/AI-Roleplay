
import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, PlusSquare, Settings, MessageSquare, Book } from 'lucide-react';

export const Navbar: React.FC = () => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-zinc-900 border-t border-zinc-800 flex items-center justify-around px-4 z-50 md:top-0 md:bottom-auto md:border-t-0 md:border-b">
      <NavLink 
        to="/" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <Home size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Home</span>
      </NavLink>
      
      <NavLink 
        to="/scenarios" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <Book size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Explore</span>
      </NavLink>

      <NavLink 
        to="/create" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <PlusSquare size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Create</span>
      </NavLink>

      <NavLink 
        to="/chats" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <MessageSquare size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Chats</span>
      </NavLink>

      <NavLink 
        to="/settings" 
        className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-indigo-500' : 'text-zinc-400'}`}
      >
        <Settings size={20} />
        <span className="text-[10px] uppercase font-bold tracking-wider">Settings</span>
      </NavLink>
    </nav>
  );
};
