/**
 * ─── Memory Panel ───
 *
 * The chat's memories as "the story so far": pinned key facts first, then
 * every memory as a chapter in story order, with the messages it covers.
 * Players can make a memory now, write their own, edit, pin (up to the
 * site's cap), delete, and jump to the part of the chat a memory covers.
 *
 * @module MemoryPanel
 */
import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Pin, Trash2, Edit2, Check, X, ArrowDownRight, Sparkles, Loader2, PenLine } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Memory, Message } from '../types';
import { chapters, messagesSinceLastMemory, Chapter } from '../utils/memories';
import { useNotifications } from '../utils/notifications';

interface MemoryPanelProps {
  memories: Memory[];
  messages: Message[];
  /** Most memories that can be pinned */
  pinnedMax: number;
  /** User messages between automatic memories */
  interval: number;
  readOnly?: boolean;
  /** Saves the new list; resolves false if the server refused it */
  onSave: (memories: Memory[]) => Promise<boolean>;
  /** Asks the AI for a memory now; resolves when done */
  onGenerate: () => Promise<void>;
  /** Scrolls the chat to a message and closes the panel */
  onJump: (messageId: string) => void;
}

const SOURCE_LABEL: Record<string, string> = { auto: 'Automatic', manual: 'Requested', user: 'Written by you' };

export const MemoryPanel: React.FC<MemoryPanelProps> = ({ memories, messages, pinnedMax, interval, readOnly, onSave, onGenerate, onJump }) => {
  const { showConfirm } = useNotifications();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [generating, setGenerating] = useState(false);

  const list = useMemo(() => chapters(memories, messages), [memories, messages]);
  const pinnedCount = memories.filter(m => m.pinned).length;
  const since = messagesSinceLastMemory(memories, messages);
  const keyFacts = list.filter(c => c.memory.pinned);
  const story = list.filter(c => !c.memory.pinned);

  const update = (id: string, changes: Partial<Memory>) => onSave(memories.map(m => (m.id === id ? { ...m, ...changes } : m)));

  const saveEdit = async (id: string) => {
    const text = draft.trim();
    if (!text) return;
    if (await update(id, { content: text, editedAt: Date.now() })) setEditingId(null);
  };

  const addOwn = async () => {
    const text = newMemory.trim();
    if (!text) return;
    const now = Date.now();
    const ok = await onSave([...memories, { id: uuidv4(), content: text, pinned: false, timestamp: now, source: 'user' }]);
    if (ok) setNewMemory('');
  };

  const generate = async () => {
    setGenerating(true);
    try { await onGenerate(); } finally { setGenerating(false); }
  };

  const card = (c: Chapter) => {
    const m = c.memory;
    const editing = editingId === m.id;
    const pinBlocked = !m.pinned && pinnedCount >= pinnedMax;
    return (
      <article key={m.id} className={`rounded-xl p-4 ring-1 transition-colors ${m.pinned ? 'bg-indigo-950/30 ring-indigo-500/30' : 'bg-zinc-900/60 ring-white/5'}`}>
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2 text-[11px] text-zinc-500">
          <span className="font-bold text-zinc-300">Chapter {c.number}</span>
          <span>·</span>
          <span>{c.from ? (c.from === c.to ? `message ${c.from}` : `messages ${c.from}–${c.to}`) : m.source === 'user' ? 'your note' : 'earlier messages'}</span>
          <span>·</span>
          <span>{format(m.timestamp, 'd MMM, HH:mm')}</span>
          {m.source && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{SOURCE_LABEL[m.source]}</span>}
          {m.editedAt && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Edited by you</span>}
        </header>

        {editing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full min-h-[100px] bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              aria-label="Memory text"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800"><X size={14} /> Cancel</button>
              <button onClick={() => saveEdit(m.id)} disabled={!draft.trim()} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"><Check size={14} /> Save</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{m.content}</p>
        )}

        {!editing && (
          <footer className="flex flex-wrap items-center gap-1 mt-3 text-zinc-500">
            {!readOnly && (
              <>
                <button
                  onClick={() => update(m.id, { pinned: !m.pinned })}
                  disabled={pinBlocked}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors disabled:opacity-40 ${m.pinned ? 'text-indigo-300 hover:bg-indigo-900/40' : 'hover:text-white hover:bg-zinc-800'}`}
                  title={pinBlocked ? `You can pin up to ${pinnedMax} memories. Unpin one first.` : m.pinned ? 'Unpin' : 'Pin: always kept and always sent to the AI'}
                >
                  <Pin size={13} fill={m.pinned ? 'currentColor' : 'none'} /> {m.pinned ? 'Pinned' : 'Pin'}
                </button>
                <button onClick={() => { setEditingId(m.id); setDraft(m.content); }} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold hover:text-white hover:bg-zinc-800">
                  <Edit2 size={13} /> Edit
                </button>
                <button
                  onClick={async () => { if (await showConfirm('Delete this memory? The AI will no longer be reminded of it.')) await onSave(memories.filter(x => x.id !== m.id)); }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold hover:text-red-400 hover:bg-red-900/30"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </>
            )}
            {c.firstMessageId && (
              <button onClick={() => onJump(c.firstMessageId!)} className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold hover:text-white hover:bg-zinc-800">
                <ArrowDownRight size={13} /> Jump to
              </button>
            )}
          </footer>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-6">
      {/* Progress toward the next automatic memory */}
      <section className="rounded-xl bg-zinc-900/60 ring-1 ring-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-white">The story so far</h3>
            <p className="text-xs text-zinc-500">
              The AI is reminded of every memory below with each reply. A new one is written every {interval} of your
              messages{since < interval ? ` (next in ${interval - since})` : ' (one is due)'}.
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={generate}
              disabled={generating}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-600/25 disabled:opacity-50"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Make one now
            </button>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={interval} aria-valuenow={Math.min(since, interval)} aria-label="Progress toward the next memory">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, (since / Math.max(1, interval)) * 100)}%` }} />
        </div>
      </section>

      {/* Key facts */}
      <section className="space-y-3">
        <h3 className="flex items-center justify-between text-xs uppercase font-black tracking-wider text-zinc-500">
          <span className="flex items-center gap-1.5"><Pin size={12} /> Key facts</span>
          <span className={pinnedCount >= pinnedMax ? 'text-amber-400' : ''}>Pinned {pinnedCount} / {pinnedMax}</span>
        </h3>
        {keyFacts.length === 0 ? (
          <p className="text-xs text-zinc-600">Pin the memories that matter most. Pinned memories are never trimmed and always reach the AI.</p>
        ) : keyFacts.map(card)}
      </section>

      {/* Chapters */}
      <section className="space-y-3">
        <h3 className="text-xs uppercase font-black tracking-wider text-zinc-500">Chapters ({story.length})</h3>
        {story.length === 0 && keyFacts.length === 0 && (
          <p className="text-sm text-zinc-600 italic text-center py-6">No memories yet. They appear as the story goes on.</p>
        )}
        {story.map(card)}
      </section>

      {/* Write your own */}
      {!readOnly && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs uppercase font-black tracking-wider text-zinc-500"><PenLine size={12} /> Write your own</h3>
          <textarea
            value={newMemory}
            onChange={e => setNewMemory(e.target.value)}
            placeholder="Something the AI should keep in mind, e.g. 'Mara owes Rin a favour.'"
            className="w-full min-h-[80px] bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            aria-label="New memory"
          />
          <div className="flex justify-end">
            <button onClick={addOwn} disabled={!newMemory.trim()} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white">Add memory</button>
          </div>
        </section>
      )}
    </div>
  );
};
