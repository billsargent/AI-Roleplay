/**
 * ─── Lore Health (Admin) ───
 *
 * Checks the lore of every scenario and applies the safe fixes to all of
 * them at once (after a database backup). Problems that need judgement,
 * such as cards that are never sent, are listed with a link to the
 * scenario, where "Check & fix lore" can ask the AI.
 *
 * @module LoreHealth
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, Check } from 'lucide-react';
import { apiService } from '../services/api';
import { useNotifications } from '../utils/notifications';

type Report = Awaited<ReturnType<typeof apiService.getLoreHealth>>;

const LABELS: Record<string, string> = {
  neverSent: 'never sent', brokenLinks: 'broken links', ruleCard: 'rule cards', weightScale: '1-5 priorities',
  castDuplicate: 'cast duplicates', empty: 'empty', tooLong: 'very long', overAlwaysCap: 'too many always-on',
  badTriggers: 'bad trigger words', charPlaceholder: '{{char}}',
};

export const LoreHealth: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<'' | 'checking' | 'applying'>('');

  const check = async () => {
    setBusy('checking');
    try {
      setReport(await apiService.getLoreHealth());
    } catch {
      showToast('Could not check the lore', 'error');
    } finally {
      setBusy('');
    }
  };

  const fixable = report?.rows.filter(r => r.safeChanges.length > 0) || [];
  const apply = async () => {
    if (!(await showConfirm(`Apply the automatic lore fixes to ${fixable.length} scenario(s)? The database is backed up first.`))) return;
    setBusy('applying');
    try {
      const res = await apiService.applyLoreHealth();
      showToast(`Fixed ${res.changed} scenario(s)${res.failed.length ? `, ${res.failed.length} failed` : ''}. Backup: ${res.backup}`, res.failed.length ? 'info' : 'success');
      setReport(await apiService.getLoreHealth());
    } catch {
      showToast('Could not apply the fixes', 'error');
    } finally {
      setBusy('');
    }
  };

  const needsReview = report?.rows.filter(r => r.counts.neverSent || r.counts.castDuplicate || r.counts.tooLong || r.counts.overAlwaysCap) || [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400 leading-relaxed">
        Finds lore that never reaches the AI or was imported badly. Automatic fixes repair broken links, Fictionlab
        priorities, empty cards, rule cards (moved into the instructions), {'{{char}}'} and trigger words. Cards that are never
        sent need trigger words: open the scenario's editor and use Check &amp; Fix to get AI suggestions.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={check} disabled={!!busy} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm">
          {busy === 'checking' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Check all scenarios
        </button>
        {fixable.length > 0 && (
          <button onClick={apply} disabled={!!busy} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm">
            {busy === 'applying' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Apply automatic fixes ({fixable.length})
          </button>
        )}
      </div>

      {report && (
        <>
          <p className="text-xs text-zinc-400">
            {Object.keys(report.totals).length === 0
              ? 'No problems found.'
              : Object.entries(report.totals).map(([k, v]) => `${v} ${LABELS[k] || k}`).join(' · ')}
          </p>
          {needsReview.length > 0 && (
            <div className="rounded-xl ring-1 ring-white/5 divide-y divide-zinc-800 max-h-80 overflow-y-auto">
              {needsReview.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <Link to={`/scenario/${r.id}`} className="font-bold text-zinc-200 hover:text-indigo-300 truncate">{r.name}</Link>
                  <span className="text-zinc-500 flex-shrink-0">
                    {['neverSent', 'castDuplicate', 'tooLong', 'overAlwaysCap'].filter(k => r.counts[k]).map(k => `${r.counts[k]} ${LABELS[k]}`).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
