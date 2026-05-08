/**
 * ─── Scenario Detail Page ───
 *
 * Full-screen view of a single scenario with:
 * - Header image, name, tags, creation date, public/private badge
 * - Story description (quoted)
 * - The Backstory
 * - Key Characters & Lore cards
 * - Sidebar: START CHAT button → persona selection modal → chat creation
 * - Favorite, Edit/Customize, Export (owner/admin only), Delete (owner/admin only) buttons
 * - Scenario metadata (user character model, model support, safety/content warning)
 *
 * When starting a chat:
 *   1. User selects a persona in the modal
 *   2. If the scenario has a greetingMessage, it becomes the first AI message
 *   3. If no greeting, an AI response is auto-generated via deepseek.chat() with "*continue*"
 *   4. The new chat is saved server-side, then the user is navigated to /chat/:id
 *
 * Import/Export uses a custom JSON format (Risuprompt-compatible) triggered manually.
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Play, ChevronLeft, Calendar, User, 
  Book, Info, Settings as SettingsIcon,
  Globe, Lock, ShieldAlert, Heart, X, Check, Trash2, Download
} from 'lucide-react';
import { apiService } from '../services/api';
import { deepseek } from '../services/deepseek';
import { Scenario, Persona, Message } from '../types';

import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { useNotifications } from '../utils/notifications';

export const ScenarioDetail: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const { scenarioId } = useParams<{ scenarioId: string }>();

  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [showPersonaSelect, setShowPersonaSelect] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedLoreIds, setExpandedLoreIds] = useState<Set<string>>(new Set());

  const toggleLoreExpand = (id: string) => {
    setExpandedLoreIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Load scenario data and user's personas on mount */
  useEffect(() => {
    const loadScenario = async () => {
      if (scenarioId) {
        try {
          const s = await apiService.getScenario(scenarioId);
          if (s) {
            setScenario(s);
            const user = apiService.getCurrentUser();
            const owner = s.userId === user?.id;
            const admin = user?.role === 'admin';
            setIsOwner(owner);
            setIsAdmin(admin);
            setCanEdit(owner || s.settings?.allowCustomization || admin);
          } else {
            navigate('/');
          }
        } catch (e) {
          navigate('/');
        } finally {
          setLoading(false);
        }
      }
    };
    loadScenario();
    
    const loadPersonas = async () => {
      const data = await apiService.getPersonas();
      setPersonas(data);
    };
    loadPersonas();
  }, [scenarioId, navigate]);

  /** Create a new chat session for this scenario */
  const startChat = async () => {
    if (!scenario) return;
    if (generating) return;

    const selectedPersona = personas.find(p => p.id === selectedPersonaId);
    if (!selectedPersona) {
      showToast("Please select a persona first!", 'error');
      return;
    }

    setGenerating(true);

    const newChatId = uuidv4();

    // Replace {{user}} placeholders in the greeting with the persona's name
    const greeting = (scenario.greetingMessage || '').replace(/\{\{user\}\}/g, selectedPersona.name);

    /** New chat structure before saving */
    const newChat: {
      id: string;
      scenarioId: string;
      title: string;
      userCharacter: Persona;
      messages: Message[];
      memories: any[];
      settings: any;
      createdAt: number;
    } = {
      id: newChatId,
      scenarioId: scenario.id,
      title: scenario.name,
      userCharacter: selectedPersona,
      messages: greeting ? [
        {
          id: uuidv4(),
          role: 'assistant' as const,
          content: greeting,
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
        customInstructions: '',
      },
      createdAt: Date.now(),
    };

    try {
      // If no greeting message exists, auto-generate a first response from the AI
      if (!greeting) {
        showToast('Generating story opening...', 'info');
        const response = await deepseek.chat([
          {
            id: uuidv4(),
            role: 'user',
            content: '*continue*',
            timestamp: Date.now(),
          }
        ], newChat.settings, scenario, newChat);
        newChat.messages = [
          {
            id: uuidv4(),
            role: 'user' as const,
            content: '*continue*',
            timestamp: Date.now(),
          },
          {
            id: uuidv4(),
            role: 'assistant' as const,
            content: response,
            timestamp: Date.now(),
          },
        ];
      }
      // Save and navigate to the new chat
      await apiService.saveChat(newChat);
      navigate(`/chat/${newChatId}`);
    } catch (err) {
      showToast('Failed to start chat', 'error');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="p-8 text-white">Loading...</div>;
  if (!scenario) return <div className="p-8 text-white">Scenario not found.</div>;

  return (
    <div className="pb-24 pt-4 px-4 max-w-7xl mx-auto">
      {/* Back navigation */}
      <button 
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-zinc-400 font-bold hover:text-white transition-colors mb-6"
      >
        <ChevronLeft size={20} />
        Back to Discovery
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8">
        {/* ─── Left Column: Image, info, backstory, lore ─── */}
        <div className="space-y-8">
          {/* Main scenario image */}
          <div className="aspect-video w-full rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl">
            <img 
              src={scenario.image || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect fill='%23d1d5db' width='800' height='450'/%3E%3C/svg%3E"}
              alt={scenario.name}
              className="w-full h-full object-contain bg-zinc-950"
            />
          </div>

          {/* Title + Tags + Metadata */}
          <div className="space-y-4">
            <h1 className="text-4xl font-black text-white">{scenario.name}</h1>
            <div className="flex flex-wrap gap-2">
              {scenario.tags.map(tag => (
                <span key={tag} className="bg-indigo-600/10 text-indigo-400 border border-indigo-600/20 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                  {tag}
                </span>
              ))}
            </div>
            
            <div className="flex items-center gap-6 text-sm text-zinc-500 font-bold">
               <div className="flex items-center gap-2">
                  <Calendar size={16} />
                  <span>Created {format(scenario.createdAt, 'MMM d, yyyy')}</span>
               </div>
               <div className="flex items-center gap-2">
                  {scenario.settings.isPublic ? <Globe size={16} /> : <Lock size={16} />}
                  <span>{scenario.settings.isPublic ? 'Public' : 'Private'}</span>
               </div>
            </div>
          </div>

          {/* Story Description */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
               <Info className="text-blue-500" size={24} />
               <h2 className="text-xl font-bold text-white uppercase tracking-widest">Story Description</h2>
            </div>
            <p className="text-zinc-300 leading-relaxed text-lg italic">
              "{scenario.description}"
            </p>
          </div>

          {/* The Backstory */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
              <Book className="text-green-500" size={24} />
              <h2 className="text-xl font-bold text-white uppercase tracking-widest">The Backstory</h2>
            </div>
            <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {scenario.backstory}
            </p>
          </div>

          {/* Key Characters & Lore */}
          {scenario.lorePieces.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-white uppercase tracking-widest px-2">Key Characters & Lore</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {scenario.lorePieces.map(piece => {
                  const isExpanded = expandedLoreIds.has(piece.id);
                  return (
                    <div key={piece.id} className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex gap-4">
                      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                         <User size={24} className="text-zinc-600" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-white">{piece.title}</h4>
                        <p className="text-xs text-zinc-500 uppercase font-black">{piece.type}</p>
                        <p className={`text-sm text-zinc-400 mt-2 ${isExpanded ? '' : 'line-clamp-2'}`}>{piece.content}</p>
                        {piece.content.length > 150 && (
                          <button
                            onClick={() => toggleLoreExpand(piece.id)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-bold mt-1 transition-colors"
                          >
                            {isExpanded ? 'less' : 'more...'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ─── Right Column: Actions sidebar (sticky) ─── */}
        <div className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sticky top-24 space-y-6">
             {/* START CHAT — opens persona selection modal */}
             <button 
               onClick={() => setShowPersonaSelect(true)}
               className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-black text-xl flex items-center justify-center gap-3 shadow-xl shadow-indigo-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
             >
               <Play fill="currentColor" size={24} />
               START CHAT
             </button>

             {/* ─── Persona Selection Modal ─── */}
             {showPersonaSelect && (
               <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                 <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
                   {/* Modal header */}
                   <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                     <h3 className="text-xl font-bold text-white">Select Your Persona</h3>
                     <button onClick={() => setShowPersonaSelect(false)} className="text-zinc-500 hover:text-white transition-colors">
                       <X size={24} />
                     </button>
                   </div>
                   {/* Persona list */}
                   <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
                     {personas.length === 0 ? (
                       <div className="text-center py-8 space-y-4">
                         <p className="text-zinc-500 italic">You don't have any personas yet.</p>
                         <button 
                            onClick={() => navigate('/settings')}
                            className="text-indigo-400 font-bold hover:underline flex items-center gap-2 mx-auto"
                         >
                           Go to Settings to create one <SettingsIcon size={16} />
                         </button>
                       </div>
                     ) : (
                       personas.map(p => (
                         <div 
                           key={p.id}
                           onClick={() => setSelectedPersonaId(p.id)}
                           className={`p-4 rounded-2xl border transition-all cursor-pointer flex gap-4 items-center ${
                             selectedPersonaId === p.id 
                             ? 'bg-indigo-600/10 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]' 
                             : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                           }`}
                         >
                           <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden flex-shrink-0">
                             {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" /> : <User className="text-zinc-700" />}
                           </div>
                           <div className="flex-1">
                             <h4 className="font-bold text-white">{p.name}</h4>
                             <p className="text-xs text-zinc-500 line-clamp-1">{p.description}</p>
                           </div>
                           {selectedPersonaId === p.id && <Check className="text-indigo-500" size={20} />}
                         </div>
                       ))
                     )}
                   </div>
                   {/* Modal actions */}
                   <div className="p-6 border-t border-zinc-800 flex gap-4">
                     <button 
                       onClick={() => setShowPersonaSelect(false)}
                       className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold transition-colors"
                     >
                       Cancel
                     </button>
                     <button 
                       onClick={startChat}
                       disabled={!selectedPersonaId || generating}
                       className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg shadow-indigo-900/20 transition-all flex items-center justify-center gap-2"
                     >
                       {generating ? 'Generating...' : 'Confirm & Play'}
                     </button>
                   </div>
                 </div>
               </div>
             )}

             {/* Action buttons row */}
             <div className="flex flex-col gap-2">
               <div className="flex gap-2">
                 <button className="flex-1 bg-zinc-800 hover:bg-zinc-700 py-3 rounded-xl flex items-center justify-center gap-2 font-bold text-zinc-300 transition-colors">
                   <Heart size={18} /> Favorite
                 </button>
                 {/* Edit/Customize — opens CreateScenario in edit mode */}
                 {canEdit && (
                   <button 
                    onClick={() => navigate('/create', { state: { scenario } })}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 py-3 rounded-xl flex items-center justify-center gap-2 font-bold text-zinc-300 transition-colors"
                   >
                     <SettingsIcon size={18} /> {isOwner ? 'Edit' : 'Customize'}
                   </button>
                 )}
               </div>
               
               {/* Owner/Admin actions: Export + Delete */}
               {(isOwner || isAdmin) && (
                 <>
                 {/* Export — serializes scenario to a downloadable JSON file */}
                 <button 
                  onClick={async () => {
                    let url = '';
                    try {
                      const s = await apiService.getScenario(scenario.id);
                      const exportData = {
                        id: s.id,
                        displayName: s.name,
                        description: s.description,
                        backStory: s.backstory,
                        customGreeting: s.greetingMessage || '',
                        customInstructions: s.customInstructions || '',
                        genres: s.tags,
                        lorePieces: s.lorePieces.map((lp: any) => ({
                          id: lp.id,
                          title: lp.title,
                          content: lp.content,
                          description: lp.description || '',
                          type: lp.type,
                          triggers: lp.triggers || [],
                          linkedPieces: lp.linkedPieces || [],
                          weight: lp.weight || 100,
                          pinned: !!lp.pinned,
                          hidden: !!lp.hidden,
                          smartActivation: !!lp.smartActivation,
                          traits: [],
                          avatarURL: null,
                          isPlayable: false,
                        })),
                        characters: s.characters.map((c: any) => ({
                          id: c.id,
                          name: c.name,
                          description: c.description,
                          personality: c.personality,
                          avatarURL: c.avatar || null,
                        })),
                        sensitiveContent: s.settings.sensitiveContent,
                        separateUser: s.settings.separateUserCharacter,
                        isPublic: s.settings.isPublic,
                        allowEditing: s.settings.allowCustomization,
                        hidePrompts: s.settings.hidePrompts,
                        allowComments: s.settings.allowCommenting,
                        creatorName: s.creatorName,
                        createdAt: s.createdAt,
                      };
                      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                      url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${s.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
                      a.click();
                    } catch (err) {
                      console.error('Export failed:', err);
                      showToast('Failed to export scenario', 'error');
                    } finally {
                     if (url) URL.revokeObjectURL(url);
                    }
                  }}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition-colors border border-zinc-700"
                 >
                   <Download size={18} /> Export Scenario
                 </button>
                 {/* Delete — removes the scenario entirely */}
                  <button 
                   onClick={async () => {
                     if (await showConfirm('Move this scenario to trash? You can restore it later.')) {
                       await apiService.deleteScenario(scenario.id);
                       showToast('Scenario moved to trash', 'success');
                       navigate('/');
                     }
                   }}
                  className="w-full bg-red-900/20 hover:bg-red-900/30 text-red-500 py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition-colors border border-red-900/30"
                 >
                   <Trash2 size={18} /> Delete Scenario
                 </button>
                 </>
               )}
             </div>

             {/* Scenario metadata details */}
             <div className="pt-4 border-t border-zinc-800 space-y-4">
                <div className="flex items-center justify-between text-sm">
                   <span className="text-zinc-500 font-bold uppercase tracking-wider text-[10px]">User Character</span>
                   <span className="text-white font-bold">Selectable</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                   <span className="text-zinc-500 font-bold uppercase tracking-wider text-[10px]">Model Support</span>
                   <span className="text-white font-bold">DeepSeek V3</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                   <span className="text-zinc-500 font-bold uppercase tracking-wider text-[10px]">Safety</span>
                   <div className="flex items-center gap-1">
                      {scenario.settings.sensitiveContent ? (
                        <>
                          <ShieldAlert size={14} className="text-red-500" />
                          <span className="text-red-500 font-bold">18+</span>
                        </>
                      ) : (
                        <span className="text-green-500 font-bold">Safe</span>
                      )}
                   </div>
                </div>
             </div>

             {/* Terms notice */}
             <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800">
                <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest text-center leading-relaxed">
                   By starting this scenario, you agree to our Terms of Service and Privacy Policy.
                </p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
