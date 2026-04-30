import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, RefreshCw, RotateCcw, AlertTriangle, MessageSquare, FileText, ChevronLeft } from 'lucide-react';
import { apiService } from '../services/api';
import { useNotifications } from '../utils/notifications';

export const TrashPage: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const navigate = useNavigate();

  const [chats, setChats] = useState<any[]>([]);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTrash = async () => {
    setLoading(true);
    try {
      const data = await apiService.getTrash();
      setChats(data.chats || []);
      setScenarios(data.scenarios || []);
    } catch (e) {
      console.error('Failed to load trash', e);
      showToast('Failed to load trash', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrash();
  }, []);

  const handleRestoreChat = async (id: string) => {
    try {
      await apiService.restoreChat(id);
      showToast('Chat restored successfully', 'success');
      setChats(prev => prev.filter(c => c.id !== id));
    } catch (e) {
      showToast('Failed to restore chat', 'error');
    }
  };

  const handleRestoreScenario = async (id: string) => {
    try {
      await apiService.restoreScenario(id);
      showToast('Scenario restored successfully', 'success');
      setScenarios(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      showToast('Failed to restore scenario', 'error');
    }
  };

  const handlePermanentDeleteChat = async (id: string) => {
    if (await showConfirm('Permanently delete this chat? This cannot be undone.')) {
      try {
        await apiService.permanentlyDeleteChat(id);
        showToast('Chat permanently deleted', 'success');
        setChats(prev => prev.filter(c => c.id !== id));
      } catch (e) {
        showToast('Failed to delete chat', 'error');
      }
    }
  };

  const handlePermanentDeleteScenario = async (id: string) => {
    if (await showConfirm('Permanently delete this scenario? This cannot be undone.')) {
      try {
        await apiService.permanentlyDeleteScenario(id);
        showToast('Scenario permanently deleted', 'success');
        setScenarios(prev => prev.filter(s => s.id !== id));
      } catch (e) {
        showToast('Failed to delete scenario', 'error');
      }
    }
  };

  const handleEmptyTrash = async () => {
    if (await showConfirm('Empty trash permanently? All deleted items will be gone forever.')) {
      try {
        await apiService.emptyTrash();
        showToast('Trash emptied', 'success');
        setChats([]);
        setScenarios([]);
      } catch (e) {
        showToast('Failed to empty trash', 'error');
      }
    }
  };

  const totalItems = chats.length + scenarios.length;

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="pb-24 pt-4 px-4 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white">Trash</h1>
            <p className="text-zinc-400 text-sm">
              {totalItems === 0 ? 'Trash is empty' : `${totalItems} item${totalItems !== 1 ? 's' : ''} in trash`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadTrash}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
            title="Refresh"
          >
            <RefreshCw size={18} className="text-zinc-400" />
          </button>
          {totalItems > 0 && (
            <button
              onClick={handleEmptyTrash}
              className="flex items-center gap-2 px-4 py-2 bg-red-900/20 text-red-500 border border-red-900/30 rounded-xl hover:bg-red-900/30 transition-all font-bold text-sm"
            >
              <Trash2 size={16} />
              Empty Trash
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-zinc-500">
          <RefreshCw size={32} className="mx-auto mb-3 animate-spin" />
          <p>Loading trash...</p>
        </div>
      ) : totalItems === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <Trash2 size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg font-bold text-zinc-500">Trash is empty</p>
          <p className="text-sm mt-1">Deleted items will appear here</p>
        </div>
      ) : (
        <>
          {/* Deleted Chats */}
          {chats.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={16} className="text-blue-500" />
                <h2 className="text-lg font-bold text-white">Deleted Chats ({chats.length})</h2>
              </div>
              <div className="space-y-2">
                {chats.map(chat => (
                  <div key={chat.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white truncate">{chat.title || 'Untitled Chat'}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Deleted {formatDate(chat.createdAt || chat.deletedAt)}
                        {chat.scenarioId && ' • Scenario: ' + (chat.scenarioName || 'Unknown Scenario')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRestoreChat(chat.id)}
                        className="p-2 bg-emerald-900/20 text-emerald-500 rounded-xl hover:bg-emerald-900/30 transition-all"
                        title="Restore chat"
                      >
                        <RotateCcw size={16} />
                      </button>
                      <button
                        onClick={() => handlePermanentDeleteChat(chat.id)}
                        className="p-2 bg-red-900/20 text-red-500 rounded-xl hover:bg-red-900/30 transition-all"
                        title="Permanently delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Deleted Scenarios */}
          {scenarios.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <FileText size={16} className="text-indigo-500" />
                <h2 className="text-lg font-bold text-white">Deleted Scenarios ({scenarios.length})</h2>
              </div>
              <div className="space-y-2">
                {scenarios.map(scenario => (
                  <div key={scenario.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white truncate">{scenario.name || 'Untitled Scenario'}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Deleted {formatDate(scenario.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRestoreScenario(scenario.id)}
                        className="p-2 bg-emerald-900/20 text-emerald-500 rounded-xl hover:bg-emerald-900/30 transition-all"
                        title="Restore scenario"
                      >
                        <RotateCcw size={16} />
                      </button>
                      <button
                        onClick={() => handlePermanentDeleteScenario(scenario.id)}
                        className="p-2 bg-red-900/20 text-red-500 rounded-xl hover:bg-red-900/30 transition-all"
                        title="Permanently delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Info box */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-4 text-xs text-zinc-500">
        <p className="flex items-center gap-2">
          <AlertTriangle size={14} />
          Items in trash can be restored or permanently deleted. Deleted items may be automatically purged after 30 days.
        </p>
      </div>
    </div>
  );
};
