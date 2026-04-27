
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Play, ChevronLeft, Calendar, User, 
  Book, Info, Settings as SettingsIcon,
  Globe, Lock, ShieldAlert, Heart, X, Check, Trash2
} from 'lucide-react';
import { storage } from '../services/storage';
import { apiService } from '../services/api';
import { Scenario, Persona } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

export const ScenarioDetail: React.FC = () => {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [showPersonaSelect, setShowPersonaSelect] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    const loadScenario = async () => {
      if (scenarioId) {
        try {
          const fetched = await apiService.getScenarios();
          const s = fetched.find((item: Scenario) => item.id === scenarioId);
          if (s) {
            setScenario(s);
            const user = apiService.getCurrentUser();
            const owner = s.userId === user?.id;
            const admin = user?.role === 'admin';
            setIsOwner(owner);
            setIsAdmin(admin);
            setCanEdit(owner || s.settings?.allowCustomization);
          } else {
            navigate('/');
          }
        } catch (e) {
          navigate('/');
        }
      }
    };
    loadScenario();
    setPersonas(apiService.getPersonas());
  }, [scenarioId, navigate]);

  const startChat = () => {
    if (!scenario) return;
    
    const selectedPersona = personas.find(p => p.id === selectedPersonaId);
    if (!selectedPersona) {
      alert("Please select a persona first!");
      return;
    }

    const newChatId = uuidv4();
    
    // Replace {{user}} in greeting with actual persona name immediately
    const greeting = (scenario.greetingMessage || '').replace(/\{\{user\}\}/g, selectedPersona.name);

    const newChat = {
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
        customInstructions: '', // Default empty, can be customized in chat
      },
      createdAt: Date.now(),
    };
    storage.saveChat(newChat);
    navigate(`/chat/${newChatId}`);
  };

  if (!scenario) return <div className="p-8 text-white">Loading...</div>;

  return (
    <div className="pb-24 pt-4 px-4 max-w-5xl mx-auto">
      <button 
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-zinc-400 font-bold hover:text-white transition-colors mb-6"
      >
        <ChevronLeft size={20} />
        Back to Discovery
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8">
        <div className="space-y-8">
          <div className="aspect-video w-full rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl">
            <img 
              src={scenario.image || 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop'} 
              alt={scenario.name}
              className="w-full h-full object-cover"
            />
          </div>

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

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
               <Info className="text-blue-500" size={24} />
               <h2 className="text-xl font-bold text-white uppercase tracking-widest">Story Description</h2>
            </div>
            <p className="text-zinc-300 leading-relaxed text-lg italic">
              "{scenario.description}"
            </p>
          </div>

          {!scenario.settings.hidePrompts && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
              <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
                <Book className="text-green-500" size={24} />
                <h2 className="text-xl font-bold text-white uppercase tracking-widest">The Backstory</h2>
              </div>
              <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {scenario.backstory}
              </p>
            </div>
          )}

          {scenario.lorePieces.length > 0 && !scenario.settings.hidePrompts && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-white uppercase tracking-widest px-2">Key Characters & Lore</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {scenario.lorePieces.map(piece => (
                  <div key={piece.id} className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl flex gap-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                       <User size={24} className="text-zinc-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white">{piece.title}</h4>
                      <p className="text-xs text-zinc-500 uppercase font-black">{piece.type}</p>
                      <p className="text-sm text-zinc-400 mt-2 line-clamp-2">{piece.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sticky top-24 space-y-6">
             <button 
               onClick={() => setShowPersonaSelect(true)}
               className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-black text-xl flex items-center justify-center gap-3 shadow-xl shadow-indigo-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
             >
               <Play fill="currentColor" size={24} />
               START CHAT
             </button>

             {showPersonaSelect && (
               <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                 <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
                   <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                     <h3 className="text-xl font-bold text-white">Select Your Persona</h3>
                     <button onClick={() => setShowPersonaSelect(false)} className="text-zinc-500 hover:text-white transition-colors">
                       <X size={24} />
                     </button>
                   </div>
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
                   <div className="p-6 border-t border-zinc-800 flex gap-4">
                     <button 
                       onClick={() => setShowPersonaSelect(false)}
                       className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold transition-colors"
                     >
                       Cancel
                     </button>
                     <button 
                       onClick={startChat}
                       disabled={!selectedPersonaId}
                       className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg shadow-indigo-900/20 transition-all"
                     >
                       Confirm & Play
                     </button>
                   </div>
                 </div>
               </div>
             )}

             <div className="flex flex-col gap-2">
               <div className="flex gap-2">
                 <button className="flex-1 bg-zinc-800 hover:bg-zinc-700 py-3 rounded-xl flex items-center justify-center gap-2 font-bold text-zinc-300 transition-colors">
                   <Heart size={18} /> Favorite
                 </button>
                 {canEdit && (
                   <button 
                    onClick={() => navigate('/create', { state: { scenario } })}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 py-3 rounded-xl flex items-center justify-center gap-2 font-bold text-zinc-300 transition-colors"
                   >
                     <SettingsIcon size={18} /> {isOwner ? 'Edit' : 'Customize'}
                   </button>
                 )}
               </div>
               
               {(isOwner || isAdmin) && (
                 <button 
                  onClick={async () => {
                    if (confirm('Are you sure you want to delete this scenario?')) {
                      await apiService.deleteScenario(scenario.id);
                      navigate('/');
                    }
                  }}
                  className="w-full bg-red-900/20 hover:bg-red-900/30 text-red-500 py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition-colors border border-red-900/30"
                 >
                   <Trash2 size={18} /> Delete Scenario
                 </button>
               )}
             </div>

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
