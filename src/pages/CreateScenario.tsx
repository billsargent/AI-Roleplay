/**
 * Scenario Editor Page
 * 
 * A full-featured editor for creating and modifying roleplay scenarios.
 * Supports importing from JSON files (Risuprompt format compatible),
 * image upload via base64 encoding, character/lore management with
 * smart-activation triggers, and privacy/visibility settings.
 * 
 * @module CreateScenario
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, Image as ImageIcon, Info, BookOpen, Brain, 
  Settings as SettingsIcon, Save, Plus, Trash2, 
  UserPlus, MessageSquare, ChevronLeft, Globe, Lock, Upload,
  FileJson, Sparkles
} from 'lucide-react';
import { apiService } from '../services/api';
import { AiGeneratedScenarioData } from '../services/deepseek';

import { Scenario, LorePiece, StoryCharacter } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { fileToBase64 } from '../utils/image';
import { useLocation } from 'react-router-dom';
import { useNotifications } from '../utils/notifications';
import { AIGeneratorModal } from '../components/AIGeneratorModal';


export const CreateScenario: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const initialScenario = location.state?.scenario;
  const user = apiService.getCurrentUser();

  /**
   * Initialize scenario state:
   * - If editing an existing scenario (passed via navigation state), load it.
   * - If copying another user's scenario, create a new copy with new IDs.
   * - Otherwise, create a fresh blank scenario.
   */
  const [scenario, setScenario] = useState<Scenario>(() => {
    if (initialScenario) {
      // Copying another user's scenario (or our own)
      if (initialScenario.userId !== user?.id) {
        return {
          ...initialScenario,
          id: uuidv4(),
          name: `${initialScenario.name} (Copy)`,
          userId: user?.id,
          creatorName: user?.username,
          createdAt: Date.now(),
          settings: { ...initialScenario.settings, isPublic: false },
          characters: initialScenario.characters?.map((c: StoryCharacter) => ({ ...c, id: uuidv4() })) || [],
          lorePieces: initialScenario.lorePieces?.map((p: LorePiece) => ({ ...p, id: uuidv4() })) || [],
        };
      }
      return initialScenario;
    }

    // Fresh blank scenario with reasonable defaults
    return {
      id: uuidv4(),
      name: '',
      description: '',
      tags: [],
      backstory: '',
      greetingMessage: '',
      customInstructions: '',
      lorePieces: [],
      characters: [],
      settings: {
        separateUserCharacter: true,
        sensitiveContent: false,
        isPublic: true,
        allowCustomization: true,
        hidePrompts: false,
        allowCommenting: true,
      },
      createdAt: Date.now(),
    };
  });

  const [newTag, setNewTag] = useState('');
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  /**
   * Handles clicking the AI Generate button.
   * If the scenario already has content, shows a confirmation dialog
   * warning the user that existing data will be replaced.
   * If blank, opens the generator modal immediately.
   */
  const handleAiGenerateClick = async () => {
    const hasContent = scenario.name || scenario.description || scenario.backstory ||
      scenario.characters.length > 0 || scenario.lorePieces.length > 0;
    
    if (hasContent) {
      const confirmed = await showConfirm(
        'This will replace all current scenario content, including characters and lore cards, with AI-generated data. Your existing work will be lost. Continue?'
      );
      if (!confirmed) return;
    }
    setShowAiGenerator(true);
  };

  /**
   * Imports a scenario from a JSON file.
   * Compatible with Risuprompt export format — maps displayName, genres,
   * backStory, customGreeting, lorePieces, characters, etc. into the app's
   * Scenario type structure.
   */
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const imported: Scenario = {
          id: uuidv4(),
          userId: user?.id,
          creatorName: user?.username,
          name: data.displayName || data.name || 'Imported Scenario',
          description: data.description || '',
          tags: data.genres || data.tags || [],
          backstory: data.backStory || '',
          greetingMessage: data.customGreeting || '',
          customInstructions: data.customInstructions || '',
          lorePieces: (data.lorePieces || []).map((lp: any) => ({
            id: uuidv4(),

            type: lp.type === 'premise' ? 'other' : (lp.type || 'other'),
            title: lp.title || '',
            description: lp.description || '',
            content: lp.content || '',
            weight: lp.weight || 100,
            pinned: !!lp.pinned,
            smartActivation: lp.smartActivation !== undefined ? !!lp.smartActivation : true,
            triggers: lp.triggers || [],
            linkedPieces: lp.linkedPieces || [],
          })),
          characters: [],
          settings: {
            separateUserCharacter: data.separateUser !== undefined ? !!data.separateUser : true,
            sensitiveContent: !!data.sensitiveContent,
            isPublic: data.isPublic !== undefined ? !!data.isPublic : true,
            allowCustomization: data.allowEditing !== undefined ? !!data.allowEditing : true,
            hidePrompts: !!data.hidePrompts,
            allowCommenting: data.allowComments !== undefined ? !!data.allowComments : true,
          },
          createdAt: Date.now(),
        };
        // Import characters if present in the JSON
        if (data.characters && Array.isArray(data.characters) && data.characters.length > 0) {
          imported.characters = data.characters.map((c: any) => ({
            id: uuidv4(),

            name: c.displayName || c.name || 'Unknown',
            description: c.description || '',
            personality: c.personality || c.traits?.join(', ') || '',
            avatar: c.avatarURL || '',
          }));
        }
        // Also create character entries from lore pieces of type 'character'
        const charLorePieces = (data.lorePieces || []).filter((lp: any) => lp.type === 'character');
        for (const lp of charLorePieces) {
          if (!imported.characters.find(c => c.name === lp.title)) {
            imported.characters.push({
              id: uuidv4(),

              name: lp.title || 'Unknown',
              description: lp.content || '',
              personality: (lp.traits || []).join(', '),
              avatar: lp.avatarURL || '',
            });
          }
        }
        setScenario(imported);
      } catch (err) {
        showToast('Failed to import scenario: Invalid JSON file', 'error');
        console.error('Import error:', err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /** Updates a subset of scenario fields. */
  const updateScenario = (updates: Partial<Scenario>) => {
    setScenario(prev => ({ ...prev, ...updates }));
  };

  /** Updates scenario settings (privacy/customization toggles). */
  const updateSettings = (updates: any) => {
    updateScenario({ settings: { ...scenario.settings, ...updates } });
  };

  /**
   * Validates and saves the scenario to the server.
   * - Strips blank lore cards (no title/content)
   * - Downgrades smart-activated lore with no triggers to draft
   * - Enforces required fields (name, description, backstory)
   * - Requires cover image for public scenarios
   */
  const handleSave = async () => {
    // Remove blank lore cards (no meaningful content)
    const nonBlankLore = scenario.lorePieces.filter(
      p => p.content.trim() || (p.title.trim() && p.title !== 'New Lore Piece')
    );
    if (nonBlankLore.length < scenario.lorePieces.length) {
      showToast(`${scenario.lorePieces.length - nonBlankLore.length} blank lore card(s) will be removed before saving.`, 'info');
    }
    // Downgrade smart-activated lore with no triggers to draft
    const cleanedLore = nonBlankLore.map(p =>
      p.smartActivation && (!p.triggers || p.triggers.length === 0)
        ? { ...p, smartActivation: false, pinned: false }
        : p
    );

    // Validate required fields
    if (!scenario.name || !scenario.description || !scenario.backstory) {
      showToast('Name, Description, and Backstory are required.', 'error');
      return;
    }
    // Enforce image requirement for public scenarios
    if (scenario.settings.isPublic && !scenario.image) {
      showToast('A cover image is required before this scenario can be published publicly. Please upload an image, or save as Private.', 'error');
      return;
    }

    try {
      await apiService.saveScenario({ ...scenario, lorePieces: cleanedLore });
      navigate('/');
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Failed to save scenario', 'error');
    }
  };

  /** Adds a new NPC character with default values. */
  const addCharacter = () => {
    const char: StoryCharacter = {
      id: uuidv4(),
      name: 'New Character',
      description: 'Role/Brief bio',
      personality: 'Key traits',
    };
    updateScenario({ characters: [...scenario.characters, char] });
  };

  /** Adds a new lore piece with default values. */
  const addLorePiece = () => {
    const piece: LorePiece = {
      id: uuidv4(),
      type: 'location',
      title: 'New Lore Piece',
      description: '',
      content: '',
      weight: 100,
      pinned: false,
      smartActivation: true,
      triggers: [],
      linkedPieces: [],
    };
    updateScenario({ lorePieces: [...scenario.lorePieces, piece] });
  };

  /** Handles image upload via FileReader → base64. */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        updateScenario({ image: base64 });
      } catch (err) {
        console.error("Image upload failed", err);
      }
    }
  };

  /**
   * Callback for the AI Generator modal.
   * Maps the AI-generated data into the Scenario format with new IDs,
   * sets it as the current scenario draft, and notifies the user.
   */
  const handleAiGenerated = (data: AiGeneratedScenarioData) => {
    const newScenario: Scenario = {
      id: uuidv4(),
      userId: user?.id,
      creatorName: user?.username,
      name: data.name,
      description: data.description,
      tags: data.tags,
      backstory: data.backstory,
      greetingMessage: data.greetingMessage,
      customInstructions: data.customInstructions,
      // Remove any character named {{user}} (reserved placeholder)
      characters: data.characters
        .filter(c => c.name.toLowerCase() !== '{{user}}')
        .map(c => ({
        id: uuidv4(),
        name: c.name,
        description: c.description,
        personality: c.personality,
        // No avatar — user will add images later
      })),
      lorePieces: data.lorePieces.map(lp => ({
        id: uuidv4(),
        type: (['location', 'event', 'object', 'other'].includes(lp.type) ? lp.type : 'other') as LorePiece['type'],
        title: lp.title,
        description: '',
        content: lp.content,
        weight: 100,
        pinned: false,
        smartActivation: true,
        triggers: Array.isArray(lp.triggers) ? lp.triggers : [],
        linkedPieces: [],
      })),

      settings: { ...scenario.settings },
      createdAt: Date.now(),
    };
    setScenario(newScenario);
    setShowAiGenerator(false);
    showToast('✨ AI-generated scenario loaded as a draft. Add images and tweak as needed!', 'success');
  };

  // ── Render ──
  return (

    <div className="pb-32 pt-6 px-4 max-w-5xl mx-auto space-y-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 bg-zinc-900 rounded-full text-zinc-400 hover:text-white border border-zinc-800">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-black text-white">Scenario Editor</h1>
            <p className="text-zinc-500 text-sm">Design your world and its inhabitants</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleAiGenerateClick}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-4 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-xl shadow-purple-900/20 transition-all active:scale-95"
          >
            <Sparkles size={18} /> AI Generate
          </button>
          <input type="file" accept=".json" ref={importInputRef} className="hidden" onChange={handleImport} />
          <button 
            onClick={() => importInputRef.current?.click()}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all"
          >
            <FileJson size={18} /> Import
          </button>
          <button 
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-xl shadow-indigo-900/20 transition-all active:scale-95"
          >
            <Save size={20} /> Save Changes
          </button>
        </div>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        {/* ── Left Column: Form Fields ── */}
        <div className="space-y-10">
          
          {/* Essential Details: Name, Tags, Image */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-3"><Info className="text-blue-500" /> Essential Details</h2>
            <div className="grid grid-cols-1 gap-6">
              <div className="flex flex-col md:flex-row gap-6">
                {/* Cover image upload area */}
                <div className="w-full md:w-48 aspect-square bg-zinc-950 border border-zinc-800 rounded-2xl flex flex-col items-center justify-center relative group overflow-hidden cursor-pointer">
                  {scenario.image ? <img src={scenario.image} className="w-full h-full object-cover" /> : <ImageIcon size={40} className="text-zinc-800" />}
                  <label className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center p-4 transition-opacity cursor-pointer text-center">
                    <Upload size={24} className="text-white mb-2" />
                    <span className="text-xs font-bold text-white uppercase">Upload Image</span>
                    <span className="text-[10px] text-zinc-500 mt-1">Best fit: 1920×1080px (16:9 ratio)</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                </div>
                <div className="flex-1 space-y-4">
                  {/* Scenario name input */}
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Scenario Name</label>
                    <input className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="Give your story a title..." value={scenario.name} onChange={e => updateScenario({ name: e.target.value })} />
                  </div>
                  {/* Tags input */}
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Tags</label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {scenario.tags.map(tag => (
                        <span key={tag} className="bg-indigo-600/10 text-indigo-400 border border-indigo-600/20 px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-2">
                          {tag}
                          <button onClick={() => updateScenario({ tags: scenario.tags.filter(t => t !== tag) })}><X size={12}/></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white" placeholder="Add tag (Press Enter)" value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newTag.trim()) { updateScenario({ tags: [...scenario.tags, newTag.trim()] }); setNewTag(''); } }} />
                    </div>
                  </div>
                </div>
              </div>
              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Brief Summary</label>
                <textarea className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 h-24 resize-none" placeholder={scenario.description ? "" : "A short hook to grab players' attention..."} value={scenario.description} onChange={e => updateScenario({ description: e.target.value })} />
              </div>
            </div>
          </section>

          {/* Story Foundation: Backstory, Greeting, Custom Instructions */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-3"><BookOpen className="text-green-500" /> Story Foundation</h2>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Main Backstory & World Details</label>
                <textarea className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-4 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 h-64 resize-y font-serif text-lg leading-relaxed" placeholder={scenario.backstory ? "" : "Describe the environment, the history, and the current situation. Use {{user}} to refer to the player's character."} value={scenario.backstory} onChange={e => updateScenario({ backstory: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Greeting Message</label>
                  <textarea className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 h-40 resize-none" placeholder={scenario.greetingMessage ? "" : "The first message sent to the player. Set the tone here."} value={scenario.greetingMessage} onChange={e => updateScenario({ greetingMessage: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Custom AI Instructions</label>
                  <textarea className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 h-40 resize-none" placeholder={scenario.customInstructions ? "" : "Special rules for the AI (e.g., 'Joe always speaks in rhymes')"} value={scenario.customInstructions} onChange={e => updateScenario({ customInstructions: e.target.value })} />
                </div>
              </div>
            </div>
          </section>

          {/* Cast of Characters */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-3"><UserPlus className="text-purple-500" /> Cast of Characters</h2>
              <button onClick={addCharacter} className="bg-indigo-600/10 text-indigo-400 border border-indigo-600/20 px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-600/20 transition-colors">
                <Plus size={16} /> Add NPC
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {scenario.characters.map(char => (
                <div key={char.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      {/* Character avatar */}
                      <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center relative overflow-hidden group/npc">
                        {char.avatar ? <img src={char.avatar} className="w-full h-full object-cover" /> : <UserPlus size={20} className="text-zinc-700" />}
                        <label className="absolute inset-0 bg-black/60 opacity-0 group-hover/npc:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                          <Upload size={14} className="text-white" />
                          <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const base64 = await fileToBase64(file); updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, avatar: base64 } : c) }); } }} />
                        </label>
                      </div>
                      <input className="bg-transparent text-xl font-bold text-white outline-none focus:border-b border-indigo-500 flex-1" value={char.name} onChange={e => { 
                        const newName = e.target.value;
                        if (newName.toLowerCase() === '{{user}}') {
                          showToast('"{{user}}" is a reserved placeholder and cannot be used as a character name.', 'error');
                          return;
                        }
                        updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, name: newName } : c) }); 
                      }} />
                    </div>
                    <button onClick={() => updateScenario({ characters: scenario.characters.filter(c => c.id !== char.id) })} className="text-zinc-700 hover:text-red-500 p-2"><Trash2 size={18} /></button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-zinc-600 uppercase mb-1 block">Role & Appearance</label>
                      <textarea className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 resize-none h-24" value={char.description} onChange={e => { updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, description: e.target.value } : c) }); }} />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-zinc-600 uppercase mb-1 block">Personality & Mannerisms</label>
                      <textarea className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 resize-none h-24" value={char.personality} onChange={e => { updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, personality: e.target.value } : c) }); }} />
                    </div>
                  </div>
                </div>
              ))}
              {scenario.characters.length === 0 && (
                <div className="text-center py-10 border border-dashed border-zinc-800 rounded-2xl">
                  <p className="text-zinc-600 text-sm">Every good story needs characters. Add some NPCs!</p>
                </div>
              )}
            </div>
          </section>

          {/* World Lore */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-3"><Brain className="text-indigo-500" /> World Lore</h2>
              <button onClick={addLorePiece} className="bg-indigo-600/10 text-indigo-400 border border-indigo-600/20 px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-600/20 transition-colors">
                <Plus size={16} /> Add Lore
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {scenario.lorePieces.map(piece => (
                <div key={piece.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 flex gap-4">
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center justify-between">
                      <input className="bg-transparent text-lg font-bold text-white outline-none focus:border-b border-indigo-500" value={piece.title} onChange={e => { updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, title: e.target.value } : p) }); }} />
                      <button onClick={() => updateScenario({ lorePieces: scenario.lorePieces.filter(p => p.id !== piece.id) })} className="text-zinc-700 hover:text-red-500"><Trash2 size={16}/></button>
                    </div>
                    <textarea className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-400 h-24" placeholder="Describe this location, object, or event..." value={piece.content} onChange={e => { updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, content: e.target.value } : p) }); }} />
                    {/* Lore type toggles: Draft / Pinned / Smart Activation */}
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase cursor-pointer">
                        <input type="checkbox" checked={!piece.pinned && !piece.smartActivation} onChange={e => { if (e.target.checked) { updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, pinned: false, smartActivation: false } : p) }); } }} /> Draft Lore
                      </label>
                      <label className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase cursor-pointer">
                        <input type="checkbox" checked={piece.pinned} onChange={e => { updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, pinned: e.target.checked } : p) }); }} /> Pinned
                      </label>
                      <label className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase cursor-pointer">
                        <input type="checkbox" checked={piece.smartActivation} onChange={e => { if (e.target.checked && (!piece.triggers || piece.triggers.length === 0)) return; updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, smartActivation: e.target.checked } : p) }); }} /> Smart
                      </label>
                    </div>
                    {/* Trigger words input (only shown for smart-activated lore) */}
                    {piece.smartActivation && (
                      <div>
                        <label className="text-[10px] font-black text-zinc-600 uppercase mb-1 block">Trigger Words (comma-separated)</label>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {(piece.triggers || []).map(t => (
                            <span key={t} className="bg-amber-600/10 text-amber-400 border border-amber-600/20 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                              {t}
                              <button onClick={() => updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, triggers: (p.triggers || []).filter(x => x !== t) } : p) })}><X size={10}/></button>
                            </span>
                          ))}
                        </div>
                        <input
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300"
                          placeholder="e.g. forest, dark, shadows"
                          value=""
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const input = e.currentTarget;
                              const words = input.value.split(',').map(s => s.trim()).filter(Boolean);
                              if (words.length > 0) {
                                updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, triggers: [...new Set([...(p.triggers || []), ...words])] } : p) });
                              }
                              input.value = '';
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── Right Column: Settings Sidebar ── */}
        <div className="space-y-6 lg:sticky lg:top-24">
          
          {/* Logic & Privacy toggles */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
            <h2 className="text-lg font-bold flex items-center gap-2 text-white"><SettingsIcon size={18} className="text-zinc-500" /> Logic & Privacy</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><h4 className="text-sm font-bold text-zinc-300">Public Scenario</h4><p className="text-[10px] text-zinc-600 uppercase font-black">Visible in Explore</p></div>
                <button onClick={() => updateSettings({ isPublic: !scenario.settings.isPublic })} className={`w-10 h-5 rounded-full relative transition-colors ${scenario.settings.isPublic ? 'bg-indigo-600' : 'bg-zinc-800'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${scenario.settings.isPublic ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div><h4 className="text-sm font-bold text-zinc-300">Allow Customization</h4><p className="text-[10px] text-zinc-600 uppercase font-black">Others can remix</p></div>
                <button onClick={() => updateSettings({ allowCustomization: !scenario.settings.allowCustomization })} className={`w-10 h-5 rounded-full relative transition-colors ${scenario.settings.allowCustomization ? 'bg-indigo-600' : 'bg-zinc-800'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${scenario.settings.allowCustomization ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div><h4 className="text-sm font-bold text-zinc-300">Mature Content</h4><p className="text-[10px] text-zinc-600 uppercase font-black">18+ Only</p></div>
                <button onClick={() => updateSettings({ sensitiveContent: !scenario.settings.sensitiveContent })} className={`w-10 h-5 rounded-full relative transition-colors ${scenario.settings.sensitiveContent ? 'bg-red-600' : 'bg-zinc-800'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${scenario.settings.sensitiveContent ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div><h4 className="text-sm font-bold text-zinc-300">Separate Persona</h4><p className="text-[10px] text-zinc-600 uppercase font-black">User is distinct</p></div>
                <button onClick={() => updateSettings({ separateUserCharacter: !scenario.settings.separateUserCharacter })} className={`w-10 h-5 rounded-full relative transition-colors ${scenario.settings.separateUserCharacter ? 'bg-indigo-600' : 'bg-zinc-800'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${scenario.settings.separateUserCharacter ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </section>

          {/* Visibility summary card */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <div className="flex items-center gap-2 text-zinc-500 mb-4"><Globe size={16} /><span className="text-xs font-bold uppercase tracking-widest">Visibility</span></div>
            <div className="flex items-center gap-3 p-4 bg-zinc-950 rounded-2xl border border-zinc-800">
              {scenario.settings.isPublic ? <Globe className="text-green-500" size={24} /> : <Lock className="text-orange-500" size={24} />}
              <div>
                <p className="text-sm font-bold text-white">{scenario.settings.isPublic ? 'Public Story' : 'Private Draft'}</p>
                <p className="text-[10px] text-zinc-600">{scenario.settings.isPublic ? 'Anyone can play and find this' : 'Only you can see this'}</p>
              </div>
            </div>
            {/* Warning for public scenarios without a cover image */}
            {scenario.settings.isPublic && !scenario.image && (
              <div className="mt-3 p-3 bg-amber-900/20 border border-amber-600/30 rounded-xl">
                <p className="text-xs font-bold text-amber-400">⚠ A cover image is required for public scenarios. Upload one above or switch to Private.</p>
              </div>
            )}
          </section>

          {/* Pro tip */}
          <div className="p-4 rounded-2xl bg-indigo-600/5 border border-indigo-600/10">
            <h4 className="text-xs font-black text-indigo-400 uppercase mb-2 flex items-center gap-2"><MessageSquare size={14}/> Pro Tip</h4>
            <p className="text-xs text-zinc-500 leading-relaxed">Use <strong>{`{{user}}`}</strong> in your backstory to dynamically reference the player's persona name.</p>
          </div>
        </div>
      </div>

      {/* AI Scenario Generator Modal */}
      <AIGeneratorModal
        isOpen={showAiGenerator}
        onClose={() => setShowAiGenerator(false)}
        onScenarioGenerated={handleAiGenerated}
      />
    </div>
  );
};

