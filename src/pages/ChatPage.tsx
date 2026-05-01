/**
 * Chat Page — Main AI Roleplay Chat Interface
 * 
 * This is the primary chat experience where users interact with the AI.
 * Features include:
 * - Streaming (SSE) and non-streaming AI response modes
 * - Message composition with Enter-to-send (Shift+Enter for newlines)
 * - Auto-generated AI memories at configurable intervals
 * - Memory trimming (oldest non-pinned removed when max count exceeded)
 * - Three overlay views: Scenario Info, Memory Matrix, Chat Settings
 * - Message editing, rewinding, and deletion
 * - Read-only mode for admin viewing other users' chats
 * - Customizable dialog/narration/bubble colors from user settings
 * 
 * @module ChatPage
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Send, Settings as SettingsIcon, Brain, Info, 
  ChevronLeft, MessageSquare, RefreshCw, Trash2,
  X, Pin, User, Edit2, FileDown, Play
} from 'lucide-react';
import { apiService } from '../services/api';
import { deepseek } from '../services/deepseek';
import { Chat, Message, Scenario, Persona } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { useNotifications } from '../utils/notifications';
import { jsPDF } from 'jspdf';

/**
 * Global LLM settings cached on the window object for memory management.
 * These are loaded from the server on mount and accessed throughout the chat lifecycle.
 */
declare global {
  interface Window {
    __memorySendInterval: number;      // How often (in user messages) memories are sent to the AI
    __memoryGenerateInterval: number;   // How often new memories are auto-generated
    __memoryWordCount: number;          // Target word count for generated memories
    __memoryMaxCount: number;           // Maximum number of stored memories before trimming
  }
}

/**
 * Main chat page component.
 * Handles loading a chat by ID, managing conversation state, sending messages,
 * streaming AI responses, auto-generating memories, and rendering the UI.
 */
export const ChatPage: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();

  // ── Core state ──
  const [chat, setChat] = useState<Chat | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [overlay, setOverlay] = useState<'none' | 'settings' | 'matrix' | 'info'>('none');
  const [overlayTab, setOverlayTab] = useState<'info' | 'matrix' | 'settings'>('info');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [scenarioDeleted, setScenarioDeleted] = useState(false);

  // ── Reference to messages container for PDF capture ──
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // ── User-facing color preferences ──
  const [dialogColor, setDialogColor] = useState('#4f46e5');
  const [narrationColor, setNarrationColor] = useState('');
  const [chatBubbleColor, setChatBubbleColor] = useState('#4f46e5');
  const [chatPaddingLeft, setChatPaddingLeft] = useState(16);
  const [chatPaddingRight, setChatPaddingRight] = useState(16);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat data on mount or when chatId changes
  useEffect(() => {
    if (chatId) {
      loadChat(chatId);
    }
  }, [chatId, navigate]);

  // Load user color preferences and global LLM/memory settings on mount
  useEffect(() => {
    const loadUserSettings = async () => {
      try {
        const settings = await apiService.getUserSettings();
        if (settings.dialogColor) setDialogColor(settings.dialogColor);
        if (settings.narrationColor) setNarrationColor(settings.narrationColor);
        if (settings.chatBubbleColor) setChatBubbleColor(settings.chatBubbleColor);
      } catch {
        // Use defaults
      }
      // Load global LLM settings (memory intervals, padding, etc.)
      try {
        const llmSettings = await apiService.getLlmSettings();
        if (llmSettings.chatPaddingLeft) setChatPaddingLeft(parseInt(llmSettings.chatPaddingLeft));
        if (llmSettings.chatPaddingRight) setChatPaddingRight(parseInt(llmSettings.chatPaddingRight));
        window.__memorySendInterval = llmSettings.memorySendInterval ? parseInt(llmSettings.memorySendInterval) : 25;
        window.__memoryGenerateInterval = llmSettings.memoryGenerateInterval ? parseInt(llmSettings.memoryGenerateInterval) : 25;
        window.__memoryWordCount = llmSettings.memoryWordCount ? parseInt(llmSettings.memoryWordCount) : 100;
        window.__memoryMaxCount = llmSettings.memoryMaxCount ? parseInt(llmSettings.memoryMaxCount) : 50;
      } catch {
        // Use defaults
        window.__memorySendInterval = 25;
        window.__memoryGenerateInterval = 25;
        window.__memoryWordCount = 100;
        window.__memoryMaxCount = 50;
      }
    };
    loadUserSettings();
  }, []);

  /**
   * Fetches a chat and its associated scenario from the server.
   * Enforces access control: users can only access their own chats,
   * while admins can view any chat (in read-only mode).
   */
  const loadChat = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const storedChat = await apiService.getChat(id);
      if (storedChat) {
        const user = apiService.getCurrentUser();
        // Determine if this chat belongs to another user
        const isOwnedByOther = storedChat.userId && storedChat.userId !== user?.id;
        if (isOwnedByOther && user?.role !== 'admin') {
          setError('You do not have access to this chat.');
          return;
        }
        if (isOwnedByOther && user?.role === 'admin') {
          setIsReadOnly(true); // Admins view other users' chats read-only
        }
        setChat(storedChat);
        try {
          const storedScenario = await apiService.getScenario(storedChat.scenarioId);
          if (storedScenario) {
            setScenario(storedScenario);
          }
        } catch (err: any) {
          // Scenario was soft-deleted by the creator — enter read-only mode
          if (err.response?.status === 404) {
            setScenarioDeleted(true);
            setIsReadOnly(true);
          } else {
            throw err; // Re-throw other errors to be caught below
          }
        }
      } else {
        setError('Chat not found.');
      }
    } catch (e: any) {
      if (e.response?.status === 403 || e.response?.status === 404) {
        setError('Chat not found or access denied.');
      } else {
        setError('Failed to load chat.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages]);

  // Initial scroll to bottom after loading completes
  useEffect(() => {
    if (!loading && chat && chat.messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }, 100);
    }
  }, [loading]);

  /**
   * Core send logic — creates a user message with the given text and sends it to the AI.
   * Handles streaming/non-streaming responses, memory generation, and saving.
   * 
   * Flow:
   * 1. Creates a user message and adds it to the chat
   * 2. Saves the user message to the server
   * 3. If streaming is enabled: uses SSE to display the AI response in real-time
   * 4. If streaming is disabled: waits for the complete response
   * 5. Auto-generates a memory at the configured interval
   * 6. Trims oldest non-pinned memories if the max count is exceeded
   * 7. Saves the final chat state to the server
   */
  const sendMessage = async (text: string) => {
    if (!text || !chat || !scenario || isTyping || isReadOnly) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...chat.messages, userMessage];
    const updatedChat = { ...chat, messages: updatedMessages };
    setChat(updatedChat);
    setIsTyping(true);

    try {
      // Save user message to server
      await apiService.saveChat(updatedChat);

      if (chat.settings.streamResponse) {
        // ── Streaming path ──
        const assistantMessageId = uuidv4();
        const assistantMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        };

        // Add placeholder message that will be updated in real-time
        const messagesWithPlaceholder = [...updatedMessages, assistantMessage];
        const chatWithPlaceholder = { ...updatedChat, messages: messagesWithPlaceholder };
        setChat(chatWithPlaceholder);

        // Stream the response, updating the placeholder message content via callback
        const fullContent = await deepseek.chatStream(
          updatedMessages,
          chat.settings,
          scenario,
          updatedChat,
          (chunk) => {
            setChat(prevChat => {
              if (!prevChat) return prevChat;
              const newMessages = prevChat.messages.map(m =>
                m.id === assistantMessageId
                  ? { ...m, content: m.content + chunk }
                  : m
              );
              return { ...prevChat, messages: newMessages };
            });
          }
        );

        const finalMessages = [...updatedMessages, {
          ...assistantMessage,
          content: fullContent,
        }];
        const finalChat = { ...updatedChat, messages: finalMessages };

        // Auto-generate memory at configured interval
        handleMemoryGeneration(finalChat, finalMessages);

        setChat(finalChat);
        await apiService.saveChat(finalChat);
      } else {
        // ── Non-streaming path ──
        const response = await deepseek.chat(updatedMessages, chat.settings, scenario, updatedChat);
        
        const assistantMessage: Message = {
          id: uuidv4(),
          role: 'assistant',
          content: response,
          timestamp: Date.now(),
        };

        const finalMessages = [...updatedMessages, assistantMessage];
        const finalChat = { ...updatedChat, messages: finalMessages };
        
        handleMemoryGeneration(finalChat, finalMessages);

        setChat(finalChat);
        await apiService.saveChat(finalChat);
      }
    } catch (error: any) {
      showToast(error.message || 'Error communicating with DeepSeek', 'error');
    } finally {
      setIsTyping(false);
    }
  };

  /**
   * Public send handler — reads from the input state and sends.
   */
  const handleSend = async () => {
    await sendMessage(input.trim());
    setInput('');
  };

  /**
   * Generates a new AI memory if the user message count aligns with the
   * configured generate interval, then trims old memories if the max is exceeded.
   * 
   * @param chatObj - The chat object to potentially add a memory to
   * @param messages - The current message list (used to count user messages)
   */
  const handleMemoryGeneration = async (chatObj: Chat, messages: Message[]) => {
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    const genInterval = window.__memoryGenerateInterval || 25;
    const wordCount = window.__memoryWordCount || 100;
    if (userMsgCount > 0 && userMsgCount % genInterval === 0) {
      const memoryContent = await deepseek.generateMemory(messages, wordCount);
      if (memoryContent) {
        chatObj.memories.push({
          id: uuidv4(),
          content: memoryContent,
          pinned: false,
          timestamp: Date.now()
        });
      }
    }

    // Trim oldest non-pinned memories when exceeding max count
    const maxMem = window.__memoryMaxCount || 50;
    if (chatObj.memories.length > maxMem) {
      const pinned = chatObj.memories.filter(m => m.pinned);
      const nonPinned = chatObj.memories
        .filter(m => !m.pinned)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, maxMem - pinned.length);
      chatObj.memories = [...pinned, ...nonPinned];
    }
  };

  // ── Render states ──
  if (loading) return <div className="p-8 text-white">Loading...</div>;
  if (error) return (
    <div className="p-8 flex flex-col items-center justify-center min-h-screen">
      <p className="text-zinc-400 mb-4">{error}</p>
      <button 
        onClick={() => navigate('/chats')}
        className="text-indigo-400 font-bold hover:underline"
      >
        Back to Chats
      </button>
    </div>
  );
  if (!chat) return <div className="p-8 text-white">Chat not found.</div>;
  if (!scenario && !scenarioDeleted) return <div className="p-8 text-white">Chat not found.</div>;

  return (
    <div className="flex flex-1 min-h-0 max-h-screen bg-zinc-950 text-zinc-200 relative">

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">

        {/* Read-Only Banner (shown when admin views another user's chat) */}
        {isReadOnly && !scenarioDeleted && (
          <div className="flex-shrink-0 bg-amber-600/10 border-b border-amber-600/20 px-4 py-2 text-center">
            <span className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center justify-center gap-2">
              <User size={14} />
              Viewing {chat.ownerUsername ? <>{chat.ownerUsername}'s</> : 'another user\'s'} chat — read-only
            </span>
          </div>
        )}

        {/* Scenario Deleted Banner (shown when the scenario has been soft-deleted by its creator) */}
        {scenarioDeleted && (
          <div className="flex-shrink-0 bg-red-600/10 border-b border-red-600/20 px-4 py-2 text-center">
            <span className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center justify-center gap-2">
              <Info size={14} />
              This scenario has been deleted by its creator — chat is now read-only
            </span>
          </div>
        )}

        {/* ── Messages Area ── */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto space-y-6 py-6"
          style={{ paddingLeft: chatPaddingLeft + 'px', paddingRight: chatPaddingRight + 'px' }}>
          
          {/* Empty state */}
          {chat.messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center px-8">
              <MessageSquare size={48} className="mb-4 opacity-20" />
              <p>No messages yet. Send a message to start the story!</p>
            </div>
          )}

          {/* Message list */}
          {chat.messages.map((m) => (
            <div key={m.id} className={`group relative flex flex-col ${m.role === 'user' ? 'items-end mr-4' : 'items-start'} ${m.role === 'system' ? 'items-center !my-2' : ''}`}>
              {m.role !== 'system' ? (
                <>
                  {/* Message header: avatar, name, timestamp */}
                  <div className="flex items-center gap-2 mb-1 px-1">
                    {m.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold">
                        AI
                      </div>
                    )}
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">
                      {m.role === 'assistant' ? (m.characterName || scenario?.name || 'AI') : (chat.userCharacter?.name || 'YOU')}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {format(m.timestamp, 'HH:mm')}
                    </span>
                  </div>

                  {/* Message bubble with dialog/narration color highlighting */}
                  <div 
                    className={`max-w-[85%] rounded-2xl p-4 shadow-sm relative ${
                      m.role === 'user' 
                        ? 'text-white rounded-tr-none' 
                        : 'bg-zinc-900 border border-zinc-800 rounded-tl-none'
                    }`}
                    style={m.role === 'user' ? { backgroundColor: chatBubbleColor } : narrationColor ? { color: narrationColor } : {}}
                  >
                    {/* Parse *italic* and "dialogue" markers for color styling */}
                    <div className="whitespace-pre-wrap leading-relaxed message-content">
                      {m.content.split(/(\*[^*]+\*|"[^"]*")/g).map((part, i) => {
                        if (part.startsWith('*') && part.endsWith('*')) {
                          return <em key={i} style={{ color: narrationColor || undefined }}>{part.slice(1, -1)}</em>;
                        }
                        if (part.startsWith('"') && part.endsWith('"')) {
                          return <span key={i} style={{ color: dialogColor }}>{part}</span>;
                        }
                        return part;
                      })}
                    </div>

                    {/* Message action buttons: Edit, Rewind, Delete (hidden in read-only) */}
                    {!isReadOnly && (
                      <div className={`absolute top-0 ${m.role === 'user' ? 'right-full mr-2' : 'left-full ml-2'} opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-lg shadow-xl z-10`}>
                        <button 
                          onClick={async () => {
                            const newContent = prompt('Edit message:', m.content);
                            if (newContent !== null) {
                              const newMessages = chat.messages.map(msg => msg.id === m.id ? { ...msg, content: newContent } : msg);
                              const updatedChat = { ...chat, messages: newMessages };
                              setChat(updatedChat);
                              await apiService.saveChat(updatedChat);
                            }
                          }}
                          className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors" title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          onClick={async () => {
                            if (await showConfirm('Delete this and all messages after it? (Rewind)')) {
                              const index = chat.messages.findIndex(msg => msg.id === m.id);
                              const newMessages = chat.messages.slice(0, index + 1);
                              const updatedChat = { ...chat, messages: newMessages };
                              setChat(updatedChat);
                              await apiService.saveChat(updatedChat);
                            }
                          }}
                          className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors" title="Rewind"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button 
                          onClick={async () => {
                            if (await showConfirm('Delete this message?')) {
                              const newMessages = chat.messages.filter(msg => msg.id !== m.id);
                              const updatedChat = { ...chat, messages: newMessages };
                              setChat(updatedChat);
                              await apiService.saveChat(updatedChat);
                            }
                          }}
                          className="p-1.5 hover:bg-red-900/40 rounded text-zinc-400 hover:text-red-500 transition-colors" title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                // System messages (e.g., persona change notifications) rendered as pill badges
                <div className="px-4 py-1.5 bg-zinc-900/50 border border-zinc-800/50 rounded-full text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">
                  {m.content}
                </div>
              )}
            </div>
          ))}

          {/* Continue button — appears when last message is from the AI and not read-only/typing */}
          {!isReadOnly && !isTyping && chat.messages.length > 0 && chat.messages[chat.messages.length - 1].role === 'assistant' && (
            <div className="flex justify-center">
              <button
                onClick={() => sendMessage('*continue*')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:border-purple-500/50 hover:text-purple-300 transition-all text-xs font-bold"
              >
                <Play size={12} fill="currentColor" />
                Continue
              </button>
            </div>
          )}

          {/* Typing indicator for non-streaming mode */}
          {isTyping && !chat.settings.streamResponse && (
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

        {/* ── Input Area ── */}
        <div className="flex-shrink-0">
          <div className="px-4 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950 to-transparent">
            <div className="max-w-4xl mx-auto relative group">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    !isReadOnly && handleSend();
                  }
                }}
                placeholder={scenarioDeleted ? "⚠ This scenario has been deleted by its creator — chat is read-only" : (isReadOnly ? "This chat is read-only" : "Write your response...")}
                disabled={isReadOnly}
                className={`w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-4 pr-28 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[60px] max-h-[200px] resize-none transition-all ${scenarioDeleted ? 'placeholder:text-red-400/60 text-red-300/50 border-red-800/50' : ''} ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                rows={1}
              />
              {/* Input action buttons */}
              <div className="absolute right-2 bottom-2 flex items-center gap-1">
                <button 
                  onClick={() => { setOverlay('settings'); setOverlayTab('settings'); }}
                  className="p-2 rounded-xl transition-colors text-purple-400 hover:text-white hover:bg-zinc-800" title="Chat Settings"
                >
                  <SettingsIcon size={22} />
                </button>
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping || isReadOnly}
                  className={`p-2 rounded-xl transition-all ${
                    input.trim() && !isTyping && !isReadOnly ? 'bg-indigo-600 text-white shadow-lg' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </div>
          {/* Footer bar with back button and scenario name */}
          <div className="px-4 pb-4 pt-2 flex items-center justify-center gap-2">
            <button onClick={() => navigate('/chats')} className="text-zinc-500 hover:text-white transition-colors" title="Back to Chats">
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-zinc-500 font-bold truncate max-w-[200px]">{scenario?.name || 'Chat'}</span>
          </div>
        </div>
      </div>

      {/* ── Full-Screen Overlay (Memory Matrix, Settings, Info) ── */}
      {overlay !== 'none' && (
        <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
          {/* Overlay header with tab navigation */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              {overlayTab === 'matrix' && <><Brain size={20} className="text-indigo-500" /> <span className="text-lg font-bold text-white">Memory Matrix</span></>}
              {overlayTab === 'settings' && <><SettingsIcon size={20} className="text-zinc-400" /> <span className="text-lg font-bold text-white">Chat Settings</span></>}
              {overlayTab === 'info' && <><Info size={20} className="text-blue-500" /> <span className="text-lg font-bold text-white">Scenario Info</span></>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setOverlayTab('info')} className={`p-2 rounded-lg transition-colors ${overlayTab === 'info' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`} title="Scenario Info">
                <Info size={18} />
              </button>
              <button onClick={() => setOverlayTab('matrix')} className={`p-2 rounded-lg transition-colors ${overlayTab === 'matrix' ? 'bg-zinc-800 text-indigo-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`} title="Memory Matrix">
                <Brain size={18} />
              </button>
              <button onClick={() => setOverlayTab('settings')} className={`p-2 rounded-lg transition-colors ${overlayTab === 'settings' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`} title="Chat Settings">
                <SettingsIcon size={18} />
              </button>
              <button onClick={() => setOverlay('none')} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                <X size={22} />
              </button>
            </div>
          </div>

          {/* Scrollable overlay content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-xl mx-auto">
              {overlayTab === 'matrix' && scenario && <MemoryMatrixView chat={chat} scenario={scenario} setChat={setChat} />}
              {overlayTab === 'settings' && <ChatSettingsView chat={chat} setChat={setChat} />}
              {overlayTab === 'info' && scenario && <ScenarioInfoView scenario={scenario} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Sub-Views (rendered within the full-screen overlay)
// ============================================================================

/**
 * Memory Matrix View
 * 
 * Two-tab view showing:
 * - **Lore Database**: All lore pieces from the scenario with type badges and pin status
 * - **AI Memories**: Generated memories with pin/delete controls and manual generation
 */
const MemoryMatrixView: React.FC<{ chat: Chat, scenario: Scenario, setChat: (chat: Chat) => void }> = ({ chat, scenario, setChat }) => {
  const { showConfirm } = useNotifications();
  const [activeTab, setActiveTab] = useState<'lore' | 'memories'>('lore');

  return (
    <div className="space-y-6">
      {/* Tab toggle */}
      <div className="flex p-1 bg-zinc-900/50 rounded-xl border border-zinc-800/50 max-w-xs mx-auto">
        <button 
          onClick={() => setActiveTab('lore')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'lore' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          Lore Database
        </button>
        <button 
          onClick={() => setActiveTab('memories')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'memories' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          AI Memories
        </button>
      </div>

      {activeTab === 'lore' ? (
        /* Lore pieces from the scenario */
        <div className="space-y-3">
          {scenario.lorePieces.length === 0 && (
            <p className="text-zinc-600 text-sm italic text-center py-8">No lore pieces defined for this scenario.</p>
          )}
          {scenario.lorePieces.map(piece => (
            <div key={piece.id} className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700/50 rounded-xl p-4 hover:border-zinc-600/50 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full ${piece.type === 'character' ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-700/50 text-zinc-400'}`}>
                  {piece.type}
                </span>
                {piece.pinned && <Pin size={14} className="text-indigo-400 fill-indigo-400" />}
              </div>
              <h4 className="font-bold text-white mb-1 text-sm">{piece.title}</h4>
              <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">{piece.content}</p>
            </div>
          ))}
        </div>
      ) : (
        /* AI-generated memories */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs uppercase font-bold text-zinc-600 tracking-wider">Memories ({chat.memories.length})</h4>
            <button
              onClick={async () => {
                const memoryContent = await deepseek.generateMemory(chat.messages);
                if (memoryContent && await showConfirm(`Add this memory?\n\n"${memoryContent}"`)) {
                  const newMemories = [...chat.memories, { id: uuidv4(), content: memoryContent, pinned: false, timestamp: Date.now() }];
                  const newChat = { ...chat, memories: newMemories };
                  setChat(newChat);
                  await apiService.saveChat(newChat);
                }
              }}
              className="text-xs text-indigo-400 font-bold px-3 py-1.5 bg-indigo-600/10 border border-indigo-600/20 rounded-lg hover:bg-indigo-600/20 transition-colors"
            >
              + Generate
            </button>
          </div>
          {chat.memories.length === 0 && (
            <p className="text-zinc-600 text-sm italic text-center py-8">No memories have been generated yet.</p>
          )}
          {/* Display memories newest-first (reversed order) */}
          {chat.memories.slice().reverse().map(memory => (
            <div key={memory.id} className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700/50 rounded-xl p-4 hover:border-zinc-600/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-zinc-300 leading-relaxed flex-1">{memory.content}</p>
                <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                  <button
                    onClick={async () => {
                      if (await showConfirm('Delete this memory?')) {
                        const newMemories = chat.memories.filter(m => m.id !== memory.id);
                        const newChat = { ...chat, memories: newMemories };
                        setChat(newChat);
                        await apiService.saveChat(newChat);
                      }
                    }}
                    className="p-1.5 rounded-lg text-zinc-600 hover:bg-red-900/30 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button 
                    onClick={async () => {
                      const newMemories = chat.memories.map(m => m.id === memory.id ? { ...m, pinned: !m.pinned } : m);
                      const newChat = { ...chat, memories: newMemories };
                      setChat(newChat);
                      await apiService.saveChat(newChat);
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${memory.pinned ? 'text-indigo-400 bg-indigo-600/10' : 'text-zinc-600 hover:bg-zinc-700 hover:text-zinc-400'}`}
                  >
                    <Pin size={16} fill={memory.pinned ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-zinc-600 font-medium">
                {format(memory.timestamp, 'MMM d, HH:mm')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Chat Settings View
 * 
 * Allows users to configure the active chat session:
 * - Select/deselect personas
 * - Change response length (short/medium/long)
 * - Set custom AI instructions
 * - Toggle stream response and show suggestions
 * - Clear chat history
 * Each change is saved to the server immediately.
 */
const ChatSettingsView: React.FC<{ 
  chat: Chat, 
  setChat: (chat: Chat) => void,
}> = ({ chat, setChat }) => {
  const { showToast, showConfirm } = useNotifications();
  const [personas, setPersonas] = React.useState<Persona[]>([]);

  // Load available personas on mount
  React.useEffect(() => {
    const loadPersonas = async () => {
      const data = await apiService.getPersonas();
      setPersonas(data);
    };
    loadPersonas();
  }, []);

  /**
   * Exports the entire chat (messages + metadata) as a downloadable JSON file.
   */
  const exportAsJSON = () => {
    const exportData = {
      title: chat.title,
      scenarioId: chat.scenarioId,
      createdAt: chat.createdAt,
      userCharacter: chat.userCharacter,
      settings: chat.settings,
      messages: chat.messages,
      memories: chat.memories,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chat.title || 'chat'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Chat exported as JSON', 'success');
  };

  /**
   * Exports the chat messages as a PDF using jsPDF native text rendering.
   * Uses print-optimized colors (dark text on white) regardless of the user's
   * app theme, then appends the AI memories section at the end.
   */
  const exportAsPDF = () => {
    try {
      showToast('Generating PDF...', 'success');

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const maxWidth = pageWidth - margin * 2;
      const lineH = 5;

      let y = margin;

      const checkPage = (needed: number) => {
        if (y + needed > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
      };

      // ── Title Page ──
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor(30, 30, 30);
      const title = chat.title || 'Chat Export';
      const titleLines = pdf.splitTextToSize(title, maxWidth);
      y = 60;
      titleLines.forEach((line: string) => {
        pdf.text(line, pageWidth / 2, y, { align: 'center' });
        y += 10;
      });
      y += 8;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(120, 120, 120);
      pdf.text(`Exported: ${format(new Date(), 'MMM d, yyyy HH:mm')}`, pageWidth / 2, y, { align: 'center' });
      y += 6;
      pdf.text(`Messages: ${chat.messages.length}`, pageWidth / 2, y, { align: 'center' });
      if (chat.memories.length > 0) {
        y += 6;
        pdf.text(`Memories: ${chat.memories.length}`, pageWidth / 2, y, { align: 'center' });
      }

      // ── Message Pages ──
      pdf.addPage();
      y = margin;

      for (const msg of chat.messages) {
        if (msg.role === 'system') {
          checkPage(10);
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(8);
          pdf.setTextColor(160, 160, 160);
          const sysLines = pdf.splitTextToSize(msg.content, maxWidth - 20);
          sysLines.forEach((line: string) => {
            pdf.text(line, pageWidth / 2, y, { align: 'center' });
            y += 3.5;
          });
          y += 3;
          continue;
        }

        // Sender + timestamp header
        const sender = msg.role === 'user'
          ? (chat.userCharacter?.name || 'YOU')
          : (msg.characterName || 'AI');
        const timeStr = format(msg.timestamp, 'MMM d, HH:mm');

        checkPage(10);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        if (msg.role === 'user') {
          pdf.setTextColor(0, 90, 180); // Dark blue for user
        } else {
          pdf.setTextColor(110, 50, 160); // Dark purple for AI
        }
        pdf.text(`${sender}  •  ${timeStr}`, margin, y);
        y += 4;

        // Message content with word wrap
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(40, 40, 40); // Near-black for readability

        const contentLines = pdf.splitTextToSize(msg.content, maxWidth);
        checkPage(contentLines.length * lineH);

        contentLines.forEach((line: string) => {
          pdf.text(line, margin, y);
          y += lineH;
        });

        y += 3; // spacing between messages
      }

      // ── Memories Section ──
      if (chat.memories.length > 0) {
        pdf.addPage();
        y = margin;

        checkPage(20);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.setTextColor(110, 50, 160);
        pdf.text('AI Memories', margin, y);
        y += 4;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(140, 140, 140);
        pdf.text(`Total: ${chat.memories.length} memory${chat.memories.length !== 1 ? 'ies' : 'y'}`, margin, y);
        y += 12;

        // Sort: pinned first, then newest first
        const sortedMemories = [...chat.memories].sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return b.timestamp - a.timestamp;
        });

        for (const mem of sortedMemories) {
          checkPage(14);

          // Date line with pin indicator
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          if (mem.pinned) {
            pdf.setTextColor(110, 50, 160);
            pdf.text('📌', margin, y);
            pdf.text(format(mem.timestamp, 'MMM d, yyyy HH:mm'), margin + 5, y);
          } else {
            pdf.setTextColor(140, 140, 140);
            pdf.text(format(mem.timestamp, 'MMM d, yyyy HH:mm'), margin, y);
          }
          y += 5;

          // Content
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.setTextColor(40, 40, 40);

          const memLines = pdf.splitTextToSize(mem.content, maxWidth);
          checkPage(memLines.length * lineH);

          memLines.forEach((line: string) => {
            pdf.text(line, margin, y);
            y += lineH;
          });

          y += 4; // spacing between memories
        }
      }

      pdf.save(`${chat.title || 'chat'}-${Date.now()}.pdf`);
      showToast('Chat exported as PDF', 'success');
    } catch (err) {
      console.error('PDF export error:', err);
      showToast('Failed to generate PDF', 'error');
    }
  };

  /**
   * Updates a chat setting and optionally appends a system notification message.
   * Saves to server immediately after state update.
   */
  const updateSettings = async (key: string, value: any, notification?: string) => {
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
    await apiService.saveChat(newChat);
  };

  /**
   * Changes the active persona for this chat.
   * Appends a system message notifying of the change.
   */
  const changePersona = async (persona: Persona) => {
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
    await apiService.saveChat(newChat);
  };

  return (
    <div className="space-y-8">
      {/* Persona selection */}
      <section>
        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 px-1">Active Persona</label>
        <div className="space-y-1.5">
          {personas.map(p => (
            <button
              key={p.id}
              onClick={() => changePersona(p)}
              className={`w-full p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                chat.userCharacter?.id === p.id 
                ? 'bg-indigo-600/10 border-indigo-500/50 shadow-sm shadow-indigo-900/20' 
                : 'bg-zinc-800/30 border-zinc-700/50 hover:border-zinc-600/50'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-zinc-900 overflow-hidden flex-shrink-0 ring-1 ring-zinc-700">
                {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" /> : <User size={16} className="m-2 text-zinc-600" />}
              </div>
              <span className={`text-sm font-bold ${chat.userCharacter?.id === p.id ? 'text-indigo-400' : 'text-zinc-400'}`}>
                {p.name}
              </span>
              {chat.userCharacter?.id === p.id && (
                <span className="ml-auto text-[10px] font-black text-indigo-500 uppercase tracking-wider bg-indigo-600/20 px-2 py-0.5 rounded-full">Active</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Response length selector */}
      <section>
        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 px-1">Response Length</label>
        <div className="flex p-1 bg-zinc-900/50 border border-zinc-800/50 rounded-xl max-w-sm">
          {(['short', 'medium', 'long'] as const).map(length => (
            <button
              key={length}
              onClick={() => updateSettings('responseLength', length)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold capitalize transition-all ${
                chat.settings.responseLength === length 
                  ? 'bg-zinc-800 text-white shadow' 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {length}
            </button>
          ))}
        </div>
      </section>

      {/* Custom instructions textarea */}
      <section>
        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 px-1">Custom Instructions</label>
        <textarea
          value={chat.settings.customInstructions || ''}
          onChange={(e) => updateSettings('customInstructions', e.target.value)}
          onBlur={(e) => {
            if (e.target.value !== chat.settings.customInstructions) {
              updateSettings('customInstructions', e.target.value, `[System: AI Instructions have been updated: ${e.target.value}]`);
            }
          }}
          placeholder="e.g. Always respond in third person, focus on dialogue..."
          className="w-full bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-3 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[100px] placeholder-zinc-600"
        />
        <p className="mt-2 text-[10px] text-zinc-600 italic px-1">Instructions to nudge the AI's behavior in this specific chat.</p>
      </section>

      {/* Toggle switches */}
      <section className="bg-zinc-800/20 border border-zinc-800/40 rounded-xl divide-y divide-zinc-800/50 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-zinc-300 font-medium">Stream Text Response</span>
          <button 
            onClick={() => updateSettings('streamResponse', !chat.settings.streamResponse)}
            className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${chat.settings.streamResponse ? 'bg-indigo-600' : 'bg-zinc-700'}`}
          >
            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all shadow ${chat.settings.streamResponse ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-zinc-300 font-medium">Show Suggestions</span>
          <button 
            onClick={() => updateSettings('showSuggestions', !chat.settings.showSuggestions)}
            className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${chat.settings.showSuggestions ? 'bg-indigo-600' : 'bg-zinc-700'}`}
          >
            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all shadow ${chat.settings.showSuggestions ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
      </section>

      {/* ── Export Section ── */}
      <section>
        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 px-1">Export Chat</label>
        <div className="flex gap-3">
          <button 
            onClick={exportAsJSON}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600/10 text-emerald-400 border border-emerald-600/20 rounded-xl hover:bg-emerald-600/20 transition-colors text-sm font-bold"
          >
            <FileDown size={16} />
            Export JSON
          </button>
          <button 
            onClick={exportAsPDF}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-600/10 text-indigo-400 border border-indigo-600/20 rounded-xl hover:bg-indigo-600/20 transition-colors text-sm font-bold"
          >
            <FileDown size={16} />
            Export PDF
          </button>
        </div>
      </section>

      {/* Danger zone: clear chat */}
      <div className="pt-2">
        <button 
          onClick={async () => {
            if (await showConfirm('Are you sure you want to clear all messages?')) {
              const newChat = { ...chat, messages: [] };
              setChat(newChat);
              await apiService.saveChat(newChat);
            }
          }}
          className="w-full flex items-center justify-center gap-2 py-3 bg-red-900/15 text-red-400 border border-red-900/30 rounded-xl hover:bg-red-900/30 transition-colors text-sm font-bold"
        >
          <Trash2 size={16} />
          Clear Chat History
        </button>
      </div>
    </div>
  );
};

/**
 * Scenario Info View
 * 
 * Displays details about the current scenario:
 * - Cover image
 * - Backstory
 * - Scenario-specific instructions (if any)
 * - Tags
 */
const ScenarioInfoView: React.FC<{ scenario: Scenario }> = ({ scenario }) => {
  return (
    <div className="space-y-6">
      {/* Image - constrained height to avoid massive images */}
      <div className="rounded-xl overflow-hidden border border-zinc-800 max-h-56">
        <img src={scenario.image || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect fill='%23d1d5db' width='800' height='450'/%3E%3C/svg%3E"} alt={scenario.name} className="w-full h-56 object-cover" />
      </div>

      {/* Backstory */}
      <div>
        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          Backstory
        </h4>
        <div className="bg-zinc-800/30 backdrop-blur-sm rounded-xl p-4 max-h-[220px] overflow-y-auto border border-zinc-700/50">
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{scenario.backstory}</p>
        </div>
      </div>

      {/* Scenario Instructions */}
      {scenario.customInstructions && (
        <div>
          <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Scenario Instructions
          </h4>
          <div className="bg-zinc-800/30 backdrop-blur-sm rounded-xl p-4 border border-zinc-700/50">
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{scenario.customInstructions}</p>
          </div>
        </div>
      )}

      {/* Tags */}
      <div>
        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Tags</h4>
        <div className="flex flex-wrap gap-2">
          {scenario.tags.map(tag => (
            <span key={tag} className="text-[10px] font-bold uppercase tracking-wider bg-zinc-800/50 text-zinc-400 px-3 py-1 rounded-full border border-zinc-700/50">
              {tag}
            </span>
          ))}
          {scenario.tags.length === 0 && (
            <span className="text-xs text-zinc-600 italic">No tags</span>
          )}
        </div>
      </div>
    </div>
  );
};
