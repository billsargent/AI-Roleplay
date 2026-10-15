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
 * - Regenerate the last AI reply and switch between its versions (‹ ›)
 * - Continue extends the last AI reply (exactly, via prefix completion when available)
 * - A scenario without a greeting starts with a streamed AI-written opening
 * - Message editing, rewinding, and deletion
 * - Read-only mode for admin viewing other users' chats
 * - Customizable dialog/narration/bubble colors from user settings
 * 
 * @module ChatPage
 */

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Send, Settings as SettingsIcon, Brain, Info,
  ChevronLeft, MessageSquare, RefreshCw, Trash2,
  X, Pin, User, Edit2, FileDown, Play, Square, RotateCcw, ArrowDown,
  ChevronRight, RefreshCcw, Undo2
} from 'lucide-react';
import { apiService } from '../services/api';
import { deepseek, ReplyMode, ReplyResult } from '../services/deepseek';
import { Chat, Message, Scenario, Persona } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { useNotifications } from '../utils/notifications';
import { useDialog } from '../utils/useDialog';
import { jsPDF } from 'jspdf';

/**
 * Global LLM settings cached on the window object for memory management.
 * These are loaded from the server on mount and accessed throughout the chat lifecycle.
 */
declare global {
  interface Window {
    __memoryMaxCount: number;           // Maximum number of stored memories before trimming
  }
}


/**
 * Keeps all pinned memories plus the newest unpinned ones, up to maxCount.
 * Returns a new array (never mutates chat state).
 */
function trimMemories(memories: Chat['memories'], maxCount: number): Chat['memories'] {
  if (memories.length <= maxCount) return memories;
  const pinned = memories.filter(m => m.pinned);
  const keep = new Set(
    memories
      .filter(m => !m.pinned)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, Math.max(0, maxCount - pinned.length))
      .map(m => m.id)
  );
  // Preserve the original order
  return memories.filter(m => m.pinned || keep.has(m.id));
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
  /** Error from the last AI request, shown with a Retry button */
  const [lastError, setLastError] = useState<string | null>(null);
  /** Id of the message the AI is writing into (shows the typing dots there) */
  const [writingId, setWritingId] = useState<string | null>(null);
  /** Id of the AI message that stopped at the length limit (offer Continue) */
  const [cutOffId, setCutOffId] = useState<string | null>(null);
  /** What the failed request was doing, so Retry repeats the same thing */
  const failedModeRef = useRef<ReplyMode | null>(null);
  /** Chat whose AI-written opening was already requested */
  const openingStartedRef = useRef<string | null>(null);

  /** Cancels the in-flight AI request (Stop button, switching chats, leaving the page) */
  const abortRef = useRef<AbortController | null>(null);
  /** Latest chat state, for async work that finishes after later edits */
  const chatRef = useRef<Chat | null>(null);
  /** The chat currently on screen; async results for another chat are not applied */
  const activeChatIdRef = useRef<string | undefined>(chatId);

  useEffect(() => { chatRef.current = chat; }, [chat]);

  // Full-screen overlay: Esc closes it, focus stays inside while open
  const overlayRef = useDialog(overlay !== 'none', () => setOverlay('none'));

  /** Sets chat state and the ref together, so async code sees it immediately */
  const commitChat = (next: Chat) => {
    chatRef.current = next;
    setChat(next);
  };

  // ── Scrolling: the message list follows new text only while the reader is at the bottom ──
  /** The scrollable message area */
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  /** The message list inside it; its size changes as replies stream in */
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** True while the reader is at (or near) the bottom of the conversation */
  const atBottomRef = useRef(true);
  /** Shown when new text arrives while the reader has scrolled up */
  const [hasUnseen, setHasUnseen] = useState(false);

  // ── User-facing color preferences ──
  const [dialogColor, setDialogColor] = useState('#4f46e5');
  const [narrationColor, setNarrationColor] = useState('');
  const [chatBubbleColor, setChatBubbleColor] = useState('#4f46e5');

  // Load chat data on mount or when chatId changes. A slower response for a
  // previous chat is ignored, and a running AI request is stopped on leave.
  useEffect(() => {
    activeChatIdRef.current = chatId;
    if (!chatId) return;
    let cancelled = false;
    loadChat(chatId, () => cancelled);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [chatId]);

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
      // Load global LLM settings (memory limits)
      try {
        const llmSettings = await apiService.getLlmSettings();
        window.__memoryMaxCount = llmSettings.memoryMaxCount ? parseInt(llmSettings.memoryMaxCount) : 50;
      } catch {
        // Use defaults
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
  const loadChat = async (id: string, isCancelled: () => boolean) => {
    // Reset everything that belongs to the previous chat
    setLoading(true);
    setError(null);
    setChat(null);
    chatRef.current = null;
    setScenario(null);
    setIsReadOnly(false);
    setScenarioDeleted(false);
    setLastError(null);
    setCutOffId(null);
    setWritingId(null);
    failedModeRef.current = null;
    setOverlay('none');
    setIsTyping(false);
    try {
      const storedChat = await apiService.getChat(id);
      if (isCancelled()) return;
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
        commitChat(storedChat);
        if (!storedChat.scenarioId) {
          // The scenario was permanently deleted; the chat stays readable
          setScenarioDeleted(true);
          setIsReadOnly(true);
          return;
        }
        try {
          const storedScenario = await apiService.getScenario(storedChat.scenarioId);
          if (isCancelled()) return;
          if (storedScenario) {
            setScenario(storedScenario);
          }
        } catch (err: any) {
          if (isCancelled()) return;
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
      if (isCancelled()) return;
      if (e.response?.status === 403 || e.response?.status === 404) {
        setError('Chat not found or access denied.');
      } else {
        setError('Failed to load chat.');
      }
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  /** Jumps to the newest message and resumes following new text */
  const scrollToBottom = () => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setHasUnseen(false);
  };

  /** Tracks whether the reader is near the bottom (they may scroll up to reread) */
  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottomRef.current) setHasUnseen(false);
  };

  // New or streamed text: follow it if the reader is at the bottom, otherwise
  // leave them where they are and show the "new messages" button
  useLayoutEffect(() => {
    if (atBottomRef.current) {
      const el = messagesContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else if (chat?.messages.length) {
      setHasUnseen(true);
    }
  }, [chat?.messages]);

  // The list or the visible area changes size (images load, the input grows,
  // the window resizes): keep the bottom in view while following
  useEffect(() => {
    const container = messagesContainerRef.current;
    const list = messageListRef.current;
    if (!container || !list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(container);
    observer.observe(list);
    return () => observer.disconnect();
  }, [loading, chat?.id]);

  // Opening a chat starts at the newest message
  useLayoutEffect(() => {
    if (!loading) scrollToBottom();
  }, [loading, chat?.id]);

  // The input grows with its text, up to 40% of the screen, then scrolls inside
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [input]);

  /**
   * Sends a user message, then asks the AI for a reply.
   */
  const sendMessage = async (text: string) => {
    if (!text || !chat || !scenario || isTyping || isReadOnly) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const base = { ...chat, messages: [...chat.messages, userMessage] };
    commitChat(base);
    try {
      // The server builds the AI prompt from the saved chat
      await apiService.saveChat(base);
    } catch {
      setLastError('Could not save your message');
      showToast('Could not save your message to the server', 'error');
      return;
    }
    await generateReply(base);
  };

  /**
   * Gets AI text for a saved chat and puts it in the conversation.
   *
   * - reply / opening: a new AI message is added.
   * - regenerate: the last AI message gets a new version (older versions
   *   stay available through the ‹ › arrows).
   * - continue: the text is added to the end of the last AI message.
   *
   * Streaming or not, depending on the chat setting. Stop (or leaving the
   * page) aborts the request; text that already arrived is kept and saved.
   * On failure the error is shown with a Retry button, and the chat goes
   * back to how it was. The final save merges into the latest chat state, so
   * a memory or edit made while the reply was generating is not overwritten.
   */
  const generateReply = async (base: Chat, mode: ReplyMode = 'reply') => {
    if (!scenario) return;
    const forChat = base.id;
    const isCurrent = () => activeChatIdRef.current === forChat;

    setIsTyping(true);
    setLastError(null);
    setCutOffId(null);
    failedModeRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;

    const replyId = uuidv4();
    const target = base.messages[base.messages.length - 1];
    setWritingId(mode === 'regenerate' || mode === 'continue' ? target.id : replyId);
    let partial = '';
    let continueMode: ReplyResult['continueMode'];

    /** The conversation with `text` applied for this mode */
    const withText = (text: string): Chat => {
      const latest = isCurrent() && chatRef.current ? chatRef.current : base;
      let messages: Message[];
      if (mode === 'regenerate') {
        const versions = target.versions?.length ? target.versions : [target.content];
        messages = base.messages.map(m => m.id === target.id
          ? { ...m, content: text, versions: [...versions, text], currentVersionIndex: versions.length, timestamp: Date.now() }
          : m);
      } else if (mode === 'continue') {
        const joined = joinContinuation(target.content, text, continueMode);
        messages = base.messages.map(m => {
          if (m.id !== target.id) return m;
          const versions = m.versions?.length ? [...m.versions] : undefined;
          if (versions) versions[Math.min(m.currentVersionIndex ?? 0, versions.length - 1)] = joined;
          return { ...m, content: joined, ...(versions ? { versions } : {}) };
        });
      } else {
        messages = [...base.messages, { id: replyId, role: 'assistant', content: text, timestamp: Date.now() }];
      }
      return { ...latest, messages };
    };

    try {
      let result: ReplyResult;
      if (base.settings.streamResponse) {
        if (mode !== 'continue') commitChat(withText(''));
        result = await deepseek.chatStream(base.id, (chunk, cm) => {
          continueMode = cm;
          partial += chunk;
          if (isCurrent()) commitChat(withText(partial));
        }, controller.signal, mode);
      } else {
        result = await deepseek.chat(base.id, controller.signal, mode);
      }
      continueMode = result.continueMode;

      const final = withText(result.content);
      if (isCurrent()) {
        commitChat(final);
        // A reply that hit the length limit can be continued
        if (result.finishReason === 'length') setCutOffId(final.messages[final.messages.length - 1].id);
      }
      await apiService.saveChat(final);
      // Memory generation is a separate AI call; do not make the user wait for it
      void maybeGenerateMemory(final);
    } catch (error: any) {
      const aborted = controller.signal.aborted;
      // Keep whatever text already arrived; otherwise put the chat back as it was
      const kept = partial.trim() ? withText(partial) : { ...(isCurrent() && chatRef.current ? chatRef.current : base), messages: base.messages };
      if (isCurrent()) commitChat(kept);
      if (partial.trim()) {
        apiService.saveChat(kept).catch(() => showToast('Could not save the partial reply', 'error'));
      }
      if (!aborted && isCurrent()) {
        const message = error?.message || 'Error communicating with DeepSeek';
        failedModeRef.current = mode;
        setLastError(message);
        showToast(message, 'error');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (isCurrent()) {
        setIsTyping(false);
        setWritingId(null);
      }
    }
  };

  /** Stops the AI reply that is being generated */
  const stopGenerating = () => {
    abortRef.current?.abort();
  };

  /**
   * Retry after a failure: repeats a failed regenerate, continue or opening;
   * otherwise asks for a new reply to the last user message, replacing any
   * partial reply left by the failed attempt.
   */
  const retryLastReply = async () => {
    const current = chatRef.current;
    if (!current || isTyping || isReadOnly) return;
    const failed = failedModeRef.current;
    if (failed === 'regenerate' || failed === 'continue') {
      await generateReply(current, failed);
      return;
    }
    if (!current.messages.some(m => m.role === 'user' || m.role === 'assistant')) {
      await generateReply(current, 'opening');
      return;
    }
    let end = current.messages.length;
    while (end > 0 && current.messages[end - 1].role !== 'user') end--;
    if (end === 0) return;
    const base = { ...current, messages: current.messages.slice(0, end) };
    commitChat(base);
    try {
      // Drop the failed partial reply on the server too, before asking again
      await apiService.saveChat(base);
    } catch {
      showToast('Could not save the chat; try again', 'error');
      return;
    }
    await generateReply(base);
  };

  /** Asks for another version of the last AI message */
  const regenerateLast = async () => {
    const current = chatRef.current;
    if (!current || isTyping || isReadOnly) return;
    if (current.messages[current.messages.length - 1]?.role !== 'assistant') return;
    await generateReply(current, 'regenerate');
  };

  /** Asks the AI to keep writing the last AI message */
  const continueLast = async () => {
    const current = chatRef.current;
    if (!current || isTyping || isReadOnly) return;
    if (current.messages[current.messages.length - 1]?.role !== 'assistant') return;
    scrollToBottom();
    await generateReply(current, 'continue');
  };

  /** Shows another version of a message (the ‹ › arrows) and saves the choice */
  const showVersion = async (messageId: string, index: number) => {
    const current = chatRef.current;
    if (!current || isTyping || isReadOnly) return;
    const next: Chat = {
      ...current,
      messages: current.messages.map(m => {
        if (m.id !== messageId || !m.versions?.length) return m;
        const i = Math.max(0, Math.min(index, m.versions.length - 1));
        return { ...m, content: m.versions[i], currentVersionIndex: i };
      }),
    };
    commitChat(next);
    setCutOffId(null);
    try {
      await apiService.saveChat(next);
    } catch {
      showToast('Could not save the chosen version', 'error');
    }
  };

  // A chat with no greeting starts with an AI-written opening
  useEffect(() => {
    if (loading || !chat || !scenario || isReadOnly || isTyping) return;
    if (chat.messages.some(m => m.role === 'user' || m.role === 'assistant')) return;
    if (openingStartedRef.current === chat.id) return; // once per chat (and not twice in dev mode)
    openingStartedRef.current = chat.id;
    void generateReply(chat, 'opening');
  }, [loading, chat?.id, scenario, isReadOnly]);

  /**
   * Public send handler — reads from the input state and sends.
   * While the AI is replying, Enter does nothing (the text stays in the box).
   */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping || isReadOnly) return;
    setInput('');
    scrollToBottom(); // Sending always brings the conversation back into view
    await sendMessage(text);
  };

  /**
   * After each reply, lets the server add a memory if one is due (it counts
   * the real user messages since the last memory). Runs in the background,
   * merges into the latest chat state and trims old unpinned memories.
   */
  const maybeGenerateMemory = async (snapshot: Chat) => {
    const memory = await deepseek.generateMemory(snapshot.id, true);
    if (!memory) return;

    const isCurrent = activeChatIdRef.current === snapshot.id;
    const latest = isCurrent && chatRef.current ? chatRef.current : snapshot;
    const next: Chat = {
      ...latest,
      memories: trimMemories([...latest.memories, memory], window.__memoryMaxCount || 50),
    };
    if (isCurrent) commitChat(next);
    try {
      await apiService.saveChat(next);
      if (isCurrent) showToast('Memory updated', 'info');
    } catch {
      showToast('Could not save the new memory', 'error');
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

  const actionButton = 'flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-bold hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors';

  /**
   * Buttons under a message. The last AI message also gets its version
   * arrows and Regenerate, and its row is always visible; on other messages
   * the row shows on hover or focus (always on touch screens).
   */
  const messageActionRow = (m: Message, isLastAi: boolean) => {
    if (isReadOnly || (isTyping && m.id === writingId)) return null;
    const versionCount = m.versions?.length ?? 0;
    const versionIndex = m.currentVersionIndex ?? 0;
    return (
      <div className={`flex flex-wrap items-center gap-0.5 mt-1.5 px-1 text-zinc-500 ${isLastAi ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity'}`}>
        {isLastAi && versionCount > 1 && (
          <>
            <button
              onClick={() => showVersion(m.id, versionIndex - 1)}
              disabled={isTyping || versionIndex <= 0}
              className={actionButton}
              title="Previous version" aria-label="Previous version"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-[11px] tabular-nums min-w-[2.5rem] text-center" aria-live="polite">
              {versionIndex + 1} / {versionCount}
            </span>
            <button
              onClick={() => showVersion(m.id, versionIndex + 1)}
              disabled={isTyping || versionIndex >= versionCount - 1}
              className={actionButton}
              title="Next version" aria-label="Next version"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
        {isLastAi && (
          <button onClick={regenerateLast} disabled={isTyping} className={actionButton} title="Write a different version of this reply">
            <RefreshCcw size={13} /> Regenerate
          </button>
        )}
        <button
          onClick={async () => {
            const newContent = prompt('Edit message:', m.content);
            if (newContent !== null) {
              const newMessages = chat.messages.map(msg => {
                if (msg.id !== m.id) return msg;
                const versions = msg.versions?.length ? [...msg.versions] : undefined;
                if (versions) versions[Math.min(msg.currentVersionIndex ?? 0, versions.length - 1)] = newContent;
                return { ...msg, content: newContent, ...(versions ? { versions } : {}) };
              });
              const updatedChat = { ...chat, messages: newMessages };
              setChat(updatedChat);
              await apiService.saveChat(updatedChat);
            }
          }}
          disabled={isTyping}
          className={actionButton} title="Edit" aria-label="Edit message"
        >
          <Edit2 size={13} /> <span className="hidden sm:inline">Edit</span>
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
          disabled={isTyping}
          className={actionButton} title="Rewind: delete everything after this message" aria-label="Rewind: delete everything after this message"
        >
          <Undo2 size={13} /> <span className="hidden sm:inline">Rewind</span>
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
          disabled={isTyping}
          className={`${actionButton} hover:!text-red-400 hover:!bg-red-900/30`} title="Delete" aria-label="Delete message"
        >
          <Trash2 size={13} /> <span className="hidden sm:inline">Delete</span>
        </button>
      </div>
    );
  };

  /** Opens the side panel on one of its tabs */
  const openPanel = (tab: 'info' | 'matrix' | 'settings') => {
    setOverlayTab(tab);
    setOverlay(tab);
  };

  return (
    // Fills the screen below the navbar (top bar on desktop, bottom bar on phones, both 4rem)
    <div className="flex flex-col h-[calc(100dvh-4rem)] min-h-0 bg-zinc-950 text-zinc-200">

      {/* ── Chat header: back, scenario, panels ── */}
      <header className="flex-shrink-0 border-b border-zinc-800/80 bg-zinc-950/95">
        <div className="mx-auto w-full max-w-3xl px-2 sm:px-4 h-12 flex items-center gap-2">
          <button onClick={() => navigate('/chats')} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Back to Chats" aria-label="Back to Chats">
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate">{scenario?.name || chat.scenarioName || 'Chat'}</p>
            {chat.userCharacter?.name && (
              <p className="text-[11px] text-zinc-500 truncate">as {chat.userCharacter.name}</p>
            )}
          </div>
          {scenario && (
            <button onClick={() => openPanel('info')} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Scenario Info" aria-label="Scenario Info">
              <Info size={18} />
            </button>
          )}
          {scenario && (
            <button onClick={() => openPanel('matrix')} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Memories & Lore" aria-label="Memories and Lore">
              <Brain size={18} />
            </button>
          )}
          <button onClick={() => openPanel('settings')} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Chat Settings" aria-label="Chat Settings">
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

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

      {/* ── Messages: scrolls on its own; the input below never covers it ── */}
      <div className="relative flex-1 min-h-0">
        <div ref={messagesContainerRef} onScroll={handleScroll} className="h-full overflow-y-auto overscroll-contain">
          <div ref={messageListRef} className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-6">

            {/* Empty state */}
            {chat.messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-zinc-500 text-center px-8">
                <MessageSquare size={48} className="mb-4 opacity-20" />
                <p>{isTyping ? 'The story is starting…' : 'No messages yet. Send a message to start the story!'}</p>
              </div>
            )}

            {/* Message list */}
            {chat.messages.map((m, idx) => isSyntheticTurn(m) ? null : m.role === 'system' ? (
              // System messages (e.g., persona change notifications) rendered as pill badges
              <div key={m.id} className="flex justify-center !my-2">
                <div className="px-4 py-1.5 bg-zinc-900/50 border border-zinc-800/50 rounded-full text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className={`group flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Message header: avatar, name, timestamp */}
                <div className={`flex items-center gap-2 mb-1.5 px-1 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <Avatar
                    image={m.role === 'assistant' ? scenario?.image : chat.userCharacter?.avatar}
                    name={m.role === 'assistant' ? (m.characterName || scenario?.name || 'AI') : (chat.userCharacter?.name || 'You')}
                    accent={m.role === 'assistant'}
                  />
                  <span className="text-[11px] uppercase font-bold tracking-widest text-zinc-400">
                    {m.role === 'assistant' ? (m.characterName || scenario?.name || 'AI') : (chat.userCharacter?.name || 'YOU')}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    {format(m.timestamp, 'HH:mm')}
                  </span>
                </div>

                {/* Message bubble with dialog/narration color highlighting */}
                <div
                  className={`rounded-2xl px-4 py-3 sm:px-5 sm:py-4 ${
                    m.role === 'user'
                      ? 'max-w-[85%] text-white rounded-tr-md shadow-sm'
                      : 'w-full bg-zinc-900/60 ring-1 ring-white/5 text-zinc-200 rounded-tl-md'
                  }`}
                  style={m.role === 'user' ? { backgroundColor: chatBubbleColor } : narrationColor ? { color: narrationColor } : {}}
                >
                  {/* Parse *italic* and "dialogue" markers for color styling */}
                  <div className="whitespace-pre-wrap break-words text-[15px] sm:text-base leading-7 message-content">
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
                  {isTyping && m.id === writingId && <TypingDots className={m.content ? 'mt-2' : 'py-1'} />}
                </div>

                {messageActionRow(m, m.role === 'assistant' && idx === chat.messages.length - 1)}
              </div>
            ))}

            {/* Retry button — after a failed AI request */}
            {!isReadOnly && !isTyping && (lastError || chat.messages[chat.messages.length - 1]?.role === 'user') && (
              <div className="flex justify-center">
                <button
                  onClick={retryLastReply}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/50 transition-all text-xs font-bold"
                >
                  <RotateCcw size={12} />
                  Retry
                </button>
              </div>
            )}

            {/* Continue button — appears when last message is from the AI and not read-only/typing */}
            {!isReadOnly && !isTyping && chat.messages.length > 0 && chat.messages[chat.messages.length - 1].role === 'assistant' && (
              <div className="flex justify-center">
                <button
                  onClick={continueLast}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/50 hover:text-indigo-200 transition-all text-xs font-bold"
                >
                  <Play size={12} fill="currentColor" />
                  {cutOffId === chat.messages[chat.messages.length - 1].id ? 'Continue (the reply was cut off)' : 'Continue'}
                </button>
              </div>
            )}

            {/* Typing indicator for a non-streamed new reply (not yet in the list) */}
            {isTyping && !chat.messages.some(m => m.id === writingId) && (
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-2 mb-1 px-1">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center">
                    <RefreshCw size={12} className="animate-spin" />
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">AI is thinking...</span>
                </div>
                <div className="bg-zinc-900/60 ring-1 ring-white/5 rounded-2xl rounded-tl-md px-5 py-4">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* New text arrived while the reader was scrolled up */}
        {hasUnseen && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-bold shadow-lg hover:bg-indigo-500 transition-colors"
          >
            <ArrowDown size={14} />
            New messages
          </button>
        )}
      </div>

      {/* ── Input bar: part of the layout, grows with its text ── */}
      <div className="flex-shrink-0 border-t border-zinc-800/80 bg-zinc-950">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-3">
          <div className="relative">
            <textarea
              ref={textareaRef}
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
              aria-label="Your message"
              className={`block w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3.5 pl-4 pr-14 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none overflow-y-auto ${scenarioDeleted ? 'placeholder:text-red-400/60 text-red-300/50 border-red-800/50' : ''} ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
              rows={1}
            />
            <div className="absolute right-2 bottom-2">
              {isTyping ? (
                <button
                  onClick={stopGenerating}
                  className="p-2 rounded-xl transition-all bg-red-600/80 text-white shadow-lg hover:bg-red-600"
                  title="Stop generating"
                  aria-label="Stop generating"
                >
                  <Square size={18} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isReadOnly}
                  className={`p-2 rounded-xl transition-all ${
                    input.trim() && !isReadOnly ? 'bg-indigo-600 text-white shadow-lg hover:bg-indigo-500' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                  title="Send"
                  aria-label="Send"
                >
                  <Send size={18} />
                </button>
              )}
            </div>
          </div>
          <p className="hidden sm:block mt-1.5 text-[10px] text-zinc-600 text-center">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>

      {/* ── Full-Screen Overlay (Memory Matrix, Settings, Info) ── */}
      {overlay !== 'none' && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={overlayTab === 'matrix' ? 'Memory Matrix' : overlayTab === 'settings' ? 'Chat Settings' : 'Scenario Info'}
          className="fixed inset-0 z-50 bg-zinc-950 flex flex-col"
        >
          {/* Overlay header with tab navigation */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              {overlayTab === 'matrix' && <><Brain size={20} className="text-indigo-400" /> <span className="text-lg font-bold text-white">Memory Matrix</span></>}
              {overlayTab === 'settings' && <><SettingsIcon size={20} className="text-indigo-400" /> <span className="text-lg font-bold text-white">Chat Settings</span></>}
              {overlayTab === 'info' && <><Info size={20} className="text-indigo-400" /> <span className="text-lg font-bold text-white">Scenario Info</span></>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setOverlayTab('info')} className={`p-2 rounded-lg transition-colors ${overlayTab === 'info' ? 'bg-zinc-800 text-indigo-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`} title="Scenario Info">
                <Info size={18} />
              </button>
              <button onClick={() => setOverlayTab('matrix')} className={`p-2 rounded-lg transition-colors ${overlayTab === 'matrix' ? 'bg-zinc-800 text-indigo-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`} title="Memory Matrix">
                <Brain size={18} />
              </button>
              <button onClick={() => setOverlayTab('settings')} className={`p-2 rounded-lg transition-colors ${overlayTab === 'settings' ? 'bg-zinc-800 text-indigo-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`} title="Chat Settings">
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
  const { showConfirm, showToast } = useNotifications();
  const [activeTab, setActiveTab] = useState<'lore' | 'memories'>('lore');
  const [expandedLoreIds, setExpandedLoreIds] = useState<Set<string>>(new Set());

  const toggleLoreExpand = (id: string) => {
    setExpandedLoreIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
            <p className="text-zinc-600 text-sm italic text-center py-8">
              {scenario.promptsHidden ? 'The creator keeps the lore private.' : 'No lore pieces defined for this scenario.'}
            </p>
          )}
          {scenario.lorePieces.map(piece => {
            const isExpanded = expandedLoreIds.has(piece.id);
            return (
              <div key={piece.id} className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700/50 rounded-xl p-4 hover:border-zinc-600/50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full ${piece.type === 'character' ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-700/50 text-zinc-400'}`}>
                    {piece.type}
                  </span>
                  {piece.pinned && <Pin size={14} className="text-indigo-400 fill-indigo-400" />}
                </div>
                <h4 className="font-bold text-white mb-1 text-sm">{piece.title}</h4>
                <p className={`text-xs text-zinc-500 leading-relaxed ${isExpanded ? '' : 'line-clamp-3'}`}>{piece.content}</p>
                {piece.content.length > 200 && (
                  <button
                    onClick={() => toggleLoreExpand(piece.id)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-bold mt-1 transition-colors"
                  >
                    {isExpanded ? 'less' : 'more...'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* AI-generated memories */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs uppercase font-bold text-zinc-600 tracking-wider">Memories ({chat.memories.length})</h4>
            <button
              onClick={async () => {
                const memory = await deepseek.generateMemory(chat.id);
                if (!memory) {
                  showToast('Could not generate a memory', 'error');
                } else if (await showConfirm(`Add this memory?\n\n"${memory.content}"`)) {
                  const newMemories = [...chat.memories, memory];
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
  // Edited locally and saved once when the field loses focus
  const [instructionsDraft, setInstructionsDraft] = React.useState(chat.settings.customInstructions || '');
  React.useEffect(() => {
    setInstructionsDraft(chat.settings.customInstructions || '');
  }, [chat.id]);

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
          value={instructionsDraft}
          onChange={(e) => setInstructionsDraft(e.target.value)}
          onBlur={() => {
            if (instructionsDraft !== (chat.settings.customInstructions || '')) {
              updateSettings('customInstructions', instructionsDraft)
                .then(() => showToast('Instructions saved', 'success'))
                .catch(() => showToast('Could not save instructions', 'error'));
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
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {scenario.promptsHidden ? <span className="text-zinc-500 italic">The creator keeps the backstory private.</span> : scenario.backstory}
          </p>
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

/** Round avatar: an image when there is one, otherwise the first letter of the name */
const Avatar: React.FC<{ image?: string; name: string; accent?: boolean }> = ({ image, name, accent }) => (
  image ? (
    <img src={image} alt="" className="w-7 h-7 rounded-full object-cover ring-1 ring-white/10 flex-shrink-0" />
  ) : (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${accent ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-200'}`}>
      {(name.trim()[0] || '?').toUpperCase()}
    </div>
  )
);

/** Old chats contain "*continue*" user turns the app sent on its own; they are not shown */
const isSyntheticTurn = (m: Message) => m.role === 'user' && m.content.trim() === '*continue*';

/**
 * Joins a continuation to the text it continues. Prefix completion returns
 * exactly what follows; otherwise the model starts a new piece of text, which
 * needs a space unless one side already has whitespace or it starts with
 * punctuation.
 */
function joinContinuation(previous: string, addition: string, mode?: 'prefix' | 'instruct'): string {
  if (mode === 'prefix' || !previous || !addition) return previous + addition;
  if (/\s$/.test(previous) || /^\s/.test(addition) || /^[.,!?;:…)\]'"’”-]/.test(addition)) return previous + addition;
  return previous + ' ' + addition;
}

/** Three bouncing dots: the AI is writing */
const TypingDots: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex gap-1.5 ${className}`} role="status" aria-label="The AI is writing">
    <span className="w-2 h-2 bg-indigo-400/80 rounded-full animate-bounce [animation-delay:-0.3s]" />
    <span className="w-2 h-2 bg-indigo-400/80 rounded-full animate-bounce [animation-delay:-0.15s]" />
    <span className="w-2 h-2 bg-indigo-400/80 rounded-full animate-bounce" />
  </div>
);
