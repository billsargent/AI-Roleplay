/**
 * ─── AI Enhance Button ───
 *
 * Small button next to an editor field. It asks the AI to fix spelling,
 * grammar and clarity (or, opt-in, to make the wording more vivid), shows
 * what changed word by word, and replaces the text only when the author
 * accepts. After accepting, "Undo" puts the old text back for a minute.
 *
 * @module AIEnhanceButton
 */
import React, { useEffect, useRef, useState } from 'react';
import { Wand2, Loader2, Check, X, RotateCcw, Undo2 } from 'lucide-react';
import { deepseek, EnhanceField } from '../services/deepseek';
import { diffWords } from '../utils/diff';
import { useDialog } from '../utils/useDialog';

interface AIEnhanceButtonProps {
  field: EnhanceField;
  value: string;
  onChange: (value: string) => void;
  /** Scenario name and summary, so the AI keeps names consistent */
  context: { name?: string; description?: string };
  /** Shown in the dialog title, e.g. "Backstory" */
  label: string;
}

type Mode = 'fix' | 'vivid';

export const AIEnhanceButton: React.FC<AIEnhanceButtonProps> = ({ field, value, onChange, context, label }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('fix');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** Text before the last accepted change, while Undo is offered */
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  const close = () => {
    if (loading) return;
    setOpen(false);
    setResult(null);
    setError('');
  };
  const dialogRef = useDialog(open, close);

  // Undo is offered until the text changes again or a minute passes
  useEffect(() => {
    if (undo && value !== undo.after) setUndo(null);
  }, [value, undo]);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const run = async (m: Mode = mode) => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await deepseek.enhanceText(field, value, context, m));
    } catch (err: any) {
      setError(err.message || 'Could not enhance the text');
    } finally {
      setLoading(false);
    }
  };

  const start = () => {
    if (!value.trim()) return;
    setOpen(true);
    void run();
  };

  const accept = () => {
    if (result === null) return;
    setUndo({ before: value, after: result });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 60_000);
    onChange(result);
    setOpen(false);
    setResult(null);
  };

  const parts = result !== null ? diffWords(value, result) : null;
  const unchanged = result !== null && result.trim() === value.trim();

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={start}
          disabled={!value.trim()}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold normal-case tracking-normal text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          title="AI Enhance: fix spelling, grammar and clarity (you see the changes first)"
        >
          <Wand2 size={12} /> Enhance
        </button>
        {undo && (
          <button
            type="button"
            onClick={() => { onChange(undo.before); setUndo(null); }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold normal-case tracking-normal text-zinc-400 hover:text-white hover:bg-zinc-800"
            title="Put back the text from before Enhance"
          >
            <Undo2 size={12} /> Undo
          </button>
        )}
      </span>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm normal-case tracking-normal font-normal text-left">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="enhance-title"
            className="w-full max-w-3xl max-h-[90dvh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-800">
              <h2 id="enhance-title" className="text-lg font-bold text-white flex items-center gap-2">
                <Wand2 size={18} className="text-indigo-400" /> Enhance: {label}
              </h2>
              <button onClick={close} disabled={loading} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How much to change">
                {([['fix', 'Fix spelling & clarity', 'Changes as little as possible'], ['vivid', 'Also make it more vivid', 'Stronger wording, same facts']] as const).map(([m, title, hint]) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={mode === m}
                    disabled={loading}
                    onClick={() => { setMode(m); void run(m); }}
                    className={`px-3 py-2 rounded-lg text-left text-xs transition-colors ${mode === m ? 'bg-indigo-600/20 ring-1 ring-indigo-500/50 text-white' : 'bg-zinc-800/60 text-zinc-400 hover:text-white'}`}
                  >
                    <span className="block font-bold">{title}</span>
                    <span className="block text-[11px] text-zinc-500">{hint}</span>
                  </button>
                ))}
              </div>

              {loading && (
                <div className="flex items-center gap-2 text-sm text-zinc-400 py-8 justify-center">
                  <Loader2 size={18} className="animate-spin" /> Reading your text…
                </div>
              )}
              {error && <p className="p-3 rounded-lg bg-red-900/20 border border-red-600/30 text-sm text-red-300">{error}</p>}

              {result !== null && !loading && (
                unchanged ? (
                  <p className="text-sm text-emerald-300 py-4">Nothing to fix: the AI left your text as it is.</p>
                ) : (
                  <div>
                    <p className="text-xs text-zinc-500 mb-2">
                      <span className="px-1 rounded bg-emerald-500/20 text-emerald-200">Added</span>{' '}
                      <span className="px-1 rounded bg-red-500/20 text-red-300 line-through">removed</span>
                    </p>
                    <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4 text-sm leading-7 whitespace-pre-wrap text-zinc-300">
                      {parts ? parts.map((p, i) => (
                        p.kind === 'same' ? <span key={i}>{p.text}</span>
                          : p.kind === 'added' ? <ins key={i} className="no-underline bg-emerald-500/20 text-emerald-200 rounded">{p.text}</ins>
                            : <del key={i} className="bg-red-500/15 text-red-300/80 rounded">{p.text}</del>
                      )) : result}
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-zinc-800">
              <button onClick={() => run()} disabled={loading} className="mr-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40">
                <RotateCcw size={14} /> Try again
              </button>
              <button onClick={close} disabled={loading} className="px-4 py-2 rounded-lg text-sm font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40">Cancel</button>
              <button
                onClick={accept}
                disabled={loading || result === null || unchanged}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold text-sm"
              >
                <Check size={16} /> Use this
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
