/**
 * ─── Fictionlab Re-import (Admin) ───
 *
 * Re-imports many Fictionlab export files into the scenarios they came
 * from, in place (chats stay attached). Step 1 is a dry run: each file is
 * matched to a scenario and the changes are summarised. Step 2 applies the
 * ticked rows in small batches, after a database backup.
 *
 * @module FictionlabReimport
 */
import React, { useRef, useState } from 'react';
import { FileJson, Loader2, Check, AlertTriangle, Upload } from 'lucide-react';
import { apiService, ReimportRow } from '../services/api';
import { useNotifications } from '../utils/notifications';

/** A dry-run row with the parsed file and the admin's choices */
interface Row extends ReimportRow {
  file: unknown;
  scenarioId: string;
  selected: boolean;
  result?: { ok: boolean; error?: string };
}

const BATCH = 5;

export const FictionlabReimport: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<'' | 'reading' | 'matching' | 'applying'>('');
  const [progress, setProgress] = useState('');
  const [backup, setBackup] = useState('');

  const pickFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy('reading');
    setBackup('');
    const files: Array<{ name: string; file: unknown }> = [];
    let unreadable = 0;
    for (const f of Array.from(list)) {
      try {
        files.push({ name: f.name, file: JSON.parse(await f.text()) });
      } catch {
        unreadable++;
      }
    }
    setBusy('matching');
    try {
      const { rows: matched } = await apiService.matchFictionlabFiles(files);
      setRows(matched.map((r, i) => ({
        ...r,
        file: files[i].file,
        scenarioId: r.candidates?.length === 1 ? r.candidates[0].id : '',
        selected: (r.status === 'source' || r.status === 'name') && !!r.summary && !r.summary.hollow,
      })));
      if (unreadable) showToast(`${unreadable} file(s) were not valid JSON and were skipped`, 'info');
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Could not check the files', 'error');
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const update = (i: number, changes: Partial<Row>) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...changes } : r)));
  const chosen = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.selected && r.scenarioId && !r.result?.ok);

  const apply = async () => {
    if (chosen.length === 0) return;
    if (!(await showConfirm(`Re-import ${chosen.length} scenario(s) from their files? The database is backed up first. Names, settings, pictures and chats are kept; the rest of each scenario is replaced by the file.`))) return;
    setBusy('applying');
    let done = 0;
    let first = true;
    try {
      for (let start = 0; start < chosen.length; start += BATCH) {
        const batch = chosen.slice(start, start + BATCH);
        setProgress(`${done} of ${chosen.length}…`);
        const res = await apiService.applyFictionlabFiles(batch.map(({ r }) => ({ scenarioId: r.scenarioId, file: r.file })), first);
        if (first && res.backup) setBackup(res.backup);
        first = false;
        res.results.forEach((result, k) => update(batch[k].i, { result: { ok: result.ok, error: result.error }, selected: !result.ok }));
        done += batch.length;
      }
      showToast(`Re-import finished: ${done} scenario(s) processed`, 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'The re-import stopped part-way; finished rows are marked', 'error');
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const statusLabel: Record<ReimportRow['status'], string> = {
    source: 'Same Fictionlab id', name: 'Same name', ambiguous: 'Several matches: choose', none: 'No matching scenario', 'not a scenario': 'Not a scenario file',
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400 leading-relaxed">
        Update scenarios from their original Fictionlab export files. Each file is matched to a scenario by its Fictionlab
        id, or by name. Lore, cast, backstory, greeting, instructions and introduction come from the file; the scenario's
        name, settings, pictures and chats are kept.
      </p>
      <input ref={inputRef} type="file" accept=".json,application/json" multiple className="hidden" onChange={e => pickFiles(e.target.files)} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={!!busy}
        className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm"
      >
        {busy === 'reading' || busy === 'matching' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {busy === 'reading' ? 'Reading files…' : busy === 'matching' ? 'Matching…' : 'Choose export files (dry run)'}
      </button>

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl ring-1 ring-white/5">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-500 uppercase tracking-wider">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2 text-left">File</th>
                  <th className="p-2 text-left">Scenario</th>
                  <th className="p-2 text-left">Lore never sent</th>
                  <th className="p-2 text-left">Working links</th>
                  <th className="p-2 text-left">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map((r, i) => (
                  <tr key={i} className={r.selected ? 'bg-indigo-950/20' : ''}>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Re-import ${r.fileName}`}
                        checked={r.selected}
                        disabled={!r.scenarioId || !!busy || !!r.result?.ok || !!r.summary?.hollow}
                        onChange={e => update(i, { selected: e.target.checked })}
                        className="accent-indigo-500"
                      />
                    </td>
                    <td className="p-2 text-zinc-300">
                      <span className="flex items-center gap-1.5"><FileJson size={12} className="text-zinc-500" /> {r.title || r.fileName}</span>
                    </td>
                    <td className="p-2">
                      {r.status === 'ambiguous' && r.candidates?.length ? (
                        <select
                          value={r.scenarioId}
                          onChange={e => update(i, { scenarioId: e.target.value, selected: !!e.target.value })}
                          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-300"
                        >
                          <option value="">Choose…</option>
                          {r.candidates.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id.slice(0, 8)})</option>)}
                        </select>
                      ) : r.candidates?.length ? (
                        <span className="text-zinc-300">{r.candidates[0].name}</span>
                      ) : null}
                      <span className={`block text-[10px] ${r.status === 'none' || r.status === 'not a scenario' ? 'text-amber-400' : 'text-zinc-500'}`}>{statusLabel[r.status]}</span>
                      {r.summary?.keepsLore && <span className="block text-[10px] text-zinc-400">No lore in the file: the scenario keeps its own lore</span>}
                      {r.summary?.hollow && <span className="block text-[10px] text-red-400">File has no lore text (hidden by its creator): would erase the lore, so it is skipped</span>}
                    </td>
                    <td className="p-2 text-zinc-400 tabular-nums">{r.summary ? `${r.summary.lore.neverSentBefore} → ${r.summary.lore.neverSentAfter}` : '—'}</td>
                    <td className="p-2 text-zinc-400 tabular-nums">{r.summary ? `${r.summary.lore.workingLinksBefore} → ${r.summary.lore.workingLinksAfter}` : '—'}</td>
                    <td className="p-2">
                      {r.result?.ok && <span className="flex items-center gap-1 text-emerald-400"><Check size={12} /> Updated</span>}
                      {r.result && !r.result.ok && <span className="flex items-center gap-1 text-red-400"><AlertTriangle size={12} /> {r.result.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={apply}
              disabled={!!busy || chosen.length === 0}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm"
            >
              {busy === 'applying' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {busy === 'applying' ? `Re-importing ${progress}` : `Re-import ${chosen.length} selected`}
            </button>
            {backup && <span className="text-xs text-zinc-500">Backup written: {backup}</span>}
          </div>
        </>
      )}
    </div>
  );
};
