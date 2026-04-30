/**
 * ─── Toast & Confirm Dialog Notification System ───
 *
 * Provides a React Context-based system for two types of user-facing notifications:
 *
 *   showToast(message, type)  — Auto-dismissing popup (success/error/info)
 *   showConfirm(message)      — Modal confirm dialog that returns a Promise<boolean>
 *
 * Both are accessible via the useNotifications() hook from any component
 * wrapped in <NotificationProvider> (set up in App.tsx).
 *
 * Toasts use framer-motion AnimatePresence for enter/exit animations.
 * The confirm dialog is a modal overlay with backdrop blur.
 */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';

// ─── Toast Item ───

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ─── Confirm Dialog State ───
// Uses a resolve callback so showConfirm() returns a Promise.

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

// ─── Context Shape ───

interface NotificationContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  showConfirm: (message: string) => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextType>({
  showToast: () => {},
  showConfirm: () => Promise.resolve(false),
});

/** Hook to access toast and confirm from any child component */
export const useNotifications = () => useContext(NotificationContext);

// ─── Provider Component ───

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const nextId = useRef(0);

  /** Show a toast that auto-dismisses after 3.5 seconds */
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, type }]);
    // Auto-remove after 3.5s
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  /** Show a modal confirm dialog and return the user's choice */
  const showConfirm = useCallback((message: string): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirm({ message, resolve });
    });
  }, []);

  /** Handle the user's confirm/cancel choice */
  const handleConfirm = (value: boolean) => {
    confirm?.resolve(value);
    setConfirm(null);
  };

  /** Manually dismiss a toast by ID (via the X button) */
  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // ─── Visual Style Maps ───

  const toastColors = {
    success: 'bg-emerald-900/90 border-emerald-700/50 text-emerald-200',
    error: 'bg-red-900/90 border-red-700/50 text-red-200',
    info: 'bg-zinc-800/90 border-zinc-700/50 text-zinc-200',
  };

  const toastIcons = {
    success: <CheckCircle size={18} className="text-emerald-400" />,
    error: <AlertTriangle size={18} className="text-red-400" />,
    info: <CheckCircle size={18} className="text-zinc-400" />,
  };

  return (
    <NotificationContext.Provider value={{ showToast, showConfirm }}>
      {children}

      {/* ─── Toast Container ───
       * Fixed at the bottom-center of the viewport.
       * pointer-events-none on the container so clicks pass through;
       * each individual toast has pointer-events-auto. */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl border shadow-2xl ${toastColors[toast.type]}`}
            >
              {toastIcons[toast.type]}
              <span className="text-sm font-semibold">{toast.message}</span>
              <button onClick={() => removeToast(toast.id)} className="ml-2 opacity-60 hover:opacity-100 transition-opacity">
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ─── Confirm Dialog Overlay ───
       * Full-screen backdrop with centered modal card.
       * Clicking the backdrop cancels (closes without confirming). */}
      <AnimatePresence>
        {confirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => handleConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.15 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 max-w-md w-full shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-amber-600/20 text-amber-500 rounded-xl">
                  <AlertTriangle size={24} />
                </div>
                <h3 className="text-lg font-bold text-white">Confirm</h3>
              </div>
              <p className="text-zinc-300 text-sm leading-relaxed mb-6 whitespace-pre-wrap">{confirm.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleConfirm(false)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirm(true)}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </NotificationContext.Provider>
  );
};
