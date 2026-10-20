/**
 * ─── Traits ───
 *
 * Short descriptive tags on characters and lore (imported from Fictionlab,
 * or added in the editor): chips to show them, and an input to edit them.
 *
 * @module Traits
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';

/** Read-only trait chips; renders nothing for an empty list */
export const TraitChips: React.FC<{ traits?: string[]; className?: string }> = ({ traits, className = '' }) => {
  if (!traits?.length) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {traits.map(t => (
        <span key={t} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/20">{t}</span>
      ))}
    </div>
  );
};

/** Editable traits: chips with remove buttons, Enter or comma adds, leaving the box adds what was typed */
export const TraitsInput: React.FC<{ traits?: string[]; onChange: (traits: string[]) => void; label?: string }> = ({ traits = [], onChange, label = 'Traits' }) => {
  const [text, setText] = useState('');
  const commit = () => {
    const words = text.split(',').map(w => w.trim()).filter(Boolean);
    if (words.length) {
      const seen = new Set(traits.map(t => t.toLowerCase()));
      onChange([...traits, ...words.filter(w => !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()))].slice(0, 20));
    }
    setText('');
  };
  return (
    <div>
      <label className="text-[10px] font-black text-zinc-500 uppercase mb-1 block">{label}</label>
      <div className="flex flex-wrap items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 focus-within:ring-1 focus-within:ring-indigo-500">
        {traits.map(t => (
          <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/20">
            {t}
            <button type="button" onClick={() => onChange(traits.filter(x => x !== t))} aria-label={`Remove trait ${t}`}><X size={10} /></button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[8rem] bg-transparent text-xs text-zinc-300 outline-none py-0.5"
          placeholder={traits.length ? 'Add…' : 'e.g. Shy, Loyal (press Enter)'}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
          onBlur={commit}
          aria-label={label}
        />
      </div>
    </div>
  );
};
