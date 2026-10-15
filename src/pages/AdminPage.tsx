/**
 * ─── Admin Panel Page ───
 *
 * Three-tab admin interface available only to users with role 'admin'.
 * Non-admin users are redirected to '/' on mount.
 *
 * Tabs:
 *   1. System   — DeepSeek API Key management + Site Branding (site name)
 *   2. LLM Config — Global LLM instructions, temperature, max tokens, response length
 *                   tokens, frequency/presence penalties, and memory
 *                   management (send interval, generate interval, word count, max count)
 *   3. Users    — Renders the <UserEditor> component for user CRUD operations
 *
 * All settings are saved server-side via apiService.updateSystemSettings()
 * and loaded on mount via apiService.getSystemSettings().
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Key, Shield, BookOpen, Thermometer, Save, CheckCircle,
  ExternalLink, AlignLeft, Brain, ChevronLeft, Users,
  Settings, Cpu, RefreshCw, Loader, Bug, Terminal
} from 'lucide-react';
import { apiService } from '../services/api';
import { useNotifications } from '../utils/notifications';
import { UserEditor } from '../components/UserEditor';

/** Fallback instructions template used if nothing is saved */
const DEFAULT_GLOBAL_INSTRUCTIONS = `Maintain immersive roleplay, focusing on sensory details and character consistency. Always write in the style of literary fiction, balancing dialogue, action, and internal monologue.`;

type AdminTab = 'settings' | 'llm' | 'users';

export const AdminPage: React.FC = () => {
  const { showToast } = useNotifications();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>('settings');
  const [isAdmin, setIsAdmin] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [siteNameSaved, setSiteNameSaved] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [debugSaved, setDebugSaved] = useState(false);

  // ─── System settings ───
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [siteName, setSiteName] = useState('');
  const [rateLimitMax, setRateLimitMax] = useState('1000');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [debugLlmPrompt, setDebugLlmPrompt] = useState(false);

  // ─── LLM settings ───
  const [globalInstructions, setGlobalInstructions] = useState('');
  const [temperature, setTemperature] = useState('1.0');
  const [maxTokens, setMaxTokens] = useState('4096');
  const [tokenShort, setTokenShort] = useState('300');
  const [tokenMedium, setTokenMedium] = useState('800');
  const [tokenLong, setTokenLong] = useState('2000');
  // Context and lore engine (server-side prompt builder)
  const [contextTokenBudget, setContextTokenBudget] = useState('32000');
  const [loreScanDepth, setLoreScanDepth] = useState('10');
  const [loreActiveMax, setLoreActiveMax] = useState('5');
  const [lorePinnedMax, setLorePinnedMax] = useState('10');
  const [memoryGenerateInterval, setMemoryGenerateInterval] = useState('25');
  const [memoryWordCount, setMemoryWordCount] = useState('100');
  const [memoryMaxCount, setMemoryMaxCount] = useState('50');
  const [memoryPinnedMax, setMemoryPinnedMax] = useState('10');
  const [frequencyPenalty, setFrequencyPenalty] = useState('0');
  const [presencePenalty, setPresencePenalty] = useState('0');
  const [deepseekModel, setDeepseekModel] = useState('deepseek-flash');
  /** '' = model default, 'off', or a thinking effort level */
  const [deepseekThinking, setDeepseekThinking] = useState('');
  /** Model for memories and the scenario generator ('' = same as the chat model) */
  const [utilityModel, setUtilityModel] = useState('');
  const [utilityTemperature, setUtilityTemperature] = useState('0.5');
  /** Stop a reply when the AI starts a line for the player */
  const [stopOnPlayerLines, setStopOnPlayerLines] = useState(true);
  /** Extra stop sequences, one per line */
  const [stopSequences, setStopSequences] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ id: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  /** On mount: check admin role, load all saved settings */
  useEffect(() => {
    const user = apiService.getCurrentUser();
    if (user?.role !== 'admin') {
      navigate('/');
      return;
    }
    setIsAdmin(true);

    const loadSettings = async () => {
      try {
        const settings = await apiService.getSystemSettings();
        // Only a masked form of the stored key is returned (e.g. "sk-…abcd")
        setMaskedKey(settings.deepseekKeySet ? settings.deepseekKey || 'set' : '');
        setGlobalInstructions(settings.globalInstructions || DEFAULT_GLOBAL_INSTRUCTIONS);
        setTemperature(settings.temperature || '1.0');
        setMaxTokens(settings.maxTokens || '4096');
        setTokenShort(settings.tokenShort || '300');
        setTokenMedium(settings.tokenMedium || '800');
        setTokenLong(settings.tokenLong || '2000');
        setFrequencyPenalty(settings.frequencyPenalty || '0');
        setPresencePenalty(settings.presencePenalty || '0');
        setSiteName(settings.siteName || '');
        setContextTokenBudget(settings.contextTokenBudget || '32000');
        setLoreScanDepth(settings.loreScanDepth || '10');
        setLoreActiveMax(settings.loreActiveMax || '5');
        setLorePinnedMax(settings.lorePinnedMax || '10');
        setMemoryGenerateInterval(settings.memoryGenerateInterval || '25');
        setMemoryWordCount(settings.memoryWordCount || '100');
        setMemoryMaxCount(settings.memoryMaxCount || '50');
        setMemoryPinnedMax(settings.memoryPinnedMax || '10');
        setRateLimitMax(settings.rateLimitMax || '1000');
        setRegistrationOpen(settings.registrationOpen !== false);
        setDeepseekModel(settings.deepseekModel || 'deepseek-flash');
        setDeepseekThinking(settings.deepseekThinking || '');
        setUtilityModel(settings.utilityModel || '');
        setUtilityTemperature(settings.utilityTemperature || '0.5');
        setStopOnPlayerLines(settings.stopOnPlayerLines !== false);
        setStopSequences(settings.stopSequences || '');
        setDebugLlmPrompt(settings.debugLlmPrompt === 'true');
      } catch (e) {
        console.error('Failed to load settings', e);
      }
    };
    loadSettings();
  }, [navigate]);

  /** Fetch available model IDs from DeepSeek API */
  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const data = await apiService.getDeepseekModels();
      if (data?.data && Array.isArray(data.data)) {
        setAvailableModels(data.data);
      } else {
        showToast('No models returned from DeepSeek API', 'error');
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
      showToast('Failed to fetch available models. Check API key.', 'error');
    } finally {
      setLoadingModels(false);
    }
  };

  /** Fetch models when switching to the LLM tab */
  useEffect(() => {
    if (activeTab === 'llm') {
      fetchModels();
    }
  }, [activeTab]);

  /** Save only the DeepSeek API key (the stored key is never sent back to the browser) */
  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      showToast('Enter a new API key to replace the current one', 'info');
      return;
    }
    try {
      await apiService.updateSystemSettings({ deepseekKey: apiKey.trim() });
      setMaskedKey(`${apiKey.trim().slice(0, 3)}…${apiKey.trim().slice(-4)}`);
      setApiKey('');
      setApiKeySaved(true);
      setTimeout(() => setApiKeySaved(false), 3000);
      showToast('API key saved', 'success');
    } catch (err) {
      console.error('Failed to save API key:', err);
      showToast('Failed to save API key', 'error');
    }
  };

  /** Save site name + rate limit + update localStorage + document.title immediately */
  const handleSaveSiteName = async () => {
    try {
      await apiService.updateSystemSettings({ siteName, rateLimitMax, registrationOpen });
      localStorage.setItem('fl_siteName', siteName);
      document.title = siteName || 'AI Roleplay';
      setSiteNameSaved(true);
      setTimeout(() => setSiteNameSaved(false), 3000);
      showToast('Settings saved', 'success');
    } catch (err) {
      console.error('Failed to save settings:', err);
      showToast('Failed to save settings', 'error');
    }
  };

  /** Save the debug toggle setting */
  const handleSaveDebug = async () => {
    try {
      await apiService.updateSystemSettings({ debugLlmPrompt });
      setDebugSaved(true);
      setTimeout(() => setDebugSaved(false), 3000);
      showToast('Debug setting saved', 'success');
    } catch (err) {
      console.error('Failed to save debug setting:', err);
      showToast('Failed to save debug setting', 'error');
    }
  };

  /** Save all LLM parameters at once */
  const handleSaveLlmSettings = async () => {
    try {
      await apiService.updateSystemSettings({
        globalInstructions, temperature, maxTokens, tokenShort, tokenMedium, tokenLong,
        frequencyPenalty, presencePenalty, siteName,
        memoryGenerateInterval, memoryWordCount, memoryMaxCount, memoryPinnedMax,
        contextTokenBudget, loreScanDepth, loreActiveMax, lorePinnedMax,
        deepseekModel,
        deepseekThinking,
        utilityModel, utilityTemperature, stopOnPlayerLines, stopSequences,
      });
      setLlmSaved(true);
      setTimeout(() => setLlmSaved(false), 3000);
      showToast('Settings saved', 'success');
    } catch (err) {
      console.error('Failed to save LLM settings:', err);
      showToast('Failed to save settings', 'error');
    }
  };

  /** Tab definitions */
  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'settings', label: 'System', icon: <Settings size={16} /> },
    { id: 'llm', label: 'LLM Config', icon: <Cpu size={16} /> },
    { id: 'users', label: 'Users', icon: <Users size={16} /> },
  ];

  if (!isAdmin) return null;

  return (
    <div className="pb-24 pt-4 px-4 max-w-3xl mx-auto space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-2 text-zinc-400 hover:text-white transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Panel</h1>
          <p className="text-zinc-500 text-sm">Manage system settings, LLM configuration, and users</p>
        </div>
      </div>

      {/* ─── Tab Bar ─── */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: System Settings (API Key + Site Name) ─── */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* DeepSeek API Key */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-indigo-600/20 text-indigo-500 rounded-lg">
                <Key size={20} />
              </div>
              <h2 className="text-xl font-bold text-white">DeepSeek API Key</h2>
            </div>
            <div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-20"
                    placeholder={maskedKey ? `Current key: ${maskedKey} (type a new key to replace it)` : 'sk-...'}
                    aria-label="DeepSeek API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-600 hover:text-zinc-400"
                  >
                    {showKey ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
                <button
                  onClick={handleSaveKey}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 rounded-xl font-bold transition-all flex items-center gap-2"
                >
                  {apiKeySaved ? <CheckCircle size={20} /> : <Save size={20} />}
                  {apiKeySaved ? 'Saved' : 'Save'}
                </button>
              </div>
              <p className="mt-3 text-xs text-zinc-500 flex items-center gap-2">
                <Shield size={12} />
                This key is stored securely on the server and used by all users.
              </p>
              <a
                href="https://platform.deepseek.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-xs text-indigo-400 font-bold hover:underline"
              >
                Get a DeepSeek API Key <ExternalLink size={12} />
              </a>
            </div>
          </section>

          {/* Site Branding */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-sky-600/20 text-sky-500 rounded-lg">
                <BookOpen size={20} />
              </div>
              <h2 className="text-xl font-bold text-white">Site Branding</h2>
            </div>
            <div>
              <label className="block text-sm font-bold text-zinc-400 mb-2">Site Name</label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="AI Roleplay"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />
              <p className="mt-2 text-xs text-zinc-500 italic">
                This name is displayed on the home page and as the browser tab title.
              </p>
            </div>
            <div>
              <label className="block text-sm font-bold text-zinc-400 mb-2">API Rate Limit (requests per 15 min)</label>
              <input
                type="number"
                min="10"
                max="10000"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="1000"
                value={rateLimitMax}
                onChange={(e) => setRateLimitMax(e.target.value)}
              />
              <p className="mt-2 text-xs text-zinc-500 italic">
                Maximum API requests per 15-minute window for non-admin users. Admins are not rate-limited.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-bold text-zinc-300" id="registration-open-label">Allow New Sign-ups</p>
                <p className="text-xs text-zinc-500 mt-1">
                  When off, the registration page refuses new accounts. Existing users can still log in, and
                  admins can still create accounts in User Management.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={registrationOpen}
                aria-labelledby="registration-open-label"
                onClick={() => setRegistrationOpen(!registrationOpen)}
                className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ml-4 ${
                  registrationOpen ? 'bg-indigo-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                    registrationOpen ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <button
              onClick={handleSaveSiteName}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
            >
              {siteNameSaved ? <CheckCircle size={20} /> : <Save size={20} />}
              {siteNameSaved ? 'Saved' : 'Save Settings'}
            </button>
          </section>

          {/* LLM Debug Logging */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-rose-600/20 text-rose-500 rounded-lg">
                <Bug size={20} />
              </div>
              <h2 className="text-xl font-bold text-white">LLM Debug Logging</h2>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-bold text-zinc-300">Log LLM Prompt Payloads to Terminal</p>
                <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                  <Terminal size={12} />
                  When enabled, every prompt sent to DeepSeek (full system instructions, conversation history,
                  lore, memories, and LLM parameters) will be printed to the server terminal for debugging.
                  Only applies to requests made by admin users.
                </p>
              </div>
              <button
                onClick={() => setDebugLlmPrompt(!debugLlmPrompt)}
                className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ml-4 ${
                  debugLlmPrompt ? 'bg-rose-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                    debugLlmPrompt ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <button
              onClick={handleSaveDebug}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
            >
              {debugSaved ? <CheckCircle size={20} /> : <Save size={20} />}
              {debugSaved ? 'Saved' : 'Save Debug Setting'}
            </button>
          </section>
        </div>
      )}

      {/* ─── Tab: LLM Config ─── */}
      {activeTab === 'llm' && (
        <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
          {/* Global Instructions */}
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-600/20 text-emerald-500 rounded-lg">
              <BookOpen size={20} />
            </div>
            <h2 className="text-xl font-bold text-white">Global LLM Instructions</h2>
          </div>
          <div>
            <label className="block text-sm font-bold text-zinc-400 mb-2">
              Default Template (applied to all chats unless overridden)
            </label>
            <textarea
              value={globalInstructions}
              onChange={(e) => setGlobalInstructions(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[200px] font-mono leading-relaxed"
              placeholder={DEFAULT_GLOBAL_INSTRUCTIONS}
            />
          </div>

          {/* DeepSeek Model Selection */}
          <div className="border-t border-zinc-800 pt-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-600/20 text-indigo-500 rounded-lg">
                <Cpu size={20} />
              </div>
              <h3 className="text-lg font-bold text-white">AI Model</h3>
            </div>
            <div>
              <label className="block text-sm font-bold text-zinc-400 mb-2">DeepSeek Model</label>
              <div className="flex gap-2">
                <select
                  value={deepseekModel}
                  onChange={(e) => setDeepseekModel(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
                >
                  {availableModels.length > 0 ? (
                    availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.id}</option>
                    ))
                  ) : (
                    <>
                      <option value="deepseek-flash">deepseek-flash</option>
                      <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                      {!['deepseek-flash', 'deepseek-v4-pro'].includes(deepseekModel) && (
                        <option value={deepseekModel}>{deepseekModel}</option>
                      )}
                    </>
                  )}
                </select>
                <button
                  onClick={fetchModels}
                  disabled={loadingModels}
                  className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-4 rounded-xl font-bold transition-all flex items-center gap-2"
                  title="Refresh model list from DeepSeek API"
                >
                  {loadingModels ? <Loader size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                The model that writes chat replies. Refresh fetches the models your API key can use. deepseek-flash is fast and
                cheap; deepseek-v4-pro writes better but costs more. The older names deepseek-chat and deepseek-reasoner were
                scheduled for retirement by DeepSeek in July 2026.
              </p>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-bold text-zinc-400 mb-2" htmlFor="utility-model">Background model</label>
              <select
                id="utility-model"
                value={utilityModel}
                onChange={(e) => setUtilityModel(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
              >
                <option value="">Same as the chat model</option>
                {(availableModels.length > 0 ? availableModels.map(m => m.id) : ['deepseek-flash', 'deepseek-v4-pro'])
                  .concat(utilityModel && !availableModels.some(m => m.id === utilityModel) && !['deepseek-flash', 'deepseek-v4-pro'].includes(utilityModel) ? [utilityModel] : [])
                  .map(id => <option key={id} value={id}>{id}</option>)}
              </select>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                Used for work players do not read directly: memory summaries and the AI scenario generator. A cheaper model
                such as deepseek-flash is usually good enough here, even when chats use deepseek-v4-pro.
              </p>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-bold text-zinc-400 mb-2" htmlFor="thinking-mode">Thinking (reasoning) mode</label>
              <select
                id="thinking-mode"
                value={deepseekThinking}
                onChange={(e) => setDeepseekThinking(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
              >
                <option value="">Model default (send nothing)</option>
                <option value="off">Off: faster, uses temperature and penalties</option>
                <option value="low">On, low effort</option>
                <option value="high">On, high effort</option>
                <option value="max">On, maximum effort</option>
              </select>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                <strong className="text-zinc-400">Off is recommended for roleplay:</strong> replies start sooner, cost less, and
                Continue can pick up exactly where a reply stopped. With thinking on, the model reasons before it writes: slower,
                more tokens, and it ignores temperature and the penalties (the reply budget is raised to leave room for the
                reasoning). "Model default" sends nothing and lets DeepSeek decide; deepseek-flash then thinks.
              </p>
            </div>
          </div>

          {/* LLM Parameters */}
          <div className="border-t border-zinc-800 pt-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-600/20 text-amber-500 rounded-lg">
                <Thermometer size={20} />
              </div>
              <h3 className="text-lg font-bold text-white">LLM Parameters</h3>
            </div>

            {/* Temperature slider */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-zinc-400 mb-2">Temperature: {temperature}</label>
              <input type="range" min="0" max="2" step="0.1" value={temperature}
                onChange={(e) => setTemperature(e.target.value)} className="w-full accent-indigo-500" />
              <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                <span>Precise (0)</span><span>Creative (2)</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                How adventurous the wording is. <strong className="text-zinc-400">0.8–1.2 suits roleplay.</strong> Lower is
                safer and more predictable; above about 1.3 replies start to ramble or fall apart. Ignored while thinking is on.
              </p>
            </div>

            {/* Background temperature */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-zinc-400 mb-2" htmlFor="utility-temperature">Background temperature: {utilityTemperature}</label>
              <input id="utility-temperature" type="range" min="0" max="2" step="0.1" value={utilityTemperature}
                onChange={(e) => setUtilityTemperature(e.target.value)} className="w-full accent-indigo-500" />
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                Temperature for memory summaries. Low values (about 0.3–0.6) keep summaries factual. The scenario generator
                uses its own setting.
              </p>
            </div>

            {/* Max tokens cap slider */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-zinc-400 mb-2">Max Tokens Cap: {maxTokens}</label>
              <input type="range" min="256" max="8192" step="128" value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)} className="w-full accent-indigo-500" />
              <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                <span>256</span><span>8192</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                Hard ceiling for a single reply, whatever length the player picked. With thinking on, extra room for the
                reasoning is added on top.
              </p>
            </div>

            {/* Response Length Tokens — short/medium/long presets */}
            <div className="border-t border-zinc-800 pt-4 mb-6">
              <label className="block text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
                <AlignLeft size={16} /> Response Length Tokens
              </label>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Short</label>
                  <input type="number" min="50" max="4000" value={tokenShort}
                    onChange={(e) => setTokenShort(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Medium</label>
                  <input type="number" min="50" max="4000" value={tokenMedium}
                    onChange={(e) => setTokenMedium(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Long</label>
                  <input type="number" min="50" max="4000" value={tokenLong}
                    onChange={(e) => setTokenLong(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                Token budget for each chat's Short, Medium and Long reply setting. The AI is asked for about 70% of this in
                words and to finish at a natural stopping point; a reply that still hits the limit can be continued.
              </p>
            </div>

            {/* Stop sequences */}
            <div className="border-t border-zinc-800 pt-4 mb-6">
              <h3 className="text-sm font-bold text-zinc-400 mb-3">Stop Sequences</h3>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={stopOnPlayerLines} onChange={(e) => setStopOnPlayerLines(e.target.checked)} className="mt-1 accent-indigo-500" />
                <span>
                  <span className="block text-sm font-bold text-zinc-300">Stop when the AI starts writing as the player</span>
                  <span className="block text-xs text-zinc-500">
                    Ends the reply as soon as a new line starts with the player's persona name (for example "Rin:"), so the
                    AI cannot take the player's turn.
                  </span>
                </span>
              </label>
              <label className="block text-xs font-bold text-zinc-500 mt-4 mb-1 uppercase tracking-wider" htmlFor="stop-sequences">Extra stop sequences</label>
              <textarea
                id="stop-sequences"
                value={stopSequences}
                onChange={(e) => setStopSequences(e.target.value)}
                rows={3}
                placeholder={'One per line, for example:\n[OOC]\n\\n{{user}} says'}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                The reply stops right before any of these texts (up to 16 in total). Write <code>\n</code> for a line break and
                <code> {'{{user}}'}</code> for the player's persona name. Leave empty if unsure.
              </p>
            </div>

            {/* Frequency & Presence Penalties */}
            <div className="border-t border-zinc-800 pt-4 mb-6">
              <h3 className="text-sm font-bold text-zinc-400 mb-1">Penalty Parameters</h3>
              <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
                <strong className="text-zinc-400">0 is recommended.</strong> Negative values make the AI repeat itself more.
                Small positive values (0.1–0.5) can reduce repeated phrases in long chats; large ones make the wording odd.
                Ignored while thinking is on.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">
                    Frequency Penalty: {frequencyPenalty}
                  </label>
                  <input type="range" min="-2" max="2" step="0.1" value={frequencyPenalty}
                    onChange={(e) => setFrequencyPenalty(e.target.value)} className="w-full accent-indigo-500" />
                  <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                    <span>Repeats words (-2)</span><span>Off (0)</span><span>Avoids repeated words (+2)</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">
                    Presence Penalty: {presencePenalty}
                  </label>
                  <input type="range" min="-2" max="2" step="0.1" value={presencePenalty}
                    onChange={(e) => setPresencePenalty(e.target.value)} className="w-full accent-indigo-500" />
                  <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                    <span>Sticks to what was said (-2)</span><span>Off (0)</span><span>Brings in new things (+2)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Memory Management — auto-memory generation and trimming settings */}
            <div className="border-t border-zinc-800 pt-4 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-purple-600/20 text-purple-500 rounded-lg">
                  <Brain size={18} />
                </div>
                <h3 className="text-lg font-bold text-white">Memory Management</h3>
              </div>
              <p className="text-xs text-zinc-500 mb-4">
                A memory card is written after every "Generate Interval" user messages and summarises everything since the
                previous one. All memories (pinned first, then the newest up to "Max Memories") are sent with every reply.
              </p>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Generate Interval</label>
                  <input type="number" min="1" max="500" value={memoryGenerateInterval}
                    onChange={(e) => setMemoryGenerateInterval(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Target Word Count</label>
                  <input type="number" min="10" max="500" value={memoryWordCount}
                    onChange={(e) => setMemoryWordCount(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Max Memories</label>
                  <input type="number" min="1" max="500" value={memoryMaxCount}
                    onChange={(e) => setMemoryMaxCount(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider" htmlFor="memory-pinned-max">Max Pinned Memories</label>
                  <input id="memory-pinned-max" type="number" min="0" max="100" value={memoryPinnedMax}
                    onChange={(e) => setMemoryPinnedMax(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                Target Word Count is the length of each memory. Max Memories is how many unpinned memories a chat keeps (the
                oldest are dropped). Players can pin up to Max Pinned Memories as "key facts"; pinned ones are never dropped.
              </p>
            </div>

            {/* Context & lore engine */}
            <div className="border-t border-zinc-800 pt-4 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-emerald-600/20 text-emerald-500 rounded-lg">
                  <Cpu size={18} />
                </div>
                <h3 className="text-lg font-bold text-white">Context &amp; Lore</h3>
              </div>
              <p className="text-xs text-zinc-500 mb-4">
                Each reply sends the scenario, lore, memories and as much recent conversation as fits the context budget;
                older messages are covered by memories. A lower budget costs less per message.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider" htmlFor="context-budget">Context Budget (tokens)</label>
                  <input id="context-budget" type="number" min="4000" max="1000000" step="1000" value={contextTokenBudget}
                    onChange={(e) => setContextTokenBudget(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider" htmlFor="lore-scan">Lore Trigger Scan (messages)</label>
                  <input id="lore-scan" type="number" min="1" max="200" value={loreScanDepth}
                    onChange={(e) => setLoreScanDepth(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider" htmlFor="lore-active">Max Triggered Lore</label>
                  <input id="lore-active" type="number" min="0" max="50" value={loreActiveMax}
                    onChange={(e) => setLoreActiveMax(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider" htmlFor="lore-pinned">Max Always-on Lore</label>
                  <input id="lore-pinned" type="number" min="0" max="100" value={lorePinnedMax}
                    onChange={(e) => setLorePinnedMax(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>

            {/* Save all LLM settings */}
            <button
              onClick={handleSaveLlmSettings}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
            >
              {llmSaved ? <CheckCircle size={20} /> : <Save size={20} />}
              {llmSaved ? 'Saved' : 'Save All Settings'}
            </button>
          </div>
        </section>
      )}

      {/* ─── Tab: User Management ─── */}
      {activeTab === 'users' && (
        <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
          <UserEditor />
        </section>
      )}
    </div>
  );
};
