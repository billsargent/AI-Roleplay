/**
 * ─── Check & Fix Lore ───
 *
 * Lore health for the scenario open in the editor:
 * 1. Automatic fixes (broken links, Fictionlab priorities, empty cards,
 *    rule cards into the instructions, {{char}}, trigger words)
 * 2. Things that need a decision (cast duplicates, very long cards,
 *    too many always-on cards)
 * 3. AI suggestions for cards that are never sent to the AI (trigger words,
 *    mode, links and a one-line description), reviewed per card
 * Changes go into the editor; the author saves as usual.
 *
 * @module LoreFixModal
 */
import React, { useEffect, useRef, useState } from 'react';
import { Stethoscope, Loader2, X, Check, Sparkles, Trash2, Minimize2, AlertTriangle } from 'lucide-react';
import { deepseek, LoreCheckResult, LoreFix, LoreFixDraft } from '../services/deepseek';
import { Scenario, LorePiece } from '../types';
import { useDialog } from '../utils/useDialog';
import { useNotifications } from '../utils/notifications';

interface LoreFixModalProps {
  isOpen: boolean;
  onClose: () => void;
  scenario: Scenario;
  /** Puts changed lore and/or instructions into the editor */
  onChange: (changes: { lorePieces?: LorePiece[]; customInstructions?: string }) => void;
  /** Ask the AI about never-sent cards as soon as the check finishes (after an import) */
  autoAsk?: boolean;
}

/** A suggestion as edited in the list */
interface Row extends LoreFix {
  selected: boolean;
  triggerText: string;
}

const BATCH = 15;
const field = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500';

/** The fields the server needs (no images) */
export const loreFixDraft = (s: Scenario): LoreFixDraft => ({
  name: s.name,
  backstory: s.backstory,
  customInstructions: s.customInstructions || '',
  characters: s.characters.map(c => ({ name: c.name })),
  lorePieces: s.lorePieces.map(p => ({
    id: p.id, type: p.type, title: p.title, content: p.content, description: p.description, weight: p.weight,
    pinned: p.pinned, smartActivation: p.smartActivation, hidden: p.hidden, triggers: p.triggers || [], linkedPieces: p.linkedPieces || [],
  })),
});

export const LoreFixModal: React.FC<LoreFixModalProps> = ({ isOpen, onClose, scenario, onChange, autoAsk = false }) => {
  const { showToast, showConfirm } = useNotifications();
  const [check, setCheck] = useState<LoreCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [asking, setAsking] = useState('');
  const [condensing, setCondensing] = useState<string | null>(null);
  const busy = checking || !!asking || !!condensing;

  const close = () => { if (!busy) { setRows([]); onClose(); } };
  const dialogRef = useDialog(isOpen, close);

  const runCheck = async (s: Scenario = scenario) => {
    setChecking(true);
    try {
      setCheck(await deepseek.checkLore(loreFixDraft(s)));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  // Check when opened, and again after the editor's lore changes
  useEffect(() => { if (isOpen) void runCheck(); }, [isOpen, scenario.lorePieces, scenario.customInstructions]);

  const issues = check?.issues || [];
  const byKind = (k: string) => issues.filter(i => i.kind === k);
  const titleOf = (id: string) => scenario.lorePieces.find(p => p.id === id)?.title || 'Untitled';
  const neverSent = byKind('neverSent');

  const askAi = async () => {
    const ids = neverSent.map(i => i.pieceId!).filter(Boolean);
    const draft = loreFixDraft(scenario);
    const found: Row[] = [];
    try {
      for (let start = 0; start < ids.length; start += BATCH) {
        setAsking(`${Math.min(start + BATCH, ids.length)} of ${ids.length}`);
        const fixes = await deepseek.loreFix(draft, ids.slice(start, start + BATCH));
        found.push(...fixes.map(f => ({ ...f, selected: true, triggerText: f.triggers.join(', ') })));
        setRows([...found]);
      }
      if (found.length < ids.length) showToast(`The AI had suggestions for ${found.length} of ${ids.length} cards`, 'info');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setAsking('');
    }
  };

  // After an import: ask once, as soon as the first check is in
  const autoAsked = useRef(false);
  useEffect(() => { if (!isOpen) { autoAsked.current = false; setCheck(null); } }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !autoAsk || !check || autoAsked.current) return;
    autoAsked.current = true;
    if (neverSent.length > 0 && rows.length === 0) void askAi();
  }, [isOpen, autoAsk, check]);

  if (!isOpen) return null;

  /** Applies the automatic fixes, keeping each card's picture and other editor-only fields */
  const applySafe = () => {
    if (!check) return;
    const fixed = new Map(check.fixed.lorePieces.map(p => [p.id, p]));
    const lorePieces = scenario.lorePieces
      .filter(p => fixed.has(p.id))
      .map(p => ({ ...p, ...fixed.get(p.id)! }));
    onChange({ lorePieces, customInstructions: check.fixed.customInstructions });
    showToast(`Applied: ${check.fixed.changes.join('; ')}. Save to keep them.`, 'success');
  };

  const removeCard = (id: string) => onChange({
    lorePieces: scenario.lorePieces.filter(p => p.id !== id).map(p => ({ ...p, linkedPieces: (p.linkedPieces || []).filter(x => x !== id) })),
  });

  const condense = async (id: string) => {
    const piece = scenario.lorePieces.find(p => p.id === id);
    if (!piece) return;
    setCondensing(id);
    try {
      const shorter = await deepseek.enhanceText('loreContent', piece.content, { name: scenario.name, description: scenario.description }, 'condense');
      if (await showConfirm(`Condense "${piece.title}" from ${piece.content.length.toLocaleString()} to ${shorter.length.toLocaleString()} characters?\n\n${shorter.slice(0, 1200)}${shorter.length > 1200 ? '…' : ''}`)) {
        onChange({ lorePieces: scenario.lorePieces.map(p => (p.id === id ? { ...p, content: shorter } : p)) });
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setCondensing(null);
    }
  };

  const update =(id: string, changes: Partial<Row>) => setRows(prev => prev.map(r => (r.id === id ? { ...r, ...changes } : r)));
  const chosen = rows.filter(r => r.selected);
  const applyAi = () => {
    const byId = new Map(chosen.map(r => [r.id, r]));
    onChange({
      lorePieces: scenario.lorePieces.map(p => {
        const r = byId.get(p.id);
        if (!r) return p;
        const triggers = r.triggerText.split(',').map(t => t.trim()).filter(Boolean);
        return {
          ...p,
          pinned: r.mode === 'always',
          smartActivation: r.mode !== 'always',
          triggers: r.mode === 'always' ? p.triggers : triggers,
          linkedPieces: [...new Set([...(p.linkedPieces || []), ...r.linkedPieces])],
          description: p.description?.trim() ? p.description : r.description,
        };
      }),
    });
    setRows([]);
    showToast(`Updated ${chosen.length} card(s). Save to keep them.`, 'success');
  };

  const decisions = [...byKind('castDuplicate'), ...byKind('tooLong')];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="lore-fix-title" className="w-full max-w-3xl max-h-[90dvh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-800">
          <h2 id="lore-fix-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Stethoscope size={18} className="text-indigo-400" /> Check &amp; fix lore
          </h2>
          <button onClick={close} disabled={busy} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {checking && !check && <p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 size={16} className="animate-spin" /> Checking…</p>}
          {check && issues.length === 0 && <p className="text-sm text-emerald-300">No problems found. Every card can reach the AI.</p>}

          {/* 1. Automatic fixes */}
          {check && check.fixed.changes.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs uppercase font-black tracking-wider text-zinc-500">Automatic fixes</h3>
              <ul className="text-sm text-zinc-300 list-disc pl-5 space-y-1">
                {check.fixed.changes.map(c => <li key={c}>{c}</li>)}
              </ul>
              <button onClick={applySafe} disabled={busy} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-bold text-xs">
                <Check size={14} /> Apply these fixes
              </button>
            </section>
          )}

          {/* 2. Needs a decision */}
          {(decisions.length > 0 || byKind('overAlwaysCap').length > 0) && (
            <section className="space-y-2">
              <h3 className="text-xs uppercase font-black tracking-wider text-zinc-500">Needs a decision</h3>
              {byKind('overAlwaysCap').map(i => <p key="cap" className="flex items-start gap-2 text-xs text-amber-300"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> {i.message}</p>)}
              {decisions.map(i => (
                <div key={`${i.kind}-${i.pieceId}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-200 truncate">{i.title || titleOf(i.pieceId || '')}</p>
                    <p className="text-xs text-zinc-500">{i.message}</p>
                  </div>
                  {i.kind === 'castDuplicate' && (
                    <button onClick={() => removeCard(i.pieceId!)} disabled={busy} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-bold text-zinc-400 hover:text-red-300 hover:bg-red-900/30 disabled:opacity-40"><Trash2 size={12} /> Remove card</button>
                  )}
                  {i.kind === 'tooLong' && (
                    <button onClick={() => condense(i.pieceId!)} disabled={busy} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-bold text-indigo-300 hover:bg-indigo-900/30 disabled:opacity-40">
                      {condensing === i.pieceId ? <Loader2 size={12} className="animate-spin" /> : <Minimize2 size={12} />} Condense with AI
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* 3. Never sent: AI suggestions */}
          {neverSent.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs uppercase font-black tracking-wider text-zinc-500">Never sent to the AI ({neverSent.length})</h3>
              <p className="text-xs text-zinc-500">
                These cards have no trigger words (Fictionlab picked relevant lore on its own). The AI can suggest trigger words,
                links and a one-line summary for each; you review them before anything changes.
              </p>
              {rows.length === 0 && (
                <>
                  <p className="text-xs text-zinc-400">{neverSent.map(i => i.title || 'Untitled').join(', ')}</p>
                  <button onClick={askAi} disabled={busy} className="flex items-center gap-2 bg-indigo-600/15 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-600/25 disabled:opacity-50 px-3 py-1.5 rounded-lg font-bold text-xs">
                    {asking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {asking ? `Asking the AI… ${asking}` : 'Ask the AI for suggestions'}
                  </button>
                </>
              )}
              {rows.map(r => (
                <div key={r.id} className={`rounded-xl border p-3 space-y-2 ${r.selected ? 'border-indigo-500/40 bg-zinc-950' : 'border-zinc-800 bg-zinc-950/40 opacity-60'}`}>
                  <label className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <input type="checkbox" checked={r.selected} onChange={e => update(r.id, { selected: e.target.checked })} className="accent-indigo-500" />
                    {titleOf(r.id)}
                  </label>
                  {r.description && <p className="text-xs text-zinc-400 italic">{r.description}</p>}
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                    <input className={field} value={r.triggerText} onChange={e => update(r.id, { triggerText: e.target.value })} disabled={r.mode === 'always'} aria-label="Trigger words" placeholder="Trigger words, comma-separated" />
                    <select className={field} value={r.mode} onChange={e => update(r.id, { mode: e.target.value as Row['mode'] })} aria-label="Sent to the AI">
                      <option value="triggered">When a trigger word comes up</option>
                      <option value="always">Always</option>
                    </select>
                  </div>
                  {r.linkedPieces.length > 0 && <p className="text-[11px] text-zinc-500">Also link: {r.linkedPieces.map(titleOf).join(', ')}</p>}
                </div>
              ))}
              {rows.length > 0 && (
                <button onClick={applyAi} disabled={busy || chosen.length === 0} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-bold text-xs">
                  <Check size={14} /> Apply {chosen.length} suggestion{chosen.length === 1 ? '' : 's'}
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
