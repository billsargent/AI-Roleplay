/**
 * ─── Admin User Editor ───
 *
 * Provides a full user management interface for administrators.
 * Renders inside the AdminPage "Users" tab.
 *
 * Features:
 * - Table view of all users with columns: Username, Role, Chats (count), Created date, Actions
 * - Inline editing: click edit icon to toggle a row into editable mode
 *   (username, role, optional new password)
 * - Create user form: expandable panel with username, password, and role selector
 * - Delete user: confirmation dialog with cascade warning (personas, chats, scenarios deleted)
 * - Save/cancel for inline edits
 *
 * All operations use apiService.getAdminUsers(), createAdminUser(), updateAdminUser(),
 * deleteAdminUser().
 */
import React, { useState, useEffect } from 'react';
import { User, Shield, Trash2, Plus, X, Check, Edit2 } from 'lucide-react';
import { apiService } from '../services/api';
import { useNotifications } from '../utils/notifications';

/** Shape of a user as returned by the admin API */
interface AdminUser {
  id: string;
  username: string;
  role: string;
  created_at: number;
  chatCount: number;
}

export const UserEditor: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ username: '', role: '', password: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'user' });

  /** Fetch all users via admin API */
  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await apiService.getAdminUsers();
      setUsers(data);
    } catch (e) {
      console.error('Failed to load users', e);
      showToast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  /** Enter edit mode for a specific user, pre-fill form fields */
  const startEdit = (user: AdminUser) => {
    setEditingId(user.id);
    setEditForm({ username: user.username, role: user.role, password: '' });
  };

  /** Cancel inline editing */
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ username: '', role: '', password: '' });
  };

  /** Save changes to a user (only sends non-empty fields) */
  const saveEdit = async (id: string) => {
    try {
      const updates: any = {};
      if (editForm.username.trim()) updates.username = editForm.username.trim();
      if (editForm.role) updates.role = editForm.role;
      if (editForm.password.trim()) updates.password = editForm.password.trim();
      await apiService.updateAdminUser(id, updates);
      showToast('User updated', 'success');
      cancelEdit();
      loadUsers();
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Failed to update user', 'error');
    }
  };

  /** Delete a user with cascade warning */
  const deleteUser = async (user: AdminUser) => {
    if (await showConfirm(`Delete user "${user.username}"? This will delete all their personas, chats, and scenarios. This cannot be undone.`)) {
      try {
        await apiService.deleteAdminUser(user.id);
        showToast('User deleted', 'success');
        loadUsers();
      } catch (err: any) {
        showToast(err?.response?.data?.error || 'Failed to delete user', 'error');
      }
    }
  };

  /** Create a new user from the create form */
  const createUser = async () => {
    if (!createForm.username.trim() || !createForm.password.trim()) {
      showToast('Username and password are required', 'error');
      return;
    }
    try {
      await apiService.createAdminUser({
        username: createForm.username.trim(),
        password: createForm.password.trim(),
        role: createForm.role,
      });
      showToast('User created', 'success');
      setShowCreate(false);
      setCreateForm({ username: '', password: '', role: 'user' });
      loadUsers();
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Failed to create user', 'error');
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-zinc-500">Loading users...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header + Add User button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Shield size={18} className="text-indigo-500" />
          User Management
        </h3>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-bold text-sm transition-all"
        >
          <Plus size={16} /> Add User
        </button>
      </div>

      {/* ─── Create User Form (expandable) ─── */}
      {showCreate && (
        <div className="bg-zinc-800 rounded-2xl p-4 border border-zinc-700 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase tracking-wider">Username</label>
              <input
                type="text"
                value={createForm.username}
                onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Username"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Password"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-400 mb-1 uppercase tracking-wider">Role</label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm(f => ({ ...f, role: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowCreate(false); setCreateForm({ username: '', password: '', role: 'user' }); }}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-bold text-sm transition-all"
            >
              Cancel
            </button>
            <button
              onClick={createUser}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm transition-all"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* ─── Users Table ─── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 text-[10px] uppercase tracking-wider font-bold border-b border-zinc-800">
              <th className="text-left py-2 pr-4">Username</th>
              <th className="text-left py-2 pr-4">Role</th>
              <th className="text-left py-2 pr-4">Chats</th>
              <th className="text-left py-2 pr-4">Created</th>
              <th className="text-right py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-zinc-500 italic">No users found.</td>
              </tr>
            )}
            {users.map(user => (
              <tr key={user.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                {editingId === user.id ? (
                  /* ─── Inline Edit Mode ─── */
                  <>
                    <td className="py-2 pr-4">
                      <input
                        type="text"
                        value={editForm.username}
                        onChange={(e) => setEditForm(f => ({ ...f, username: e.target.value }))}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <select
                        value={editForm.role}
                        onChange={(e) => setEditForm(f => ({ ...f, role: e.target.value }))}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">{user.chatCount}</td>
                    <td className="py-2 pr-4 text-zinc-500">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => cancelEdit()}
                          className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                          title="Cancel"
                        >
                          <X size={16} />
                        </button>
                        <button
                          onClick={() => saveEdit(user.id)}
                          className="p-1.5 text-green-500 hover:text-green-400 transition-colors"
                          title="Save"
                        >
                          <Check size={16} />
                        </button>
                      </div>
                      {/* Optional new password field */}
                      {editingId === user.id && (
                        <div className="mt-1">
                          <input
                            type="password"
                            placeholder="New password (optional)"
                            value={editForm.password}
                            onChange={(e) => setEditForm(f => ({ ...f, password: e.target.value }))}
                            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-1"
                          />
                        </div>
                      )}
                    </td>
                  </>
                ) : (
                  /* ─── Display Mode ─── */
                  <>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center">
                          <User size={14} className="text-zinc-500" />
                        </div>
                        <span className="text-white font-medium">{user.username}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        user.role === 'admin'
                          ? 'bg-indigo-600/20 text-indigo-400'
                          : 'bg-zinc-700/50 text-zinc-400'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-zinc-500">{user.chatCount}</td>
                    <td className="py-3 pr-4 text-zinc-500 text-[10px]">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="py-3 text-right">
                      <div className="flex gap-1 justify-end opacity-0 hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(user)}
                          className="p-1.5 text-zinc-500 hover:text-indigo-400 transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => deleteUser(user)}
                          className="p-1.5 text-zinc-500 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
