
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Trash2, Calendar, Book, ChevronRight, Search } from 'lucide-react';
import { storage } from '../services/storage';
import { Chat, Scenario } from '../types';
import { format } from 'date-fns';

export const ChatsList: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({});
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const storedChats = storage.getChats();
    const storedScenarios = storage.getScenarios();
    const scenarioMap: Record<string, Scenario> = {};
    storedScenarios.forEach(s => { scenarioMap[s.id] = s; });
    
    setChats(storedChats.sort((a, b) => b.createdAt - a.createdAt));
    setScenarios(scenarioMap);
  }, []);

  const deleteChat = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this chat?')) {
      storage.deleteChat(id);
      setChats(prev => prev.filter(c => c.id !== id));
    }
  };

  const filteredChats = chats.filter(c => {
    const scenario = scenarios[c.scenarioId];
    const scenarioName = scenario?.name || 'Unknown Scenario';
    return scenarioName.toLowerCase().includes(search.toLowerCase()) || 
           c.messages[c.messages.length - 1]?.content.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="pb-24 pt-4 px-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Your Chats</h1>
          <p className="text-zinc-400">Continue your ongoing stories</p>
        </div>
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
        <input 
          type="text"
          placeholder="Search chats..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 pl-11 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {filteredChats.map(chat => {
          const scenario = scenarios[chat.scenarioId];
          const lastMessage = chat.messages[chat.messages.length - 1];
          
          return (
            <div 
              key={chat.id}
              onClick={() => navigate(`/chat/${chat.id}`)}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:border-zinc-700 transition-all group"
            >
              <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-800 bg-zinc-800">
                {scenario?.image ? (
                  <img src={scenario.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600">
                    <MessageSquare size={24} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-white font-bold truncate pr-4">{scenario?.name || 'Deleted Scenario'}</h3>
                  <span className="text-[10px] font-bold text-zinc-600 flex items-center gap-1 uppercase tracking-widest whitespace-nowrap">
                    <Calendar size={10} />
                    {format(chat.createdAt, 'MMM d, HH:mm')}
                  </span>
                </div>
                <p className="text-sm text-zinc-500 truncate italic">
                  {lastMessage ? lastMessage.content : 'No messages yet'}
                </p>
                <div className="flex items-center gap-4 mt-2">
                   <div className="flex items-center gap-1 text-[10px] text-zinc-600 font-bold uppercase tracking-wider">
                      <MessageSquare size={12} />
                      {chat.messages.length} messages
                   </div>
                   <div className="flex items-center gap-1 text-[10px] text-zinc-600 font-bold uppercase tracking-wider">
                      <Book size={12} />
                      {chat.memories.length} memories
                   </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={(e) => deleteChat(e, chat.id)}
                  className="p-2 text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
                <ChevronRight size={20} className="text-zinc-700" />
              </div>
            </div>
          );
        })}

        {filteredChats.length === 0 && (
          <div className="text-center py-20 bg-zinc-900/50 border-2 border-dashed border-zinc-800 rounded-3xl">
            <MessageSquare size={48} className="mx-auto text-zinc-800 mb-4" />
            <p className="text-zinc-500 font-medium">No chats found. Go to home and start a scenario!</p>
            <button 
              onClick={() => navigate('/')}
              className="mt-4 text-indigo-500 font-bold hover:underline"
            >
              Discover Scenarios
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
