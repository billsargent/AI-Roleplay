/**
 * ─── Lore Suggestions Modal ───
 *
 * Asks the AI to propose lore cards from the scenario draft (saved or not),
 * then lets the author tick, adjust and add the ones they want. Nothing is
 * added without the author's choice.
 *
 * @module LoreSuggestModal
 */

import React, { useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, X, Check } from 'lucide-react';
import { deepseek, LoreSuggestDraft, LoreSuggestion } from '../services/deepseek';
import { useDialog } from '../utils/useDialog';

interface LoreSuggestModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Reads the editor's current fields when the author asks for suggestions */
  getDraft: () => LoreSuggestDraft;
  /** Receives the cards the author chose */
  onAdd: (cards: LoreSuggestion[]) => void;
}

/** A suggestion as edited in the list */
interface Row extends LoreSuggestion {
  key: number;
  selected: boolean;
  /** Triggers as typed (comma-separated) */
  triggerText: string;
}

const field = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500';

export const LoreSuggestModal: React.FC<LoreSuggestModalProps> = ({ isOpen, onClose, getDraft, onAdd }) => {
  const [focus, setFocus] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (loading) return; // wait for the request
    setRows([]);
    setError('');
    onClose();
  };
  const dialogRef = useDialog(isOpen, close);

  const suggest = async () => {
    setLoading(true);
    setError('');
    try {
      const cards = await deepseek.suggestLore(getDraft(), focus.trim());
      setRows(cards.map((c, i) => ({ ...c, key: Date.now() + i, selected: true, triggerText: c.triggers.join(', ') })));
    } catch (err: any) {
      setError(err.message || 'Could not get lore suggestions');
    } finally {
      setLoading(false);
    }
  };

  const update = (key: number, changes: Partial<Row>) => setRows(prev => prev.map(r => (r.key === key ? { ...r, ...changes } : r)));

  const chosen = rows.filter(r => r.selected && r.title.trim() && r.content.trim());
  const add = () => {
    onAdd(chosen.map(r => ({
      title: r.title.trim(),
      type: r.type,
      content: r.content.trim(),
      triggers: r.triggerText.split(',').map(t => t.trim()).filter(Boolean),
      mode: r.mode,
    })));
    setRows([]);
    setFocus('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lore-suggest-title"
        className="w-full max-w-3xl max-h-[90dvh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-800">
          <h2 id="lore-suggest-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles size={18} className="text-indigo-400" /> Suggest lore from the story
          </h2>
          <button onClick={close} disabled={loading} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-sm text-zinc-400">
            The AI reads your summary, backstory, introduction, cast and existing lore, and proposes new cards. Nothing is
            added until you choose. Unsaved changes in the editor are included.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className={field}
              placeholder="Optional: what should the cards be about? (e.g. factions, the harbour, magic rules)"
              value={focus}
              onChange={e => setFocus(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !loading) suggest(); }}
              disabled={loading}
              aria-label="What the cards should be about"
            />
            <button
              onClick={suggest}
              disabled={loading}
              className="flex-shrink-0 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-bold text-sm"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? 'Thinking…' : rows.length ? 'Suggest again' : 'Suggest'}
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-600/30 text-sm text-red-300">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          {rows.map(r => (
            <div key={r.key} className={`rounded-xl border p-4 space-y-3 transition-colors ${r.selected ? 'border-indigo-500/40 bg-zinc-950' : 'border-zinc-800 bg-zinc-950/40 opacity-60'}`}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={r.selected}
                  onChange={e => update(r.key, { selected: e.target.checked })}
                  className="accent-indigo-500 w-4 h-4"
                  aria-label={`Add ${r.title || 'this card'}`}
                />
                <input className={`${field} font-bold`} value={r.title} onChange={e => update(r.key, { title: e.target.value })} aria-label="Title" />
              </div>
              <textarea className={`${field} min-h-[80px]`} value={r.content} onChange={e => update(r.key, { content: e.target.value })} aria-label="Content" />
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <input
                  className={field}
                  value={r.triggerText}
                  onChange={e => update(r.key, { triggerText: e.target.value })}
                  placeholder="Trigger words, comma-separated"
                  aria-label="Trigger words"
                  disabled={r.mode === 'always'}
                />
                <select
                  className={field}
                  value={r.mode}
                  onChange={e => update(r.key, { mode: e.target.value as Row['mode'] })}
                  aria-label="Sent to the AI"
                >
                  <option value="triggered">When a trigger word comes up</option>
                  <option value="always">Always</option>
                </select>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {rows.length > 0 && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-zinc-800">
            <span className="mr-auto text-xs text-zinc-500">{chosen.length} of {rows.length} selected</span>
            <button onClick={close} className="px-4 py-2 rounded-lg text-sm font-bold text-zinc-400 hover:text-white hover:bg-zinc-800">Cancel</button>
            <button
              onClick={add}
              disabled={chosen.length === 0}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold text-sm"
            >
              <Check size={16} /> Add {chosen.length} card{chosen.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
