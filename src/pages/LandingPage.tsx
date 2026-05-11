/**
 * ─── Landing / Welcome Page ───
 *
 * The public-facing landing page shown at `/`.
 * - Unauthenticated visitors see a welcome message + Sign In button
 * - Authenticated users see Explore / Create buttons
 * - A Help & Tips section explains how to use the platform
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, BookOpen, PlusSquare, MessageSquare, Wand2, Lightbulb, LogIn } from 'lucide-react';
import { apiService } from '../services/api';

/** Reads the cached site name from localStorage (set by admin via AdminPage) */
const getCachedSiteName = (): string => localStorage.getItem('fl_siteName') || 'AI Roleplay';

export const LandingPage: React.FC<{ siteName?: string }> = ({ siteName = getCachedSiteName() }) => {
  const navigate = useNavigate();
  const user = apiService.getCurrentUser();

  return (
    <div className="pb-32 pt-8 px-4 max-w-4xl mx-auto space-y-16">
      {/* ─── Hero Section ─── */}
      <div className="text-center space-y-8">
        <div className="inline-flex p-4 bg-indigo-600/10 rounded-3xl mb-2">
          <Sparkles className="text-indigo-500" size={48} />
        </div>
        <div>
          <h1 className="text-5xl font-black text-white tracking-tight mb-4">{siteName}</h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            An immersive AI-powered roleplaying platform where you create worlds, 
            craft characters, and embark on infinite adventures. Powered by advanced 
            AI that adapts to every choice you make.
          </p>
        </div>

        {/* Action Buttons */}
        {user ? (
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={() => navigate('/scenarios')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-2xl font-bold text-lg flex items-center gap-3 shadow-xl shadow-indigo-900/20 transition-all active:scale-95"
            >
              <BookOpen size={24} />
              <span>Explore Scenarios</span>
            </button>
            <button
              onClick={() => navigate('/create')}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-8 py-4 rounded-2xl font-bold text-lg flex items-center gap-3 border border-zinc-700 transition-all active:scale-95"
            >
              <PlusSquare size={24} />
              <span>Create New</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={() => navigate('/auth')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-2xl font-bold text-lg flex items-center gap-3 shadow-xl shadow-indigo-900/20 transition-all active:scale-95"
            >
              <LogIn size={24} />
              <span>Sign In to Start</span>
            </button>
          </div>
        )}
      </div>

      {/* ─── Features Overview ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-4">
          <div className="inline-flex p-3 bg-indigo-600/10 rounded-2xl">
            <Wand2 className="text-indigo-500" size={28} />
          </div>
          <h3 className="text-lg font-bold text-white">Create Worlds</h3>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Design rich scenarios with backstories, characters, lore, and custom 
            instructions. Your imagination is the only limit.
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-4">
          <div className="inline-flex p-3 bg-purple-600/10 rounded-2xl">
            <MessageSquare className="text-purple-500" size={28} />
          </div>
          <h3 className="text-lg font-bold text-white">AI-Powered Chat</h3>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Immersive conversations with intelligent NPCs that remember your 
            choices and adapt the story in real-time.
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-4">
          <div className="inline-flex p-3 bg-amber-600/10 rounded-2xl">
            <Lightbulb className="text-amber-500" size={28} />
          </div>
          <h3 className="text-lg font-bold text-white">Smart Lore</h3>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Context-aware lore cards that activate exactly when needed. 
            Pin important details or let the AI trigger them dynamically.
          </p>
        </div>
      </div>

      {/* ─── Help & Tips Section ─── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 md:p-12 space-y-10">
        <div className="text-center">
          <h2 className="text-3xl font-black text-white">Help & Tips</h2>
          <p className="text-zinc-500 mt-2">Everything you need to know to get the most out of {siteName}</p>
        </div>

        {/* How to Create Scenarios */}
        <section className="space-y-4">
          <h3 className="text-xl font-bold text-indigo-400 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center text-sm">1</span>
            Creating Scenarios
          </h3>
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-3 text-zinc-400 text-sm leading-relaxed">
            <p><strong className="text-zinc-200">Start with a concept:</strong> Give your scenario a catchy name, a brief summary, and relevant tags so others can find it.</p>
            <p><strong className="text-zinc-200">Write a backstory:</strong> This is your world's foundation. Describe the environment, history, and current situation. Use <code className="text-indigo-400 bg-indigo-900/20 px-1.5 py-0.5 rounded text-xs">{'{{user}}'}</code> to reference the player's persona name dynamically.</p>
            <p><strong className="text-zinc-200">Add a greeting message:</strong> This is the first thing players see when they start. Set the tone — make it immersive and engaging.</p>
            <p><strong className="text-zinc-200">Design characters:</strong> Create NPCs with names, appearances, personalities, and mannerisms. Each character the AI plays will use these traits.</p>
            <p><strong className="text-zinc-200">Build world lore:</strong> Add lore cards for locations, events, objects, and more. Use <strong>Pinned</strong> lore for always-important details, <strong>Smart</strong> lore for context-triggered information, or leave them as <strong>Draft</strong> for future development.</p>
            <p><strong className="text-zinc-200">Upload a cover image:</strong> Public scenarios require a cover image — use a 16:9 ratio (1920×1080px recommended).</p>
            <p><strong className="text-zinc-200">Set privacy:</strong> Toggle "Public Scenario" to share your creation with the community, or keep it private for personal use.</p>
          </div>
        </section>

        {/* Custom Instructions Guide */}
        <section className="space-y-4">
          <h3 className="text-xl font-bold text-purple-400 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center text-sm">2</span>
            Using Custom Instructions
          </h3>
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-3 text-zinc-400 text-sm leading-relaxed">
            <p>Custom instructions let you fine-tune how the AI behaves. You can add them at two levels:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                <h4 className="font-bold text-zinc-200 mb-2">Scenario-Level</h4>
                <p className="text-xs">Set in the scenario editor under "Custom AI Instructions." These apply to every chat in that scenario. Use them for world-specific rules like <em>"All elves speak in rhymes"</em> or <em>"The AI must never reveal the mystery before Chapter 3."</em></p>
              </div>
              <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                <h4 className="font-bold text-zinc-200 mb-2">Chat-Level</h4>
                <p className="text-xs">Set per-chat in the chat settings sidebar. These override scenario instructions for that specific session. Useful for changing the AI's behavior mid-story.</p>
              </div>
            </div>
            <p className="mt-2"><strong className="text-zinc-200">Pro tip:</strong> Be specific and use examples. Instead of <em>"be descriptive,"</em> try <em>"Describe each scene with sensory details — sounds, smells, and textures — before the NPC speaks."</em></p>
          </div>
        </section>

        {/* Tips & Tricks */}
        <section className="space-y-4">
          <h3 className="text-xl font-bold text-amber-400 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center text-sm">3</span>
            Tips & Tricks
          </h3>
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-3 text-zinc-400 text-sm leading-relaxed">
            <p><strong className="text-zinc-200">Use personas:</strong> Create multiple personas in your profile settings. Each persona can have a different name, description, and avatar — perfect for trying different character archetypes.</p>
            <p><strong className="text-zinc-200">Smart activation is your friend:</strong> Don't overwhelm the AI with too much lore at once. Use smart-triggered lore cards that activate only when keywords come up in conversation. This keeps the AI focused and responses relevant.</p>
            <p><strong className="text-zinc-200">Leverage pinned lore:</strong> Pin essential world facts (e.g., "The year is 1888, magic is outlawed") so the AI always has them in context, regardless of what's being discussed.</p>
            <p><strong className="text-zinc-200">Edit messages:</strong> If the AI goes off-track, you can edit any message in a chat. Click the edit icon on a message to tweak the AI's response, or use the version history to roll back.</p>
            <p><strong className="text-zinc-200">Memories matter:</strong> The AI generates memories of important events during your chat. You can pin critical memories so they're never forgotten, and trim old ones to keep the context window efficient.</p>
            <p><strong className="text-zinc-200">Customize your experience:</strong> Visit My Profile settings to change dialogue colors, narration colors, and message bubble styling to match your preference.</p>
            <p><strong className="text-zinc-200">Stream responses:</strong> Enable streaming in chat settings to see the AI's response as it's being generated — it makes conversations feel more alive and interactive.</p>
          </div>
        </section>
      </div>

      {/* ─── Footer ─── */}
      <div className="text-center text-zinc-700 text-xs">
        <p>{siteName} — Powered by DeepSeek AI</p>
      </div>
    </div>
  );
};
