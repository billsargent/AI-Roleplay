
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Play, Plus, BookOpen, Trash2 } from 'lucide-react';
import { storage } from '../services/storage';
import { apiService } from '../services/api';
import { Scenario } from '../types';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: 'default-1',
    name: 'Cyberpunk Neon Nights',
    description: 'A gritty underworld mission in the rain-slicked streets of Neo-Tokyo. Corporate intrigue and neon-lit danger await.',
    image: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&auto=format&fit=crop',
    tags: ['Cyberpunk', 'Sci-Fi', 'Action'],
    backstory: 'The year is 2084. Megacorporations rule the world from their golden towers while the rest of humanity struggles in the neon shadows. You are a mercenary for hire, specialized in high-stakes data theft.',
    greetingMessage: '*The rain drums a rhythmic beat against the window of your cramped apartment. A neon sign outside flickers, casting a harsh blue light across your desk. Your terminal pings—a new encrypted message from an anonymous sender.* "I have a job for you. High risk, higher reward. Interested?"',
    lorePieces: [],
    characters: [
      { id: 'c1', name: 'Kaelen', description: 'A cynical street doc', personality: 'Grumpy but loyal' }
    ],
    settings: {
      separateUserCharacter: true,
      sensitiveContent: false,
      isPublic: true,
      allowCustomization: true,
      hidePrompts: false,
      allowCommenting: true,
    },
    createdAt: Date.now(),
  },
  {
    id: 'default-2',
    name: 'The Forgotten Kingdom',
    description: 'Awaken in the ruins of a once-great civilization. Magic is fading, and ancient shadows are stirring in the deep.',
    image: 'https://images.unsplash.com/photo-1519074063912-ad2d6d51ee17?w=800&auto=format&fit=crop',
    tags: ['Fantasy', 'Adventure', 'Magic'],
    backstory: 'A thousand years ago, the Kingdom of Eldoria was the jewel of the world. Now, it is a land of ruins and whispers. You are a traveler who has stumbled upon the gates of the capital, guided by a strange, humming pendant.',
    greetingMessage: '*The heavy stone gates groan as they swing open, revealing a city reclaimed by nature. Vines wrap around marble pillars, and the air is thick with the scent of old magic. A figure shrouded in grey rags steps out from the shadows.* "Few come this way anymore. Do you seek the crown, or the curse?"',
    lorePieces: [],
    characters: [
      { id: 'c2', name: 'The Oracle', description: 'A blind seer who speaks in riddles', personality: 'Mysterious and wise' }
    ],
    settings: {
      separateUserCharacter: true,
      sensitiveContent: false,
      isPublic: true,
      allowCustomization: true,
      hidePrompts: false,
      allowCommenting: true,
    },
    createdAt: Date.now(),
  }
];

export const Home: React.FC = () => {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'mine'>('all');
  const navigate = useNavigate();
  const user = apiService.getCurrentUser();

  const loadScenarios = async () => {
    try {
      const fetched = await apiService.getScenarios();
      if (fetched.length === 0) {
        const local = storage.getScenarios();
        setScenarios(local.length === 0 ? DEFAULT_SCENARIOS : local);
      } else {
        setScenarios(fetched);
      }
    } catch (e) {
      setScenarios(storage.getScenarios());
    }
  };

  useEffect(() => {
    loadScenarios();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this scenario?')) {
      try {
        await apiService.deleteScenario(id);
        setScenarios(prev => prev.filter(s => s.id !== id));
      } catch (err) {
        alert('Failed to delete scenario');
      }
    }
  };

  const filteredScenarios = scenarios.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    
    if (activeTab === 'mine') {
      return matchesSearch && s.userId === user?.id;
    }
    return matchesSearch;
  });

  const startScenario = (scenario: Scenario) => {
    const newChatId = uuidv4();
    const newChat = {
      id: newChatId,
      scenarioId: scenario.id,
      title: scenario.name,
      messages: scenario.greetingMessage ? [
        {
          id: uuidv4(),
          role: 'assistant' as const,
          content: scenario.greetingMessage,
          timestamp: Date.now(),
        }
      ] : [],
      memories: [],
      settings: {
        model: 'deepseek-chat',
        responseLength: 'medium' as const,
        streamResponse: true,
        showSuggestions: true,
        fontSize: 100,
        typingSpeed: 100,
      },
      createdAt: Date.now(),
    };
    storage.saveChat(newChat);
    navigate(`/chat/${newChatId}`);
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">FictionLab</h1>
          <p className="text-zinc-400">Discover your next adventure</p>
        </div>
        <button 
          onClick={() => navigate('/create')}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-900/20 active:scale-95"
        >
          <Plus size={20} />
          <span>Create</span>
        </button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="flex bg-zinc-900 p-1 rounded-xl border border-zinc-800">
          <button 
            onClick={() => setActiveTab('all')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'all' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Explore
          </button>
          <button 
            onClick={() => setActiveTab('mine')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'mine' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            My Scenarios
          </button>
        </div>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredScenarios.map(scenario => (
          <div 
            key={scenario.id}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden group hover:border-zinc-700 transition-all cursor-pointer"
            onClick={() => navigate(`/scenario/${scenario.id}`)}
          >
            <div className="aspect-video relative overflow-hidden">
              <img 
                src={scenario.image || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop'} 
                alt={scenario.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  startScenario(scenario);
                }}
                className="absolute bottom-4 right-4 bg-indigo-600 p-3 rounded-full text-white shadow-xl hover:bg-indigo-500 transition-colors z-10"
              >
                <Play fill="currentColor" size={20} />
              </button>

              {(scenario.userId === user?.id || user?.role === 'admin') && (
                <button 
                  onClick={(e) => handleDelete(e, scenario.id)}
                  className="absolute top-4 right-4 bg-red-900/80 p-2 rounded-lg text-white shadow-xl hover:bg-red-800 transition-colors z-10 opacity-0 group-hover:opacity-100"
                  title="Delete Scenario"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
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
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
