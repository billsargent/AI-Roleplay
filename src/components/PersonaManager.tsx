/**
 * ─── Persona Manager ───
 *
 * Renders a list of the user's roleplay personas with inline editing.
 * Used inside SettingsPage to allow users to create, edit, and delete personas.
 *
 * Features:
 * - Lists all personas with avatar, name, and description
 * - Inline editing: clicking the edit icon replaces the card with input fields
 * - Add new: creates a blank persona with defaults ("New Persona")
 * - Delete: confirmation dialog then removes persona
 * - Image upload: each persona can have an avatar (base64, via file input overlay)
 *
 * All CRUD operations use apiService.getPersonas() / savePersona() / deletePersona().
 */
import React, { useState, useEffect } from 'react';
import { User, Plus, Trash2, Edit2, Check, X, Camera, Upload } from 'lucide-react';
import { apiService } from '../services/api';
import { Persona } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { fileToBase64 } from '../utils/image';
import { useNotifications } from '../utils/notifications';

export const PersonaManager: React.FC = () => {
  const { showConfirm } = useNotifications();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPersona, setEditPersona] = useState<Partial<Persona>>({});
  const [loading, setLoading] = useState(true);

  /** Fetch all personas for the current user from the API */
  const loadPersonas = async () => {
    setLoading(true);
    const data = await apiService.getPersonas();
    setPersonas(data);
    setLoading(false);
  };

  useEffect(() => {
    loadPersonas();
  }, []);

  /** Save the currently-editing persona (name + description) */
  const handleSave = async () => {
    if (editPersona.name && editingId) {
      const updated = { ...editPersona, id: editingId } as Persona;
      await apiService.savePersona(updated);
      await loadPersonas();
      setEditingId(null);
    }
  };

  /** Create a new persona with default values and immediately enter edit mode */
  const handleAddNew = async () => {
    const newPersona: Persona = {
      id: uuidv4(),
      name: 'New Persona',
      description: 'Description here...',
    };
    await apiService.savePersona(newPersona);
    await loadPersonas();
    setEditingId(newPersona.id);
    setEditPersona(newPersona);
  };

  /** Delete a persona after confirmation */
  const handleDelete = async (id: string) => {
    if (await showConfirm('Delete this persona?')) {
      await apiService.deletePersona(id);
      await loadPersonas();
    }
  };

  /** Upload a persona avatar image (converted to base64) */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        setEditPersona({ ...editPersona, avatar: base64 });
      } catch (err) {
        console.error("Image upload failed", err);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with "New Persona" button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2"><User className="text-indigo-500" /> My Personas</h2>
        <button 
          onClick={handleAddNew}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2"
        >
          <Plus size={16} /> New Persona
        </button>
      </div>

      {/* Persona cards grid */}
      <div className="grid grid-cols-1 gap-4">
        {personas.map(p => (
          <div key={p.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex gap-4 items-start relative group">
            {/* ─── Edit Mode ─── */}
            {editingId === p.id ? (
              <div className="flex-1 space-y-4">
                <div className="flex gap-4">
                   {/* Avatar with upload overlay */}
                   <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center relative overflow-hidden group/avatar">
                      {editPersona.avatar ? <img src={editPersona.avatar} className="w-full h-full object-cover" /> : <Camera className="text-zinc-700" />}
                      <label className="absolute inset-0 bg-black/60 opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                         <Upload size={16} className="text-white" />
                         <input 
                           type="file" 
                           accept="image/*" 
                           className="hidden" 
                           onChange={handleImageUpload}
                         />
                      </label>
                   </div>
                   {/* Name + description fields */}
                <div className="flex-1 space-y-2">
                  <input 
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1 text-white font-bold"
                    value={editPersona.name}
                    onChange={e => {
                      const newName = e.target.value;
                      if (newName.toLowerCase() === '{{user}}') {
                        // Silently reject — don't update state
                        return;
                      }
                      setEditPersona({...editPersona, name: newName});
                    }}
                  />
                     <textarea 
                       className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1 text-zinc-400 text-sm h-20 resize-none"
                       value={editPersona.description}
                       onChange={e => setEditPersona({...editPersona, description: e.target.value})}
                     />
                   </div>
                </div>
                {/* Save/Cancel buttons */}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingId(null)} className="p-2 text-zinc-500 hover:text-white"><X size={18}/></button>
                  <button onClick={handleSave} className="p-2 bg-indigo-600 rounded-lg text-white"><Check size={18}/></button>
                </div>
              </div>
            ) : (
              /* ─── Display Mode ─── */
              <>
                {/* Avatar */}
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" /> : <User className="text-zinc-700" size={32} />}
                </div>
                {/* Name + description */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-white mb-1">{p.name}</h3>
                  <p className="text-sm text-zinc-500 line-clamp-2">{p.description}</p>
                </div>
                {/* Action buttons (visible on hover) */}
                <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingId(p.id); setEditPersona(p); }} className="p-2 text-zinc-500 hover:text-white"><Edit2 size={16}/></button>
                  <button onClick={() => handleDelete(p.id)} className="p-2 text-zinc-500 hover:text-red-500"><Trash2 size={16}/></button>
                </div>
              </>
            )}
          </div>
        ))}
        {/* Empty state */}
        {!loading && personas.length === 0 && (
          <div className="text-center py-10 border-2 border-dashed border-zinc-900 rounded-2xl">
            <p className="text-zinc-600 text-sm">You haven't created any personas yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};
