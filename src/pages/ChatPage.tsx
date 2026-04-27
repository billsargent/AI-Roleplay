
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Send, Settings as SettingsIcon, Brain, Info, 
  ChevronLeft, MessageSquare, MoreVertical, RefreshCw, Trash2,
  X, Pin, User, Edit2
} from 'lucide-react';
import { storage } from '../services/storage';
import { apiService } from '../services/api';
import { deepseek } from '../services/deepseek';
import { Chat, Message, Scenario, Persona } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

export const ChatPage: React.FC = () => {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [chat, setChat] = useState<Chat | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sidebar, setSidebar] = useState<'none' | 'settings' | 'matrix' | 'info'>('none');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatId) {
      const storedChat = storage.getChats().find(c => c.id === chatId);
      if (storedChat) {
        setChat(storedChat);
        const storedScenario = storage.getScenarios().find(s => s.id === storedChat.scenarioId);
        if (storedScenario) setScenario(storedScenario);
      } else {
        navigate('/');
      }
    }
  }, [chatId, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages]);

  const handleSend = async () => {
    if (!input.trim() || !chat || !scenario || isTyping) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    const updatedMessages = [...chat.messages, userMessage];
    const updatedChat = { ...chat, messages: updatedMessages };
    setChat(updatedChat);
    storage.saveChat(updatedChat);
    setInput('');
    setIsTyping(true);

    try {
      const response = await deepseek.chat(updatedMessages, chat.settings, scenario, updatedChat);
      
      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      const finalMessages = [...updatedMessages, assistantMessage];
      const finalChat = { ...updatedChat, messages: finalMessages };
      
      // Auto-generate memory every 10 messages (FictionLab does 30, but let's do 10 for demo)
      if (finalMessages.length % 10 === 0) {
        const memoryContent = await deepseek.generateMemory(finalMessages);
        if (memoryContent) {
          finalChat.memories.push({
            id: uuidv4(),
            content: memoryContent,
            pinned: false,
            timestamp: Date.now()
          });
        }
      }

      setChat(finalChat);
      storage.saveChat(finalChat);
    } catch (error: any) {
      alert(error.message || 'Error communicating with DeepSeek');
    } finally {
      setIsTyping(false);
    }
  };

  if (!chat || !scenario) return <div className="p-8 text-white">Loading...</div>;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-200 overflow-hidden relative">
      {/* Sidebar Desktop */}
      <div className="hidden lg:flex flex-col w-64 border-r border-zinc-800 bg-zinc-900">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <button onClick={() => navigate('/chats')} className="text-zinc-400 hover:text-white">
            <ChevronLeft size={20} />
          </button>
          <h2 className="font-bold truncate px-2">{scenario.name}</h2>
          <button className="text-zinc-400 hover:text-white">
            <MoreVertical size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <nav className="p-2 space-y-1">
            <button 
              onClick={() => setSidebar(sidebar === 'info' ? 'none' : 'info')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${sidebar === 'info' ? 'bg-zinc-800 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
            >
              <Info size={18} />
              <span>Scenario Info</span>
            </button>
            <button 
              onClick={() => setSidebar(sidebar === 'matrix' ? 'none' : 'matrix')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${sidebar === 'matrix' ? 'bg-zinc-800 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
            >
              <Brain size={18} />
              <span>Memory Matrix</span>
            </button>
            <button 
              onClick={() => setSidebar(sidebar === 'settings' ? 'none' : 'settings')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${sidebar === 'settings' ? 'bg-zinc-800 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
            >
              <SettingsIcon size={18} />
              <span>Chat Settings</span>
            </button>
          </nav>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Mobile Header */}
        <header className="lg:hidden h-14 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between px-4 z-20">
          <button onClick={() => navigate('/chats')} className="text-zinc-400">
            <ChevronLeft size={24} />
          </button>
          <span className="font-bold truncate max-w-[200px]">{scenario.name}</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebar('matrix')} className="text-zinc-400"><Brain size={20} /></button>
            <button onClick={() => setSidebar('settings')} className="text-zinc-400"><SettingsIcon size={20} /></button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-32 pt-6 lg:pt-4">
          {chat.messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center px-8">
              <MessageSquare size={48} className="mb-4 opacity-20" />
              <p>No messages yet. Send a message to start the story!</p>
            </div>
          )}
          {chat.messages.map((m) => (
            <div key={m.id} className={`group relative flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} ${m.role === 'system' ? 'items-center !my-2' : ''}`}>
              {m.role !== 'system' ? (
                <>
                  <div className="flex items-center gap-2 mb-1 px-1">
                    {m.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold">
                        AI
                      </div>
                    )}
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">
                      {m.role === 'assistant' ? (m.characterName || scenario.name) : (chat.userCharacter?.name || 'YOU')}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {format(m.timestamp, 'HH:mm')}
                    </span>
                  </div>
                  <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm relative ${
                    m.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none' 
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none'
                  }`}>
                    <div className="whitespace-pre-wrap leading-relaxed prose prose-invert prose-sm message-content">
                      {m.content.split(/(\*[^*]+\*)/g).map((part, i) => {
                        if (part.startsWith('*') && part.endsWith('*')) {
                          return <em key={i}>{part.slice(1, -1)}</em>;
                        }
                        return part;
                      })}
                    </div>

                    {/* Message Actions Overlay */}
                    <div className={`absolute top-0 ${m.role === 'user' ? 'right-full mr-2' : 'left-full ml-2'} opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-lg shadow-xl z-10`}>
                      <button 
                        onClick={() => {
                          const newContent = prompt('Edit message:', m.content);
                          if (newContent !== null) {
                            const newMessages = chat.messages.map(msg => msg.id === m.id ? { ...msg, content: newContent } : msg);
                            const updatedChat = { ...chat, messages: newMessages };
                            setChat(updatedChat);
                            storage.saveChat(updatedChat);
                          }
                        }}
                        className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors" title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        onClick={() => {
                          if (confirm('Delete this and all messages after it? (Rewind)')) {
                            const index = chat.messages.findIndex(msg => msg.id === m.id);
                            const newMessages = chat.messages.slice(0, index + 1);
                            const updatedChat = { ...chat, messages: newMessages };
                            setChat(updatedChat);
                            storage.saveChat(updatedChat);
                          }
                        }}
                        className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors" title="Rewind"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button 
                        onClick={() => {
                          if (confirm('Delete this message?')) {
                            const newMessages = chat.messages.filter(msg => msg.id !== m.id);
                            const updatedChat = { ...chat, messages: newMessages };
                            setChat(updatedChat);
                            storage.saveChat(updatedChat);
                          }
                        }}
                        className="p-1.5 hover:bg-red-900/40 rounded text-zinc-400 hover:text-red-500 transition-colors" title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="px-4 py-1.5 bg-zinc-900/50 border border-zinc-800/50 rounded-full text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">
                   {m.content}
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2 mb-1 px-1">
                <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center">
                  <RefreshCw size={12} className="animate-spin" />
                </div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">AI is thinking...</span>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-none p-4 w-16 flex justify-center">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce"></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-zinc-950 via-zinc-950 to-transparent">
          <div className="max-w-4xl mx-auto relative group">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Write your response..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-4 pr-12 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[60px] max-h-[200px] resize-none transition-all"
              rows={1}
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all ${
                input.trim() && !isTyping ? 'bg-indigo-600 text-white shadow-lg' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
            >
              <Send size={20} />
            </button>
          </div>
          <div className="flex justify-center mt-2">
             <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Shift + Enter for new line</p>
          </div>
        </div>
      </div>

      {/* Overlay Sidebars */}
      {sidebar !== 'none' && (
        <div className="absolute inset-0 z-30 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebar('none')} />
          <div className="relative w-full max-w-md bg-zinc-900 border-l border-zinc-800 h-full overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
              <h3 className="text-lg font-bold flex items-center gap-2">
                {sidebar === 'matrix' && <><Brain size={20} className="text-indigo-500" /> Memory Matrix</>}
                {sidebar === 'settings' && <><SettingsIcon size={20} className="text-zinc-400" /> Chat Settings</>}
                {sidebar === 'info' && <><Info size={20} className="text-blue-500" /> Scenario Info</>}
              </h3>
              <button onClick={() => setSidebar('none')} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              {sidebar === 'matrix' && <MemoryMatrixView chat={chat} scenario={scenario} setChat={setChat} />}
              {sidebar === 'settings' && <ChatSettingsView chat={chat} setChat={setChat} />}
              {sidebar === 'info' && <ScenarioInfoView scenario={scenario} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MemoryMatrixView: React.FC<{ chat: Chat, scenario: Scenario, setChat: (chat: Chat) => void }> = ({ chat, scenario, setChat }) => {
  const [activeTab, setActiveTab] = useState<'lore' | 'memories'>('lore');

  return (
    <div className="space-y-6">
      <div className="flex p-1 bg-zinc-950 rounded-lg">
        <button 
          onClick={() => setActiveTab('lore')}
          className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'lore' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500'}`}
        >
          Lore Database
        </button>
        <button 
          onClick={() => setActiveTab('memories')}
          className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'memories' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500'}`}
        >
          AI Memories
        </button>
      </div>

      {activeTab === 'lore' ? (
        <div className="space-y-4">
          {scenario.lorePieces.length === 0 && (
            <p className="text-zinc-500 text-sm italic text-center py-8">No lore pieces defined for this scenario.</p>
          )}
          {scenario.lorePieces.map(piece => (
            <div key={piece.id} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded ${piece.type === 'character' ? 'bg-blue-900 text-blue-200' : 'bg-zinc-700 text-zinc-300'}`}>
                  {piece.type}
                </span>
                {piece.pinned && <Pin size={14} className="text-indigo-400 fill-indigo-400" />}
              </div>
              <h4 className="font-bold text-white mb-1">{piece.title}</h4>
              <p className="text-xs text-zinc-400 line-clamp-3">{piece.content}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
             <h4 className="text-xs uppercase font-bold text-zinc-500 tracking-wider">Recent Memories ({chat.memories.length})</h4>
             <button className="text-xs text-indigo-400 font-bold hover:underline">Manual Generation</button>
          </div>
          {chat.memories.length === 0 && (
            <p className="text-zinc-500 text-sm italic text-center py-8">No memories have been generated yet.</p>
          )}
          {chat.memories.slice().reverse().map(memory => (
            <div key={memory.id} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-zinc-300 leading-relaxed">{memory.content}</p>
                <button 
                  onClick={() => {
                    const newMemories = chat.memories.map(m => m.id === memory.id ? { ...m, pinned: !m.pinned } : m);
                    const newChat = { ...chat, memories: newMemories };
                    setChat(newChat);
                    storage.saveChat(newChat);
                  }}
                  className={`mt-1 flex-shrink-0 ${memory.pinned ? 'text-indigo-400' : 'text-zinc-600 hover:text-zinc-400'}`}
                >
                  <Pin size={16} fill={memory.pinned ? 'currentColor' : 'none'} />
                </button>
              </div>
              <div className="mt-2 text-[10px] text-zinc-500">
                {format(memory.timestamp, 'MMM d, HH:mm')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ChatSettingsView: React.FC<{ chat: Chat, setChat: (chat: Chat) => void }> = ({ chat, setChat }) => {
  const [personas, setPersonas] = React.useState<Persona[]>([]);
  
  React.useEffect(() => {
    setPersonas(apiService.getPersonas());
  }, []);

  const updateSettings = (key: string, value: any, notification?: string) => {
    const newMessages = [...chat.messages];
    if (notification) {
      newMessages.push({
        id: uuidv4(),
        role: 'system',
        content: notification,
        timestamp: Date.now()
      });
    }

    const newChat = {
      ...chat,
      messages: newMessages,
      settings: {
        ...chat.settings,
        [key]: value
      }
    };
    setChat(newChat);
    storage.saveChat(newChat);
  };

  const changePersona = (persona: Persona) => {
    const newChat = {
      ...chat,
      userCharacter: persona,
      messages: [
        ...chat.messages,
        {
          id: uuidv4(),
          role: 'system' as const,
          content: `[System: User has changed their persona to ${persona.name}. Description: ${persona.description}]`,
          timestamp: Date.now()
        }
      ]
    };
    setChat(newChat);
    storage.saveChat(newChat);
  };

  return (
    <div className="space-y-8">
      <div>
        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Active Persona</label>
        <div className="grid grid-cols-1 gap-2">
          {personas.map(p => (
            <button
              key={p.id}
              onClick={() => changePersona(p)}
              className={`p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                chat.userCharacter?.id === p.id 
                ? 'bg-indigo-600/10 border-indigo-500' 
                : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-zinc-900 overflow-hidden flex-shrink-0">
                {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" /> : <User size={16} className="m-2 text-zinc-600" />}
              </div>
              <span className={`text-sm font-bold ${chat.userCharacter?.id === p.id ? 'text-indigo-400' : 'text-zinc-400'}`}>
                {p.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Response Length</label>
        <div className="flex bg-zinc-950 p-1 rounded-lg">
          {(['short', 'medium', 'long'] as const).map(length => (
            <button
              key={length}
              onClick={() => updateSettings('responseLength', length)}
              className={`flex-1 py-1.5 rounded-md text-sm capitalize transition-all ${chat.settings.responseLength === length ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
            >
              {length}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Custom Instructions</label>
        <textarea
          value={chat.settings.customInstructions || ''}
          onChange={(e) => updateSettings('customInstructions', e.target.value)}
          onBlur={(e) => {
            if (e.target.value !== chat.settings.customInstructions) {
              updateSettings('customInstructions', e.target.value, `[System: AI Instructions have been updated: ${e.target.value}]`);
            }
          }}
          placeholder="e.g. Always respond in third person, focus on dialogue..."
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[100px]"
        />
        <p className="mt-2 text-[10px] text-zinc-600 italic">Instructions to nudge the AI's behavior in this specific chat.</p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-300">Stream Text Response</span>
          <button 
            onClick={() => updateSettings('streamResponse', !chat.settings.streamResponse)}
            className={`w-10 h-5 rounded-full transition-colors relative ${chat.settings.streamResponse ? 'bg-indigo-600' : 'bg-zinc-800'}`}
          >
            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${chat.settings.streamResponse ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-300">Show Suggestions</span>
          <button 
            onClick={() => updateSettings('showSuggestions', !chat.settings.showSuggestions)}
            className={`w-10 h-5 rounded-full transition-colors relative ${chat.settings.showSuggestions ? 'bg-indigo-600' : 'bg-zinc-800'}`}
          >
            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${chat.settings.showSuggestions ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
      </div>

      <div className="pt-4 border-t border-zinc-800">
        <button 
          onClick={() => {
            if (confirm('Are you sure you want to clear all messages?')) {
              const newChat = { ...chat, messages: [] };
              setChat(newChat);
              storage.saveChat(newChat);
            }
          }}
          className="w-full flex items-center justify-center gap-2 py-3 bg-red-900/20 text-red-500 border border-red-900/50 rounded-xl hover:bg-red-900/30 transition-colors"
        >
          <Trash2 size={18} />
          <span className="font-bold">Clear Chat History</span>
        </button>
      </div>
    </div>
  );
};

const ScenarioInfoView: React.FC<{ scenario: Scenario }> = ({ scenario }) => {
  return (
    <div className="space-y-6">
      <div className="aspect-video rounded-xl overflow-hidden border border-zinc-800">
        <img src={scenario.image} alt={scenario.name} className="w-full h-full object-cover" />
      </div>
      <div>
        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Backstory</h4>
        <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{scenario.backstory}</p>
      </div>
      {scenario.customInstructions && (
        <div>
          <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Instructions</h4>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{scenario.customInstructions}</p>
        </div>
      )}
      <div>
        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Tags</h4>
        <div className="flex flex-wrap gap-2">
          {scenario.tags.map(tag => (
            <span key={tag} className="text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded border border-zinc-700">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
