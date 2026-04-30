/**
 * ─── AI Scenario Generator Modal ───
 *
 * A modal overlay that lets users describe a scenario in natural language,
 * submits the description to the DeepSeek API, and returns structured data
 * to populate the scenario editor as a draft.
 *
 * Follows the same dark theme and animation patterns as the NotificationProvider
 * confirm dialog in src/utils/notifications.tsx.
 *
 * @module AIGeneratorModal
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, AlertTriangle, X } from 'lucide-react';
import { deepseek, AiGeneratedScenarioData } from '../services/deepseek';

interface AIGeneratorModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Called when the user closes the modal without generating */
  onClose: () => void;
  /**
   * Called when the AI successfully generates a scenario.
   * Receives the parsed data ready to populate the editor.
   */
  onScenarioGenerated: (data: AiGeneratedScenarioData) => void;
}

type GenerationState = 'idle' | 'generating' | 'error';

export const AIGeneratorModal: React.FC<AIGeneratorModalProps> = ({
  isOpen,
  onClose,
  onScenarioGenerated,
}) => {
  const [description, setDescription] = useState('');
  const [state, setState] = useState<GenerationState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  /** Resets the modal to its idle state */
  const reset = () => {
    setDescription('');
    setState('idle');
    setErrorMessage('');
  };

  /** Handles the close action: reset state and notify parent */
  const handleClose = () => {
    reset();
    onClose();
  };

  /**
   * Submits the user's description to the AI and processes the result.
   * On success, calls onScenarioGenerated with the parsed data and closes.
   * On failure, shows an error message inline in the modal.
   */
  const handleGenerate = async () => {
    const trimmed = description.trim();
    if (!trimmed) return;

    setState('generating');
    setErrorMessage('');

    try {
      const generated = await deepseek.generateScenario(trimmed);
      reset();
      onScenarioGenerated(generated);
    } catch (err: any) {
      setState('error');
      setErrorMessage(err.message || 'An unexpected error occurred. Please try again.');
    }
  };

  /** Allow generating by pressing Ctrl+Enter (or Cmd+Enter) */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.15 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-xl w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl">
                  <Sparkles size={24} />
                </div>
                <h3 className="text-xl font-bold text-white">AI Scenario Generator</h3>
              </div>
              <button
                onClick={handleClose}
                className="text-zinc-600 hover:text-zinc-300 p-1 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-zinc-500 text-sm mb-6 ml-1">
              Describe the scenario you want and the AI will fill in all the fields as a draft.
            </p>

            {/* ── Textarea ── */}
            <div className="relative">
              <textarea
                className={`w-full bg-zinc-950 border ${
                  state === 'error' ? 'border-red-600/50' : 'border-zinc-800'
                } rounded-2xl px-5 py-4 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none h-48 transition-colors`}
                placeholder={`Example: A fantasy adventure in a floating city where {{user}} is a young mage who discovers an ancient portal beneath the royal library. Include a wise old librarian NPC, a mischievous airship captain, and lore about the lost sky-kingdom.`}
                value={description}
                onChange={e => {
                  setDescription(e.target.value);
                  if (state === 'error') setState('idle');
                }}
                onKeyDown={handleKeyDown}
                disabled={state === 'generating'}
              />
              <span className="absolute bottom-4 right-4 text-[10px] text-zinc-700 font-mono">
                Ctrl+Enter to send
              </span>
            </div>

            {/* ── Error Message ── */}
            {state === 'error' && errorMessage && (
              <div className="mt-3 p-3 bg-red-900/20 border border-red-600/30 rounded-xl flex items-start gap-3">
                <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs font-semibold text-red-300">{errorMessage}</p>
              </div>
            )}

            {/* ── Actions ── */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleClose}
                disabled={state === 'generating'}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={state === 'generating' || !description.trim()}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
              >
                {state === 'generating' ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    Generate
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
