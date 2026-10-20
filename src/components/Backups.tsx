/**
 * ─── Backups (Admin) ───
 *
 * Makes, lists, downloads, uploads and restores full system backups: the
 * database and every picture in one file. Restoring makes a backup of the
 * current state first. Uploading a backup from another server and restoring
 * it is how an installation moves to a new machine.
 *
 * @module Backups
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Download, RotateCcw, Trash2, Upload, AlertTriangle } from 'lucide-react';
import { apiService, BackupInfo, BackupSchedule } from '../services/api';
import { useNotifications } from '../utils/notifications';

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const errorText = (err: any, fallback: string) => err?.response?.data?.error || fallback;

export const Backups: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [folder, setFolder] = useState('');
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await apiService.listBackups();
      setList(res.backups);
      setFolder(res.folder);
      setSchedule(res.schedule);
    } catch (err) {
      showToast(errorText(err, 'Could not list the backups'), 'error');
    }
  };
  useEffect(() => { void load(); }, []);

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try {
      await job();
    } finally {
      setBusy('');
    }
  };

  const changeSchedule = async (changes: Partial<Pick<BackupSchedule, 'enabled' | 'hour' | 'keep'>>) => {
    if (!schedule) return;
    setSchedule({ ...schedule, ...changes });
    try {
      await apiService.saveBackupSchedule(changes);
    } catch (err) {
      showToast(errorText(err, 'Could not save the schedule'), 'error');
      await load();
    }
  };

  const create = () => run('create', async () => {
    try {
      const b = await apiService.createBackup();
      showToast(`Backup made: ${size(b.size)}`, 'success');
      await load();
    } catch (err) {
      showToast(errorText(err, 'Could not make the backup'), 'error');
    }
  });

  const download = (b: BackupInfo) => run(`download:${b.name}`, async () => {
    try {
      window.location.href = await apiService.backupDownloadUrl(b.name);
    } catch (err) {
      showToast(errorText(err, 'Could not start the download'), 'error');
    }
  });

  const remove = async (b: BackupInfo) => {
    if (!(await showConfirm(`Delete the backup from ${when(b.createdAt)}? This cannot be undone.`))) return;
    await run(`delete:${b.name}`, async () => {
      try {
        await apiService.deleteBackup(b.name);
        await load();
      } catch (err) {
        showToast(errorText(err, 'Could not delete the backup'), 'error');
      }
    });
  };

  const restore = async (b: BackupInfo) => {
    const contents = b.counts ? ` (${b.counts.scenarios} scenarios, ${b.counts.chats} chats, ${b.counts.users} users)` : '';
    if (!(await showConfirm(
      `Restore the backup from ${when(b.createdAt)}${contents}?\n\n` +
      'Every scenario, chat, user, setting and picture is replaced by the backup\'s. Anything changed since it was made is lost. ' +
      'A backup of the current state is made first, so this can be undone by restoring that one.',
    ))) return;
    await run(`restore:${b.name}`, async () => {
      try {
        const res = await apiService.restoreBackup(b.name);
        showToast(`Restored: ${res.counts.scenarios} scenarios, ${res.counts.chats} chats. Reloading…`, 'success');
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        showToast(errorText(err, 'Restore failed; nothing was changed'), 'error');
        await load();
      }
    });
  };

  const upload = async (file: File) => {
    await run('upload', async () => {
      setProgress(0);
      try {
        const b = await apiService.uploadBackup(file, setProgress);
        await load();
        if (await showConfirm(`Backup uploaded and checked (${size(b.size)}). Restore it now?`)) {
          setBusy('');
          await restore(b);
        }
      } catch (err) {
        showToast(errorText(err, 'Could not upload the backup'), 'error');
      } finally {
        setProgress(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400 leading-relaxed">
        A backup is one file with the database (users, scenarios, chats, memories, settings) and every picture.
        Backups are kept on the server{folder ? ` in the "${folder}" folder` : ''}; download them to keep a copy elsewhere.
        To move to a new server, download a backup here, then upload and restore it there.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={create} disabled={!!busy} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm">
          {busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {busy === 'create' ? 'Making backup…' : 'Make a backup now'}
        </button>
        <button onClick={() => fileInput.current?.click()} disabled={!!busy} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-sm">
          {busy === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : 'Upload a backup'}
        </button>
        <input ref={fileInput} type="file" accept=".tar" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      </div>

      {schedule && (
        <div className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 space-y-1 text-xs text-zinc-300">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 font-bold">
              <input type="checkbox" checked={schedule.enabled} onChange={e => changeSchedule({ enabled: e.target.checked })} className="accent-indigo-500" />
              Nightly backup
            </label>
            <span className="text-zinc-500">at</span>
            <select value={schedule.hour} disabled={!schedule.enabled} onChange={e => changeSchedule({ hour: Number(e.target.value) })} className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 disabled:opacity-50">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
            <span className="text-zinc-500">server time, keeping the last</span>
            <select value={schedule.keep} disabled={!schedule.enabled} onChange={e => changeSchedule({ keep: Number(e.target.value) })} className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 disabled:opacity-50">
              {[3, 5, 7, 14, 30].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <p className="text-zinc-500">
            {schedule.last ? `Last ran ${when(new Date(schedule.last).toISOString())}.` : 'Has not run yet.'} Older nightly backups are deleted
            automatically; backups you make or upload are kept until you delete them.
          </p>
          {schedule.error && <p className="flex items-center gap-1 text-red-300"><AlertTriangle size={12} /> Last nightly backup failed: {schedule.error}</p>}
        </div>
      )}

      {busy.startsWith('restore:') && (
        <p className="flex items-center gap-2 text-sm text-amber-300"><Loader2 size={16} className="animate-spin" /> Restoring… the site pauses for everyone until it is done.</p>
      )}

      {list && list.length === 0 && <p className="text-xs text-zinc-500">No backups yet.</p>}
      {list && list.length > 0 && (
        <div className="rounded-xl ring-1 ring-white/5 divide-y divide-zinc-800 max-h-96 overflow-y-auto">
          {list.map(b => (
            <div key={b.name} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
              <div className="flex-1 min-w-[12rem]">
                <p className="font-bold text-zinc-200">
                  {when(b.createdAt)}
                  {b.label === 'before-restore' && <span className="ml-2 text-amber-300 font-normal">before a restore</span>}
                  {b.label === 'uploaded' && <span className="ml-2 text-sky-300 font-normal">uploaded</span>}
                  {b.label === 'auto' && <span className="ml-2 text-zinc-500 font-normal">nightly</span>}
                </p>
                <p className="text-zinc-500">
                  {size(b.size)}
                  {b.counts && ` · ${b.counts.scenarios} scenarios · ${b.counts.chats} chats · ${b.counts.users} users`}
                  {b.pictures != null && ` · ${b.pictures} pictures`}
                  {b.version && ` · v${b.version}`}
                </p>
                {b.error && <p className="flex items-center gap-1 text-red-300"><AlertTriangle size={12} /> {b.error}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => download(b)} disabled={!!busy} title="Download" aria-label="Download" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40"><Download size={14} /></button>
                {!b.error && (
                  <button onClick={() => restore(b)} disabled={!!busy} title="Restore" className="flex items-center gap-1 px-2 py-1 rounded-lg font-bold text-amber-300 hover:bg-amber-900/30 disabled:opacity-40">
                    {busy === `restore:${b.name}` ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Restore
                  </button>
                )}
                <button onClick={() => remove(b)} disabled={!!busy} title="Delete" aria-label="Delete" className="p-2 rounded-lg text-zinc-400 hover:text-red-300 hover:bg-red-900/30 disabled:opacity-40"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
