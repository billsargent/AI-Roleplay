/**
 * Scenario Editor Page
 * 
 * A full-featured editor for creating and modifying roleplay scenarios.
 * Supports importing from JSON files (Risuprompt format compatible),
 * image upload via base64 encoding, character/lore management with
 * smart-activation triggers, and privacy/visibility settings.
 * 
 * @module CreateScenario
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, Image as ImageIcon, Info, BookOpen, Brain, 
  Settings as SettingsIcon, Save, Plus, Trash2, 
  UserPlus, ChevronLeft, Globe, Lock, Upload,
  FileJson, Sparkles, FileText, RefreshCw, Stethoscope
} from 'lucide-react';
import { apiService } from '../services/api';
import { AiGeneratedScenarioData, LoreSuggestDraft, LoreSuggestion } from '../services/deepseek';

import { Scenario, LorePiece, StoryCharacter } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { fileToBase64, urlToBase64 } from '../utils/image';
import { useLocation } from 'react-router-dom';
import { useNotifications } from '../utils/notifications';
import { AIGeneratorModal } from '../components/AIGeneratorModal';
import { LoreSuggestModal } from '../components/LoreSuggestModal';
import { AIEnhanceButton } from '../components/AIEnhanceButton';
import { LoreFixModal } from '../components/LoreFixModal';
import { TraitsInput } from '../components/Traits';
import { RichtextEditor } from '../components/RichtextEditor';


/** Copies lore pieces with new ids, keeping their links pointing at the copies */
function remapLoreIds(pieces: LorePiece[]): LorePiece[] {
  const newId = new Map(pieces.map(p => [p.id, uuidv4()]));
  return pieces.map(p => ({
    ...p,
    id: newId.get(p.id)!,
    linkedPieces: (p.linkedPieces || []).map(id => newId.get(id)).filter((id): id is string => !!id),
  }));
}

export const CreateScenario: React.FC = () => {
  const { showToast, showConfirm } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const initialScenario = location.state?.scenario;
  const user = apiService.getCurrentUser();

  /**
   * Initialize scenario state:
   * - If editing an existing scenario (passed via navigation state), load it.
   * - If copying another user's scenario, create a new copy with new IDs.
   * - Otherwise, create a fresh blank scenario.
   */
  const [scenario, setScenario] = useState<Scenario>(() => {
    if (initialScenario) {
      // Copying another user's scenario (or our own)
      if (initialScenario.userId !== user?.id) {
        return {
          ...initialScenario,
          id: uuidv4(),
          name: `${initialScenario.name} (Copy)`,
          sourceId: undefined,
          userId: user?.id,
          creatorName: user?.username,
          createdAt: Date.now(),
          settings: { ...initialScenario.settings, isPublic: false },
          characters: initialScenario.characters?.map((c: StoryCharacter) => ({ ...c, id: uuidv4() })) || [],
          lorePieces: remapLoreIds(initialScenario.lorePieces || []),
        };
      }
      return initialScenario;
    }

    // Fresh blank scenario with reasonable defaults
    return {
      id: uuidv4(),
      name: '',
      description: '',
      tags: [],
      backstory: '',
      greetingMessage: '',
      customInstructions: '',
      lorePieces: [],
      characters: [],
      settings: {
        separateUserCharacter: true,
        sensitiveContent: false,
        isPublic: true,
        allowCustomization: true,
        hidePrompts: false,
        allowCommenting: true,
      },
      createdAt: Date.now(),
    };
  });

  const [newTag, setNewTag] = useState('');
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [showLoreSuggest, setShowLoreSuggest] = useState(false);
  const [showLoreFix, setShowLoreFix] = useState(false);
  const [triggerInputs, setTriggerInputs] = useState<Record<string, string>>({});
  const [rteKey, setRteKey] = useState(0);
  /** Problems found when saving, shown under the fields (cleared as they are edited) */
  const [errors, setErrors] = useState<{ name?: string; description?: string; backstory?: string }>({});
  /** True when there are edits that have not been saved */
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Closing or reloading the tab with unsaved edits asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Back and Cancel: asks before throwing away unsaved edits */
  const leaveEditor = async () => {
    if (dirty && !(await showConfirm('You have unsaved changes. Leave without saving?'))) return;
    navigate('/');
  };
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const reimportInputRef = React.useRef<HTMLInputElement>(null);
  /** Editing a saved scenario of one's own (not a new one or a copy): it can be updated from its export file */
  const isSavedScenario = !!initialScenario && (initialScenario.userId === user?.id || user?.role === 'admin');

  /**
   * Updates this saved scenario from a Fictionlab export: shows what would
   * change, then re-imports on the server (id, chats, name, settings and
   * pictures are kept) and reloads the editor.
   */
  const handleReimport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      showToast('This file is not valid JSON', 'error');
      return;
    }
    try {
      const { summary } = await apiService.reimportScenario(scenario.id, json, false);
      const lines = [
        `Lore: ${summary.lore.before} → ${summary.lore.after} cards${summary.lore.added.length ? ` (${summary.lore.added.length} new)` : ''}${summary.lore.removed.length ? `, ${summary.lore.removed.length} not in the file` : ''}`,
        `Never sent to the AI: ${summary.lore.neverSentBefore} → ${summary.lore.neverSentAfter}`,
        `Working lore links: ${summary.lore.workingLinksBefore} → ${summary.lore.workingLinksAfter}`,
        `Characters: ${summary.characters.before} → ${summary.characters.after}`,
        summary.fields.length ? `Also replaced: ${summary.fields.join(', ')}` : '',
      ].filter(Boolean);
      const warning = dirty ? '\n\nYour unsaved changes in the editor will be lost.' : '';
      if (!(await showConfirm(`Update "${scenario.name}" from this file?\n\n${lines.join('\n')}\n\nThe name, settings, pictures and chats are kept.${warning}`))) return;
      showToast('Updating from the file…', 'info');
      await apiService.reimportScenario(scenario.id, json, true);
      const fresh = await apiService.getScenario(scenario.id);
      if (fresh) {
        setScenario(fresh);
        setRteKey(prev => prev + 1);
        setDirty(false);
      }
      showToast('Scenario updated from the file', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Could not update from this file', 'error');
    }
  };

  /**
   * Handles clicking the AI Generate button.
   * If the scenario already has content, shows a confirmation dialog
   * warning the user that existing data will be replaced.
   * If blank, opens the generator modal immediately.
   */
  const handleAiGenerateClick = async () => {
    const hasContent = scenario.name || scenario.description || scenario.backstory ||
      scenario.characters.length > 0 || scenario.lorePieces.length > 0;
    
    if (hasContent) {
      const confirmed = await showConfirm(
        'This will replace all current scenario content, including characters and lore cards, with AI-generated data. Your existing work will be lost. Continue?'
      );
      if (!confirmed) return;
    }
    setShowAiGenerator(true);
  };

  /** FictionLab Image CDN base for relative image paths. */
  const FICTIONLAB_CDN = 'https://fictionlab.ai/image-cdn/';

  /**
   * Parses an HTML string, finds all <img> tags, fetches each image URL,
   * converts it to base64, and replaces the src attributes in the HTML.
   * Falls back to the original URL if fetching fails.
   */
  const embedImagesInHtml = async (html: string): Promise<string> => {
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    const replacements: { url: string; base64: string }[] = [];
    const urls = new Set<string>();
    while ((match = imgRegex.exec(html)) !== null) {
      urls.add(match[1]);
    }
    if (urls.size === 0) return html;
    const results = await Promise.allSettled(
      Array.from(urls).map(async (url) => {
        const base64 = await urlToBase64(url);
        return { url, base64 };
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        replacements.push(result.value);
      }
    }
    let resultHtml = html;
    for (const { url, base64 } of replacements) {
      resultHtml = resultHtml.split(url).join(base64);
    }
    return resultHtml;
  };

  /**
   * Resolves a FictionLab image path to a full URL.
   * If the path is already absolute, returns it as-is.
   */
  const flImageUrl = (path: string): string => {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${FICTIONLAB_CDN}${path}`;
  };

  /**
   * Imports a scenario from a JSON file.
   * Supports both plain JSON (Risuprompt format) and FictionLab format
   * with image downloading (cover, introduction, character avatars, lore avatars).
   */
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again later
    if (!file) return;
    const hasContent = scenario.name || scenario.description || scenario.backstory ||
      scenario.characters.length > 0 || scenario.lorePieces.length > 0;
    if (hasContent && !(await showConfirm('Importing replaces everything in this editor, including characters and lore. Continue?'))) return;

    showToast('📥 Importing scenario with images...', 'info');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      let json: unknown;
      try {
        json = JSON.parse(ev.target?.result as string);
      } catch {
        showToast('Import failed: the file is not valid JSON', 'error');
        return;
      }
      try {
        // The server reads every Fictionlab export shape (see lib/fictionlab.js)
        const { draft, report, imageUrls } = await apiService.parseFictionlab(json);
        const download = async (url?: string) => (url ? urlToBase64(flImageUrl(url)).catch(() => '') : '');
        const imported: Scenario = {
          ...draft,
          id: uuidv4(),
          userId: user?.id,
          creatorName: user?.username,
          createdAt: Date.now(),
          image: await download(imageUrls.cover),
          introduction: draft.introduction ? await embedImagesInHtml(draft.introduction) : '',
          characters: await Promise.all(draft.characters.map(async c => ({ ...c, avatar: await download(imageUrls.characters[c.id]) }))),
          lorePieces: await Promise.all(draft.lorePieces.map(async p => ({ ...p, avatar: await download(imageUrls.lore[p.id]) }))),
        };

        setScenario(imported);
        setRteKey(prev => prev + 1);
        setDirty(true);
        const notes = [
          `${imported.lorePieces.length} lore cards, ${imported.characters.length} characters`,
          report.mergedRules.length ? `${report.mergedRules.length} rule card(s) moved into Custom AI Instructions` : '',
          report.noTriggers.length ? `${report.noTriggers.length} card(s) have no trigger words yet` : '',
        ].filter(Boolean);
        showToast(`✅ Imported: ${notes.join('; ')}. Review, then save.`, 'success');
      } catch (err: any) {
        showToast(`Import failed: ${err?.message || 'unknown error'}`, 'error');
        console.error('Import error:', err);
      }
    };
    reader.readAsText(file);
  };

  /** Updates a subset of scenario fields. */
  const updateScenario = (updates: Partial<Scenario>) => {
    setScenario(prev => {
      const changed = (Object.keys(updates) as (keyof Scenario)[]).some(k => updates[k] !== prev[k]);
      if (!changed) return prev;
      setDirty(true);
      return { ...prev, ...updates };
    });
  };

  /** Trigger words typed into a piece's box but not added yet */
  const pendingTriggers = (id: string) => (triggerInputs[id] || '').split(',').map(w => w.trim()).filter(Boolean);

  /** Adds the typed trigger words to a piece (Enter, leaving the box, or saving) */
  const commitTriggers = (id: string) => {
    const words = pendingTriggers(id);
    if (words.length > 0) {
      updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === id ? { ...p, triggers: [...new Set([...(p.triggers || []), ...words])] } : p) });
    }
    setTriggerInputs(prev => ({ ...prev, [id]: '' }));
  };

  /** Removes a lore piece and any links to it */
  const removeLorePiece = (id: string) => {
    updateScenario({
      lorePieces: scenario.lorePieces
        .filter(p => p.id !== id)
        .map(p => (p.linkedPieces || []).includes(id) ? { ...p, linkedPieces: p.linkedPieces.filter(x => x !== id) } : p),
    });
  };

  /** Updates scenario settings (privacy/customization toggles). */
  const updateSettings = (updates: any) => {
    updateScenario({ settings: { ...scenario.settings, ...updates } });
  };

  /**
   * Validates and saves the scenario to the server.
   * - Strips blank lore cards (no title/content)
   * - Downgrades smart-activated lore with no triggers to draft
   * - Enforces required fields (name, description, backstory)
   * - Requires cover image for public scenarios
   */
  const handleSave = async () => {
    if (saving) return;
    // Words still typed in a trigger box count as added
    const withPending = scenario.lorePieces.map(p => {
      const words = pendingTriggers(p.id);
      return words.length && p.smartActivation ? { ...p, triggers: [...new Set([...(p.triggers || []), ...words])] } : p;
    });
    setTriggerInputs({});
    // Remove blank lore cards (no meaningful content)
    const nonBlankLore = withPending.filter(
      p => p.content.trim() || (p.title.trim() && p.title !== 'New Lore Piece')
    );
    if (nonBlankLore.length < withPending.length) {
      showToast(`${withPending.length - nonBlankLore.length} blank lore card(s) will be removed before saving.`, 'info');
    }
    // Triggered lore with no trigger words could never be sent: save it as "Never" and say so
    const noTriggers = nonBlankLore.filter(p => !p.pinned && p.smartActivation && (!p.triggers || p.triggers.length === 0));
    if (noTriggers.length > 0) {
      showToast(`${noTriggers.map(p => `"${p.title || 'Untitled lore'}"`).join(', ')} ${noTriggers.length === 1 ? 'has' : 'have'} no trigger words and will be saved as "Never (draft)".`, 'info');
    }
    const cleanedLore = nonBlankLore.map(p => noTriggers.includes(p) ? { ...p, smartActivation: false, pinned: false } : p);

    // Drop characters that were added but never filled in; a described character needs a name
    const characters = scenario.characters.filter(c => (c.name || '').trim() || (c.description || '').trim() || (c.personality || '').trim() || c.avatar);
    if (characters.some(c => !(c.name || '').trim())) {
      showToast('Every character needs a name.', 'error');
      document.getElementById('editor-cast')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Required fields (whitespace does not count)
    const found: typeof errors = {};
    if (!scenario.name.trim()) found.name = 'Give the scenario a name.';
    if (!scenario.description.trim()) found.description = 'Add a short summary for the scenario card.';
    if (!scenario.backstory.trim()) found.backstory = 'The backstory is required: it is what the AI knows about the world.';
    setErrors(found);
    const firstProblem = (['name', 'description', 'backstory'] as const).find(k => found[k]);
    if (firstProblem) {
      showToast('Please fill in the highlighted fields.', 'error');
      const id = { name: 'scenario-name', description: 'scenario-summary', backstory: 'scenario-backstory' }[firstProblem];
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById(id)?.focus({ preventScroll: true });
      return;
    }
    // Enforce image requirement for public scenarios
    if (scenario.settings.isPublic && !scenario.image) {
      showToast('A cover image is required before this scenario can be published publicly. Please upload an image, or save as Private.', 'error');
      return;
    }

    setSaving(true);
    try {
      await apiService.saveScenario({ ...scenario, characters, lorePieces: cleanedLore });
      setDirty(false);
      navigate('/');
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Failed to save scenario', 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Adds a new NPC character with default values. */
  const addCharacter = () => {
    const char: StoryCharacter = {
      id: uuidv4(),
      name: '',
      description: '',
      personality: '',
    };
    updateScenario({ characters: [...scenario.characters, char] });
  };

  /** The editor's current fields for the lore suggester (introduction as plain text) */
  const loreSuggestDraft = (): LoreSuggestDraft => ({
    name: scenario.name,
    description: scenario.description,
    backstory: scenario.backstory,
    introduction: new DOMParser().parseFromString(scenario.introduction || '', 'text/html').body.textContent || '',
    customInstructions: scenario.customInstructions || '',
    characters: scenario.characters.map(c => ({ name: c.name || '', description: c.description || '' })),
    loreTitles: scenario.lorePieces.map(p => p.title).filter(Boolean),
  });

  /** Adds the lore cards the author picked from the suggestions */
  const addSuggestedLore = (cards: LoreSuggestion[]) => {
    const pieces: LorePiece[] = cards.map(c => ({
      id: uuidv4(),
      type: c.type,
      title: c.title,
      description: '',
      content: c.content,
      weight: 100,
      pinned: c.mode === 'always',
      smartActivation: c.mode !== 'always',
      triggers: c.mode === 'always' ? [] : c.triggers,
      linkedPieces: [],
    }));
    updateScenario({ lorePieces: [...scenario.lorePieces, ...pieces] });
    showToast(`Added ${pieces.length} lore card${pieces.length === 1 ? '' : 's'}. Review them, then save.`, 'success');
  };

  /** Adds a new lore piece with default values. */
  const addLorePiece = () => {
    const piece: LorePiece = {
      id: uuidv4(),
      type: 'location',
      title: '',
      description: '',
      content: '',
      weight: 100,
      pinned: false,
      smartActivation: true,
      triggers: [],
      linkedPieces: [],
    };
    updateScenario({ lorePieces: [...scenario.lorePieces, piece] });
  };

  /** Handles image upload via FileReader → base64. */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        updateScenario({ image: base64 });
      } catch (err) {
        console.error("Image upload failed", err);
      }
    }
  };

  /**
   * Callback for the AI Generator modal.
   * Maps the AI-generated data into the Scenario format with new IDs,
   * sets it as the current scenario draft, and notifies the user.
   */
  const handleAiGenerated = (data: AiGeneratedScenarioData) => {
    const newScenario: Scenario = {
      id: uuidv4(),
      userId: user?.id,
      creatorName: user?.username,
      name: data.name,
      description: data.description,
      tags: data.tags,
      backstory: data.backstory,
      greetingMessage: data.greetingMessage,
      customInstructions: data.customInstructions,
      // Remove any character named {{user}} (reserved placeholder)
      characters: data.characters
        .filter(c => c.name.toLowerCase() !== '{{user}}')
        .map(c => ({
        id: uuidv4(),
        name: c.name,
        description: c.description,
        personality: c.personality,
        // No avatar — user will add images later
      })),
      lorePieces: data.lorePieces.map(lp => ({
        id: uuidv4(),
        type: (['location', 'event', 'object', 'other'].includes(lp.type) ? lp.type : 'other') as LorePiece['type'],
        title: lp.title,
        description: '',
        content: lp.content,
        weight: 100,
        pinned: false,
        smartActivation: true,
        triggers: Array.isArray(lp.triggers) ? lp.triggers : [],
        linkedPieces: [],
      })),

      settings: { ...scenario.settings },
      createdAt: Date.now(),
    };
    setScenario(newScenario);
    setDirty(true);
    setShowAiGenerator(false);
    showToast('✨ AI-generated scenario loaded as a draft. Add images and tweak as needed!', 'success');
  };

  // ── Render ──
  const inputClass = 'w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const labelClass = 'block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2';
  const enhanceContext = { name: scenario.name, description: scenario.description };
  /** Problems shown on each lore card (the full check is in "Check & fix lore") */
  const loreIds = new Set(scenario.lorePieces.map(p => p.id));
  const linkedTo = new Set(scenario.lorePieces.flatMap(p => p.linkedPieces || []));
  const castNames = new Set(scenario.characters.map(c => (c.name || '').trim().toLowerCase()));
  const loreBadges = (p: LorePiece): string[] => [
    ...(!p.pinned && !(p.smartActivation && (p.triggers || []).length) && !linkedTo.has(p.id) ? ['Never sent'] : []),
    ...((p.linkedPieces || []).some(id => !loreIds.has(id)) ? ['Broken link'] : []),
    ...(p.type === 'character' && castNames.has((p.title || '').trim().toLowerCase()) ? ['Same as a cast member'] : []),
  ];
  /** A field label with the Enhance button on the right */
  const labelRow = (label: React.ReactNode, enhance: React.ReactNode, htmlFor?: string, small = false) => (
    <div className={`flex items-center justify-between gap-2 ${small ? 'mb-1' : 'mb-2'}`}>
      <label className={small ? 'text-[10px] font-black text-zinc-500 uppercase' : labelClass.replace(' mb-2', '')} htmlFor={htmlFor}>{label}</label>
      {enhance}
    </div>
  );
  const sectionClass = 'scroll-mt-32 bg-zinc-900/60 ring-1 ring-white/5 rounded-2xl p-5 sm:p-8 space-y-6';

  return (
    <div className="pt-6 px-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={leaveEditor} className="p-2 bg-zinc-900 rounded-full text-zinc-400 hover:text-white border border-zinc-800" title="Back" aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white">Scenario Editor</h1>
            <p className="text-zinc-500 text-sm">Design your world and its inhabitants</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAiGenerateClick}
            className="bg-indigo-600/10 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/20 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all"
          >
            <Sparkles size={16} /> AI Generate
          </button>
          <input type="file" accept=".json" ref={importInputRef} className="hidden" onChange={handleImport} />
          <button
            onClick={() => importInputRef.current?.click()}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all"
          >
            <FileJson size={16} /> Import
          </button>
          {isSavedScenario && (
            <>
              <input type="file" accept=".json" ref={reimportInputRef} className="hidden" onChange={handleReimport} />
              <button
                onClick={() => reimportInputRef.current?.click()}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all"
                title="Update this scenario from its Fictionlab export file (chats are kept)"
              >
                <RefreshCw size={16} /> Update from file
              </button>
            </>
          )}
        </div>
      </div>

      {/* Section navigation: stays at the top while scrolling (navbar is on top from md up) */}
      <nav aria-label="Editor sections" className="sticky top-0 md:top-16 z-30 -mx-4 px-4 py-2 mb-6 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/60">
        <div className="flex gap-1 overflow-x-auto">
          {EDITOR_SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="space-y-8">
        {/* Essential Details: Name, Tags, Image, Summary */}
        <section id="editor-basics" className={sectionClass}>
          <h2 className="text-xl font-bold flex items-center gap-3"><Info className="text-indigo-400" /> Essential Details</h2>
          <div className="flex flex-col md:flex-row gap-6">
            {/* Cover image upload area */}
            <div className="w-full md:w-56 aspect-video md:aspect-square bg-zinc-950 border border-zinc-800 rounded-2xl flex flex-col items-center justify-center relative group overflow-hidden cursor-pointer flex-shrink-0">
              {scenario.image ? <img src={scenario.image} className="w-full h-full object-cover" alt="Cover" /> : <ImageIcon size={40} className="text-zinc-800" />}
              <label className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 flex flex-col items-center justify-center p-4 transition-opacity cursor-pointer text-center">
                <Upload size={24} className="text-white mb-2" />
                <span className="text-xs font-bold text-white uppercase">Upload Image</span>
                <span className="text-[10px] text-zinc-500 mt-1">Best fit: 1920×1080px (16:9 ratio)</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            </div>
            <div className="flex-1 space-y-4 min-w-0">
              <div>
                <label className={labelClass} htmlFor="scenario-name">Scenario Name</label>
                <input id="scenario-name" className={`${inputClass} ${errors.name ? 'ring-1 ring-red-500 border-red-500/60' : ''}`} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'scenario-name-error' : undefined} placeholder="Give your story a title..." value={scenario.name} onChange={e => { updateScenario({ name: e.target.value }); if (errors.name) setErrors(p => ({ ...p, name: undefined })); }} />
                {errors.name && <p id="scenario-name-error" className="text-xs text-red-400 mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className={labelClass} htmlFor="scenario-tag">Tags</label>
                {scenario.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {scenario.tags.map(tag => (
                      <span key={tag} className="bg-indigo-600/10 text-indigo-300 border border-indigo-600/20 px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-2">
                        {tag}
                        <button onClick={() => updateScenario({ tags: scenario.tags.filter(t => t !== tag) })} aria-label={`Remove tag ${tag}`}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <input id="scenario-tag" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="Add tag (press Enter)" value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newTag.trim()) { if (!scenario.tags.includes(newTag.trim())) updateScenario({ tags: [...scenario.tags, newTag.trim()] }); setNewTag(''); } }} />
                <p className="text-[11px] text-zinc-600 mt-1">Help players find the scenario in search. Not sent to the AI.</p>
              </div>
            </div>
          </div>
          <div>
            {labelRow('Brief Summary', <AIEnhanceButton field="description" label="Brief Summary" value={scenario.description} onChange={v => updateScenario({ description: v })} context={enhanceContext} />, 'scenario-summary')}
            <AutoTextarea id="scenario-summary" minRows={3} className={`${inputClass} ${errors.description ? 'ring-1 ring-red-500 border-red-500/60' : ''}`} placeholder="A short hook to grab players' attention..." value={scenario.description} onChange={v => { updateScenario({ description: v }); if (errors.description) setErrors(p => ({ ...p, description: undefined })); }} />
            {errors.description && <p className="text-xs text-red-400 mt-1">{errors.description}</p>}
            <p className="text-[11px] text-zinc-600 mt-1 flex justify-between gap-4">
              <span>Shown on the scenario card. Not sent to the AI.</span>
              <span className={scenario.description.length > 300 ? 'text-amber-400' : ''}>{scenario.description.length} / 300 suggested</span>
            </p>
          </div>
        </section>

        {/* Introduction: Rich Text Editor */}
        <section id="editor-intro" className={sectionClass}>
          <h2 className="text-xl font-bold flex items-center gap-3"><FileText className="text-amber-400" /> Introduction</h2>
          <p className="text-xs text-zinc-500">
            A rich, visual introduction shown to players before they start. Only sent to the AI if you turn on
            "Send Introduction to AI" in the settings below.
          </p>
          <RichtextEditor
            key={rteKey}
            content={scenario.introduction || ''}
            onChange={(html) => updateScenario({ introduction: html })}
            placeholder="Write a captivating introduction for your story..."
          />
        </section>

        {/* Story Foundation: Backstory, Greeting, Custom Instructions */}
        <section id="editor-story" className={sectionClass}>
          <h2 className="text-xl font-bold flex items-center gap-3"><BookOpen className="text-emerald-400" /> Story Foundation</h2>
          <div>
            {labelRow('Main Backstory & World Details', <AIEnhanceButton field="backstory" label="Backstory" value={scenario.backstory} onChange={v => updateScenario({ backstory: v })} context={enhanceContext} />, 'scenario-backstory')}
            <AutoTextarea id="scenario-backstory" minRows={10} className={`${inputClass} font-serif text-lg leading-relaxed ${errors.backstory ? 'ring-1 ring-red-500 border-red-500/60' : ''}`} placeholder="Describe the environment, the history, and the current situation. Use {{user}} to refer to the player's character." value={scenario.backstory} onChange={v => { updateScenario({ backstory: v }); if (errors.backstory) setErrors(p => ({ ...p, backstory: undefined })); }} />
            {errors.backstory && <p className="text-xs text-red-400 mt-1">{errors.backstory}</p>}
            <p className="text-[11px] text-zinc-600 mt-1">Sent to the AI with every reply. Use <strong className="text-zinc-400">{'{{user}}'}</strong> for the player's persona name.</p>
          </div>
          <div>
            {labelRow('Greeting Message', <AIEnhanceButton field="greeting" label="Greeting Message" value={scenario.greetingMessage || ''} onChange={v => updateScenario({ greetingMessage: v })} context={enhanceContext} />, 'scenario-greeting')}
            <AutoTextarea id="scenario-greeting" minRows={5} className={`${inputClass} text-sm text-zinc-300`} placeholder="The first message sent to the player. Set the tone here." value={scenario.greetingMessage} onChange={v => updateScenario({ greetingMessage: v })} />
            <p className="text-[11px] text-zinc-600 mt-1">Becomes the AI's first message in every new chat.</p>
          </div>
          <div>
            {labelRow('Custom AI Instructions', <AIEnhanceButton field="customInstructions" label="Custom AI Instructions" value={scenario.customInstructions || ''} onChange={v => updateScenario({ customInstructions: v })} context={enhanceContext} />, 'scenario-instructions')}
            <AutoTextarea id="scenario-instructions" minRows={4} className={`${inputClass} text-sm text-zinc-300`} placeholder="Special rules for the AI (e.g., 'Joe always speaks in rhymes')" value={scenario.customInstructions} onChange={v => updateScenario({ customInstructions: v })} />
            <p className="text-[11px] text-zinc-600 mt-1">Sent to the AI with every reply. The site's global rules still take priority.</p>
          </div>
        </section>

        {/* Cast of Characters */}
        <section id="editor-cast" className={sectionClass}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold flex items-center gap-3"><UserPlus className="text-violet-400" /> Cast of Characters</h2>
            <button onClick={addCharacter} className="bg-indigo-600/10 text-indigo-300 border border-indigo-600/20 px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-600/20 transition-colors">
              <Plus size={16} /> Add NPC
            </button>
          </div>
          <p className="text-xs text-zinc-500">Every character's name, role and personality are sent to the AI with every reply. The AI plays all of them; it never plays the player's persona.</p>
          <div className="space-y-4">
            {scenario.characters.map(char => (
              <div key={char.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {/* Character avatar */}
                    <div className="w-12 h-12 flex-shrink-0 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center relative overflow-hidden group/npc">
                      {char.avatar ? <img src={char.avatar} className="w-full h-full object-cover" alt="" /> : <UserPlus size={20} className="text-zinc-700" />}
                      <label className="absolute inset-0 bg-black/60 opacity-0 group-hover/npc:opacity-100 group-focus-within/npc:opacity-100 pointer-coarse:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                        <Upload size={14} className="text-white" />
                        <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const base64 = await fileToBase64(file); updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, avatar: base64 } : c) }); } }} />
                      </label>
                    </div>
                    <input aria-label="Character name" placeholder="Character name" className="bg-transparent text-xl font-bold text-white outline-none focus:border-b border-indigo-500 flex-1 min-w-0" value={char.name} onChange={e => {
                      const newName = e.target.value;
                      if (newName.toLowerCase() === '{{user}}') {
                        showToast('"{{user}}" is a reserved placeholder and cannot be used as a character name.', 'error');
                        return;
                      }
                      updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, name: newName } : c) });
                    }} />
                  </div>
                  <button onClick={() => updateScenario({ characters: scenario.characters.filter(c => c.id !== char.id) })} className="text-zinc-600 hover:text-red-500 p-2" title="Remove character" aria-label="Remove character"><Trash2 size={18} /></button>
                </div>
                <div>
                  {labelRow('Role & Appearance', <AIEnhanceButton field="characterDescription" label={`${char.name || 'Character'}: Role & Appearance`} value={char.description || ''} onChange={v => updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, description: v } : c) })} context={enhanceContext} />, undefined, true)}
                  <AutoTextarea minRows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="Who they are and what they look like" value={char.description} onChange={v => updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, description: v } : c) })} />
                </div>
                <div>
                  {labelRow('Personality & Mannerisms', <AIEnhanceButton field="characterPersonality" label={`${char.name || 'Character'}: Personality`} value={char.personality || ''} onChange={v => updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, personality: v } : c) })} context={enhanceContext} />, undefined, true)}
                  <AutoTextarea minRows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="How they think, speak and behave" value={char.personality} onChange={v => updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, personality: v } : c) })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                  <TraitsInput traits={char.traits} onChange={traits => updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, traits } : c) })} />
                  <label className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase cursor-pointer pb-2" title="The AI still plays them; other players do not see them unless you allow customization">
                    <input type="checkbox" checked={!!char.hidden} onChange={e => updateScenario({ characters: scenario.characters.map(c => c.id === char.id ? { ...c, hidden: e.target.checked } : c) })} /> Hidden from players
                  </label>
                </div>
              </div>
            ))}
            {scenario.characters.length === 0 && (
              <div className="text-center py-10 border border-dashed border-zinc-800 rounded-2xl">
                <p className="text-zinc-600 text-sm">Every good story needs characters. Add some NPCs!</p>
              </div>
            )}
          </div>
        </section>

        {/* World Lore */}
        <section id="editor-lore" className={sectionClass}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold flex items-center gap-3"><Brain className="text-indigo-400" /> World Lore</h2>
            <div className="flex flex-wrap justify-end gap-2">
              {scenario.lorePieces.length > 0 && (
                <button onClick={() => setShowLoreFix(true)} className="bg-indigo-600/10 text-indigo-300 border border-indigo-600/20 px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-600/20 transition-colors" title="Find and fix lore that never reaches the AI">
                  <Stethoscope size={16} /> Check &amp; Fix
                </button>
              )}
              <button onClick={() => setShowLoreSuggest(true)} className="bg-indigo-600/10 text-indigo-300 border border-indigo-600/20 px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-600/20 transition-colors" title="Let the AI propose lore cards from your story">
                <Sparkles size={16} /> Suggest Lore
              </button>
              <button onClick={addLorePiece} className="bg-indigo-600/10 text-indigo-300 border border-indigo-600/20 px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-600/20 transition-colors">
                <Plus size={16} /> Add Lore
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            "Always" pieces are sent every turn (up to 10). Triggered pieces are sent when a trigger word appears as a
            whole word in the last few messages (up to 5 at a time). Higher priority wins when there are too many.
          </p>
          <div className="space-y-4">
            {scenario.lorePieces.map(piece => (
              <div key={piece.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <input aria-label="Lore title" placeholder="Lore title" className="bg-transparent text-lg font-bold text-white outline-none focus:border-b border-indigo-500 flex-1 min-w-0" value={piece.title} onChange={e => { updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, title: e.target.value } : p) }); }} />
                  <button onClick={() => removeLorePiece(piece.id)} className="text-zinc-600 hover:text-red-500 p-2" title="Remove lore" aria-label="Remove lore"><Trash2 size={16} /></button>
                </div>
                {loreBadges(piece).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 -mt-2">
                    {loreBadges(piece).map(b => (
                      <button key={b} onClick={() => setShowLoreFix(true)} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/20" title="Open Check & Fix">
                        {b}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-3">
                  <div className="w-14 h-14 flex-shrink-0 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center relative overflow-hidden group/lore">
                    {piece.avatar ? <img src={piece.avatar} className="w-full h-full object-cover" alt="" /> : <ImageIcon size={18} className="text-zinc-700" />}
                    <label className="absolute inset-0 bg-black/60 opacity-0 group-hover/lore:opacity-100 group-focus-within/lore:opacity-100 pointer-coarse:opacity-100 flex items-center justify-center cursor-pointer transition-opacity" title="Picture">
                      <Upload size={14} className="text-white" />
                      <input type="file" accept="image/*" className="hidden" aria-label="Lore picture" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const base64 = await fileToBase64(file); updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, avatar: base64 } : p) }); } }} />
                    </label>
                  </div>
                  <div className="flex-1 min-w-0">
                    <TraitsInput traits={piece.traits} onChange={traits => updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, traits } : p) })} />
                  </div>
                </div>
                {labelRow('Content', <AIEnhanceButton field="loreContent" label={piece.title || 'Lore'} value={piece.content} onChange={v => updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, content: v } : p) })} context={enhanceContext} />, undefined, true)}
                <AutoTextarea minRows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="Describe this location, object, or event..." value={piece.content} onChange={v => updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, content: v } : p) })} />
                {/* How this lore reaches the AI: one mode instead of three checkboxes */}
                <div className="flex flex-wrap items-end gap-4">
                  <label className="text-[10px] font-black text-zinc-500 uppercase">
                    <span className="block mb-1">Sent to the AI</span>
                    <select
                      className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-300 normal-case font-normal"
                      value={piece.pinned ? 'pinned' : piece.smartActivation ? 'triggered' : 'off'}
                      onChange={e => {
                        const mode = e.target.value;
                        updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, pinned: mode === 'pinned', smartActivation: mode === 'triggered' } : p) });
                      }}
                    >
                      <option value="triggered">When a trigger word comes up</option>
                      <option value="pinned">Always</option>
                      <option value="off">Never (draft)</option>
                    </select>
                  </label>
                  <label className="text-[10px] font-black text-zinc-500 uppercase">
                    <span className="block mb-1">Priority</span>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
                      value={piece.weight ?? 100}
                      onChange={e => {
                        const weight = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                        updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, weight } : p) });
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase cursor-pointer pb-1.5" title="The AI still uses it; other players cannot read it unless you allow customization">
                    <input
                      type="checkbox"
                      checked={!!piece.hidden}
                      onChange={e => updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, hidden: e.target.checked } : p) })}
                    /> Hidden from players
                  </label>
                </div>
                {/* Trigger words input (only shown for smart-activated lore) */}
                {piece.smartActivation && (
                  <div>
                    <label className="text-[10px] font-black text-zinc-500 uppercase mb-1 block">Trigger Words (comma-separated, press Enter to add)</label>
                    {(piece.triggers || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {(piece.triggers || []).map(t => (
                          <span key={t} className="bg-amber-600/10 text-amber-400 border border-amber-600/20 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1">
                            {t}
                            <button onClick={() => updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, triggers: (p.triggers || []).filter(x => x !== t) } : p) })} aria-label={`Remove trigger ${t}`}><X size={10} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="e.g. forest, dark, shadows"
                      value={triggerInputs[piece.id] || ''}
                      onChange={e => setTriggerInputs(prev => ({ ...prev, [piece.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTriggers(piece.id); } }}
                      onBlur={() => commitTriggers(piece.id)}
                    />
                  </div>
                )}
                {/* Linked lore: sent along whenever this piece is sent */}
                {scenario.lorePieces.length > 1 && (
                  <div>
                    <label className="text-[10px] font-black text-zinc-500 uppercase mb-1 block" htmlFor={`link-${piece.id}`}>Also send with this piece</label>
                    {(piece.linkedPieces || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {piece.linkedPieces.map(id => {
                          const linked = scenario.lorePieces.find(p => p.id === id);
                          if (!linked) return null;
                          return (
                            <span key={id} className="bg-indigo-600/10 text-indigo-300 border border-indigo-600/20 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1">
                              {linked.title || 'Untitled lore'}
                              <button onClick={() => updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, linkedPieces: p.linkedPieces.filter(x => x !== id) } : p) })} aria-label={`Unlink ${linked.title || 'lore'}`}><X size={10} /></button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <select
                      id={`link-${piece.id}`}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
                      value=""
                      onChange={e => {
                        const id = e.target.value;
                        if (id) updateScenario({ lorePieces: scenario.lorePieces.map(p => p.id === piece.id ? { ...p, linkedPieces: [...new Set([...(p.linkedPieces || []), id])] } : p) });
                      }}
                    >
                      <option value="">Add a linked piece…</option>
                      {scenario.lorePieces.filter(p => p.id !== piece.id && !(piece.linkedPieces || []).includes(p.id)).map(p => (
                        <option key={p.id} value={p.id}>{p.title || 'Untitled lore'}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-zinc-600 mt-1">Linked pieces go to the AI right after this one (a "Never" piece can exist just to be linked). They count toward the same limit.</p>
                  </div>
                )}
              </div>
            ))}
            {scenario.lorePieces.length === 0 && (
              <div className="text-center py-10 border border-dashed border-zinc-800 rounded-2xl">
                <p className="text-zinc-600 text-sm">Lore cards hold places, factions, items and history the AI can draw on.</p>
              </div>
            )}
          </div>
        </section>

        {/* Settings & Publishing: all switches live here, after the content */}
        <section id="editor-settings" className={sectionClass}>
          <h2 className="text-xl font-bold flex items-center gap-3"><SettingsIcon className="text-zinc-400" /> Settings & Publishing</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Sharing & Privacy</h3>
              <SettingToggle label="Public Scenario" hint="Visible in Explore" checked={!!scenario.settings.isPublic} onChange={v => updateSettings({ isPublic: v })} />
              <SettingToggle label="Allow Customization" hint="Others can remix" checked={!!scenario.settings.allowCustomization} onChange={v => updateSettings({ allowCustomization: v })} />
              <SettingToggle label="Hide Prompts" hint="Others can't read backstory or lore" checked={!!scenario.settings.hidePrompts} onChange={v => updateSettings({ hidePrompts: v })} />
              <SettingToggle label="Mature Content" hint="18+ label" color="bg-red-600" checked={!!scenario.settings.sensitiveContent} onChange={v => updateSettings({ sensitiveContent: v })} />
            </div>
            <div className="space-y-4">
              <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">AI Instructions</h3>
              <SettingToggle label="*Action* / &quot;Dialogue&quot; Style" hint="Ask the AI for this formatting" checked={scenario.settings.asteriskFormatting !== false} onChange={v => updateSettings({ asteriskFormatting: v })} />
              <SettingToggle label="Send Introduction to AI" hint="Otherwise only players see it" checked={!!scenario.settings.sendIntroduction} onChange={v => updateSettings({ sendIntroduction: v })} />

              {/* Visibility summary */}
              <div className="flex items-center gap-3 p-4 mt-2 bg-zinc-950 rounded-2xl border border-zinc-800">
                {scenario.settings.isPublic ? <Globe className="text-emerald-500" size={24} /> : <Lock className="text-amber-500" size={24} />}
                <div>
                  <p className="text-sm font-bold text-white">{scenario.settings.isPublic ? 'Public Story' : 'Private Draft'}</p>
                  <p className="text-[11px] text-zinc-500">{scenario.settings.isPublic ? 'Anyone can play and find this' : 'Only you can see this'}</p>
                </div>
              </div>
              {/* Warning for public scenarios without a cover image */}
              {scenario.settings.isPublic && !scenario.image && (
                <div className="p-3 bg-amber-900/20 border border-amber-600/30 rounded-xl">
                  <p className="text-xs font-bold text-amber-400">⚠ A cover image is required for public scenarios. Upload one above or switch to Private.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Save bar: stays at the bottom of the screen (above the phone navbar) */}
      <div className="sticky bottom-16 md:bottom-0 z-30 -mx-4 mt-8 px-4 py-3 bg-zinc-950/90 backdrop-blur border-t border-zinc-800/60">
        <div className="flex items-center justify-end gap-3">
          <span className={`mr-auto flex items-center gap-2 text-xs ${dirty ? 'text-amber-400' : 'text-zinc-600'}`} aria-live="polite">
            <span className={`w-2 h-2 rounded-full ${dirty ? 'bg-amber-400' : 'bg-zinc-700'}`} />
            {dirty ? 'Unsaved changes' : 'No unsaved changes'}
          </span>
          <button onClick={leaveEditor} className="px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-900/20 transition-all active:scale-95"
          >
            <Save size={18} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Lore health for this draft */}
      <LoreFixModal
        isOpen={showLoreFix}
        onClose={() => setShowLoreFix(false)}
        scenario={scenario}
        onChange={changes => updateScenario(changes)}
      />

      {/* AI lore suggestions for this draft */}
      <LoreSuggestModal
        isOpen={showLoreSuggest}
        onClose={() => setShowLoreSuggest(false)}
        getDraft={loreSuggestDraft}
        onAdd={addSuggestedLore}
      />

      {/* AI Scenario Generator Modal */}
      <AIGeneratorModal
        isOpen={showAiGenerator}
        onClose={() => setShowAiGenerator(false)}
        onScenarioGenerated={handleAiGenerated}
      />
    </div>
  );
};

/** Sections listed in the editor's sticky navigation */
const EDITOR_SECTIONS = [
  { id: 'editor-basics', label: 'Basics' },
  { id: 'editor-intro', label: 'Introduction' },
  { id: 'editor-story', label: 'Story' },
  { id: 'editor-cast', label: 'Cast' },
  { id: 'editor-lore', label: 'Lore' },
  { id: 'editor-settings', label: 'Settings' },
];

/** Textarea that grows with its content, so long text never hides behind a scrollbar */
const AutoTextarea: React.FC<{
  value: string | undefined;
  onChange: (value: string) => void;
  minRows?: number;
  className?: string;
  placeholder?: string;
  id?: string;
}> = ({ value, onChange, minRows = 3, className = '', placeholder, id }) => {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      rows={minRows}
      className={`${className} resize-none overflow-hidden`}
      placeholder={placeholder}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
    />
  );
};

/** On/off switch for the editor's settings section */
const SettingToggle: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  color?: string;
}> = ({ label, hint, checked, onChange, color = 'bg-indigo-600' }) => (
  <div className="flex items-center justify-between gap-3">
    <div>
      <h4 className="text-sm font-bold text-zinc-300">{label}</h4>
      <p className="text-[10px] text-zinc-500 uppercase font-black">{hint}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`w-10 h-5 flex-shrink-0 rounded-full relative transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${checked ? color : 'bg-zinc-800'}`}
    >
      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${checked ? 'right-1' : 'left-1'}`} />
    </button>
  </div>
);
