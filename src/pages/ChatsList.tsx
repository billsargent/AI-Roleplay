import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Trash2, Calendar, Book, ChevronRight, Search, User, Shield } from 'lucide-react';
import { apiService } from '../services/api';
import { Chat, Scenario } from '../types';
import { format } from 'date-fns';
import { useNotifications } from '../utils/notifications';

export const ChatsList: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();

  const [chats, setChats] = useState<Chat[]>([]);
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const currentUser = apiService.getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [storedChats, storedScenarios] = await Promise.all([
          apiService.getChats(),
          apiService.getScenarios(),
        ]);
        const scenarioMap: Record<string, Scenario> = {};
        storedScenarios.forEach((s: Scenario) => { scenarioMap[s.id] = s; });
        
        setChats(storedChats.sort((a: Chat, b: Chat) => b.createdAt - a.createdAt));
        setScenarios(scenarioMap);
      } catch (e) {
        console.error('Failed to load chats', e);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const deleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (await showConfirm('Move this chat to trash? You can restore it later.')) {
      try {
        await apiService.deleteChat(id);
        setChats(prev => prev.filter(c => c.id !== id));
        showToast('Chat moved to trash', 'success');
      } catch (err) {
        showToast('Failed to delete chat', 'error');
      }
    }
  };

  const filterChats = (search: string) => (c: Chat) => {
    const scenario = scenarios[c.scenarioId];
    const scenarioName = scenario?.name || 'Unknown Scenario';
    return scenarioName.toLowerCase().includes(search.toLowerCase()) || 
           c.messages[c.messages.length - 1]?.content.toLowerCase().includes(search.toLowerCase());
  };

  const myChats = chats.filter(c => c.userId === currentUser?.id).filter(filterChats(search));
  const otherChats = isAdmin ? chats.filter(c => c.userId !== currentUser?.id).filter(filterChats(search)) : [];

  const renderChatCard = (chat: Chat, showOwner = false) => {
    const scenario = scenarios[chat.scenarioId];
    const lastMessage = chat.messages[chat.messages.length - 1];
    const isOwnedByAdmin = chat.userId === currentUser?.id;

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
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-white font-bold truncate">{scenario?.name || 'Deleted Scenario'}</h3>
              {showOwner && !isOwnedByAdmin && (
                <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-1 whitespace-nowrap bg-zinc-800 px-2 py-0.5 rounded-full">
                  <User size={10} />
                  {(chat as any).ownerUsername || 'Unknown'}
                </span>
              )}
              {showOwner && isOwnedByAdmin && (
                <span className="text-[10px] font-bold text-indigo-500 flex items-center gap-1 whitespace-nowrap bg-indigo-600/10 px-2 py-0.5 rounded-full">
                  <Shield size={10} />
                  You
                </span>
              )}
            </div>
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
          {isOwnedByAdmin && (
            <button 
              onClick={(e) => deleteChat(e, chat.id)}
              className="p-2 text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={18} />
            </button>
          )}
          <ChevronRight size={20} className="text-zinc-700" />
        </div>
      </div>
    );
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">
            {isAdmin ? 'Chat Management' : 'Your Chats'}
          </h1>
          <p className="text-zinc-400">
            {isAdmin ? 'View all chats across the platform' : 'Continue your ongoing stories'}
          </p>
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

      {isAdmin && (
        <>
          {/* My Chats Section */}
          <div className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Shield size={18} className="text-indigo-500" />
              My Chats
            </h2>
            <div className="space-y-4">
              {myChats.length === 0 && !loading && (
                <p className="text-zinc-600 text-sm italic text-center py-8">No chats yet.</p>
              )}
              {myChats.map(chat => renderChatCard(chat, true))}
            </div>
          </div>

          {/* Other Users' Chats Section */}
          <div>
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <User size={18} className="text-zinc-500" />
              Other Users' Chats
              {otherChats.length > 0 && (
                <span className="text-xs text-zinc-600 font-bold">({otherChats.length})</span>
              )}
            </h2>
            <p className="text-xs text-zinc-600 mb-4 italic">
              These chats are read-only. You can view them but cannot send messages or make changes.
            </p>
            <div className="space-y-4">
              {otherChats.length === 0 && !loading && (
                <p className="text-zinc-600 text-sm italic text-center py-8">No other users' chats yet.</p>
              )}
              {otherChats.map(chat => renderChatCard(chat, true))}
            </div>
          </div>
        </>
      )}

      {!isAdmin && (
        <div className="space-y-4">
          {chats.filter(filterChats(search)).map(chat => renderChatCard(chat))}
        </div>
      )}

      {!loading && chats.length === 0 && (
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
  );
};

