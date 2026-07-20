/**
 * ─── Home / Scenario Discovery Page ───
 *
 * The landing page users see after login. Features:
 *
 * - Site branding header (name from localStorage 'fl_siteName')
 * - "Explore" tab (default): shows ALL public scenarios from everyone (including own)
 * - "My Public" tab: shows only the current user's public scenarios
 * - "My Private" tab: shows only the current user's private (hidden) scenarios
 * - Search bar filters by name, description, tags, and creatorName
 * - Each scenario card shows image, tags, name, description, and creator attribution
 * - Click a card → navigate to /scenario/:id (ScenarioDetail)
 * - Play button overlay → direct navigation to scenario detail
 * - Delete button (visible to owner or admin): confirmation dialog then delete
 * - Logout button in the header bar
 * - "Create" button to open the scenario editor
 * - Pagination with page navigation controls (20 per page)
 *
 * Security: private/non-public scenarios are never shown in Explore — they are
 * only ever visible in the "My Private" tab to the scenario owner (and admins).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Play, Plus, BookOpen, Trash2, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';

import { apiService } from '../services/api';
import { Scenario } from '../types';
import { useNotifications } from '../utils/notifications';

/** Reads the cached site name from localStorage (set by admin via AdminPage) */
const getCachedSiteName = (): string => localStorage.getItem('fl_siteName') || 'AI Roleplay';

/** Number of scenarios per page */
const PAGE_SIZE = 20;

export const Home: React.FC<{ siteName?: string }> = ({ siteName = getCachedSiteName() }) => {
  const { showToast, showConfirm } = useNotifications();

  const [allScenarios, setAllScenarios] = useState<Scenario[]>([]);
  const [page, setPage] = useState(1);
  const [totalScenarios, setTotalScenarios] = useState(0);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'explore' | 'mine-public' | 'mine-private'>('explore');
  const navigate = useNavigate();
  const user = apiService.getCurrentUser();

  const totalPages = Math.ceil(totalScenarios / PAGE_SIZE);

  /** Fetch scenarios from the API */
  const loadScenarios = useCallback(async (pageNum: number = 1) => {
    try {
      const data = await apiService.getScenarios(pageNum, PAGE_SIZE);
      if (data && Array.isArray(data.scenarios)) {
        setAllScenarios(data.scenarios);
        setTotalScenarios(data.pagination?.total || 0);
      } else if (Array.isArray(data)) {
        // Fallback: if server doesn't support pagination yet, handle plain array
        setAllScenarios(data);
        setTotalScenarios(data.length);
      }
    } catch (e) {
      console.error('Failed to load scenarios', e);
    }
  }, []);

  useEffect(() => {
    loadScenarios(page);
  }, [page, loadScenarios]);

  /** Delete a scenario after confirmation. Requires ownership or admin role. */
  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (await showConfirm('Are you sure you want to delete this scenario?')) {
      try {
        await apiService.deleteScenario(id);
        setAllScenarios(prev => prev.filter(s => s.id !== id));
        setTotalScenarios(prev => prev - 1);
      } catch (err) {
        showToast('Failed to delete scenario', 'error');
      }
    }
  };

  /** Filter scenarios by search text + active tab.
   *  - 'explore' tab: show all public scenarios from everyone (including own)
   *  - 'mine-public' tab: show only the current user's public scenarios
   *  - 'mine-private' tab: show only the current user's private (non-public) scenarios */
  const filteredScenarios = allScenarios.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.creatorName?.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    
    if (activeTab === 'explore') {
      // Show all public scenarios (everyone's, including the current user's)
      return matchesSearch && s.settings?.isPublic === true;
    }
    if (activeTab === 'mine-public') {
      return matchesSearch && s.userId === user?.id && s.settings?.isPublic === true;
    }
    // mine-private: only the user's non-public scenarios
    return matchesSearch && s.userId === user?.id && s.settings?.isPublic !== true;
  });

  /** Navigate to the scenario detail page */
  const startScenario = (scenario: Scenario) => {
    navigate(`/scenario/${scenario.id}`);
  };

  /** Go to previous page */
  const prevPage = () => {
    if (page > 1) setPage(page - 1);
  };

  /** Go to next page */
  const nextPage = () => {
    if (page < totalPages) setPage(page + 1);
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-6xl mx-auto">
      {/* ─── Header: Site Name + Logout + Create ─── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{siteName}</h1>
          <p className="text-zinc-400">Discover your next adventure</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              apiService.logout();
              window.location.href = '/';
            }}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all active:scale-95"
            title="Logout"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
          <button 
            onClick={() => navigate('/create')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-900/20 active:scale-95"
          >
            <Plus size={20} />
            <span>Create</span>
          </button>
        </div>
      </div>

      {/* ─── Tab Bar: Explore / My Public Scenarios / My Private Scenarios ─── */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex bg-zinc-900 p-1 rounded-xl border border-zinc-800">
          <button 
            onClick={() => { setActiveTab('explore'); setPage(1); }}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'explore' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Explore
          </button>
          <button 
            onClick={() => { setActiveTab('mine-public'); setPage(1); }}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'mine-public' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            My Public
          </button>
          <button 
            onClick={() => { setActiveTab('mine-private'); setPage(1); }}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'mine-private' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            My Private
          </button>
        </div>
      </div>

      {/* ─── Search Input ─── */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
        <input 
          type="text"
          placeholder="Search scenarios, genres, tags..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {/* --- Pagination Controls (top) --- */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            onClick={prevPage}
            disabled={page <= 1}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all active:scale-95"
          >
            <ChevronLeft size={18} />
            <span>Previous</span>
          </button>
          <span className="text-zinc-400 text-sm">
            Page {page} of {totalPages}
            <span className="text-zinc-600 ml-2">({totalScenarios} total)</span>
          </span>
          <button
            onClick={nextPage}
            disabled={page >= totalPages}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all active:scale-95"
          >
            <span>Next</span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}


      {/* ─── Scenario Grid ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredScenarios.map(scenario => (
          <div 
            key={scenario.id}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden group hover:border-zinc-700 transition-all cursor-pointer"
            onClick={() => navigate(`/scenario/${scenario.id}`)}
          >
            {/* Image + Play/Delete overlays */}
            <div className="aspect-video relative overflow-hidden">
              <img 
                src={scenario.image || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect fill='%23d1d5db' width='800' height='450'/%3E%3C/svg%3E"}
                alt={scenario.name}
                loading="lazy"
                className="w-full h-full object-contain bg-zinc-950 group-hover:scale-105 transition-transform duration-500"
              />
              {/* Gradient overlay for readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
              {/* Play button */}
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  startScenario(scenario);
                }}
                className="absolute bottom-4 right-4 bg-indigo-600 p-3 rounded-full text-white shadow-xl hover:bg-indigo-500 transition-colors z-10"
              >
                <Play fill="currentColor" size={20} />
              </button>

              {/* Delete button — visible on hover for owner/admin */}
              {user && (scenario.userId === user.id || user.role === 'admin') && (
                <button 
                  onClick={(e) => handleDelete(e, scenario.id)}
                  className="absolute top-4 right-4 bg-red-900/80 p-2 rounded-lg text-white shadow-xl hover:bg-red-800 transition-colors z-10 opacity-0 group-hover:opacity-100"
                  title="Delete Scenario"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            {/* Card info */}
            <div className="p-4">
              <div className="flex flex-wrap gap-2 mb-2">
                {scenario.tags.map(tag => (
                  <span key={tag} className="text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                    {tag}
                  </span>
                ))}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{scenario.name}</h3>
              <p className="text-zinc-400 text-sm line-clamp-2 mb-4">
                {scenario.description}
              </p>
              <div className="flex items-center gap-2 text-zinc-500 text-xs">
                <BookOpen size={14} />
                <span>Story Detail</span>
                {scenario.creatorName && (
                  <>
                    <span className="text-zinc-700">|</span>
                    <span>by {scenario.creatorName}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Pagination Controls (bottom) ─── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={prevPage}
            disabled={page <= 1}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all active:scale-95"
          >
            <ChevronLeft size={18} />
            <span>Previous</span>
          </button>
          <span className="text-zinc-400 text-sm">
            Page {page} of {totalPages}
            <span className="text-zinc-600 ml-2">({totalScenarios} total)</span>
          </span>
          <button
            onClick={nextPage}
            disabled={page >= totalPages}
            className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all active:scale-95"
          >
            <span>Next</span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
};
