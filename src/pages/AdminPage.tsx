/**
 * ─── Admin Panel Page ───
 *
 * Three-tab admin interface available only to users with role 'admin'.
 * Non-admin users are redirected to '/' on mount.
 *
 * Tabs:
 *   1. System   — DeepSeek API Key management + Site Branding (site name)
 *   2. LLM Config — Global LLM instructions, temperature, max tokens, response length
 *                   tokens, frequency/presence penalties, chat padding, and memory
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
  const [showKey, setShowKey] = useState(false);
  const [siteName, setSiteName] = useState('');
  const [rateLimitMax, setRateLimitMax] = useState('200');
  const [debugLlmPrompt, setDebugLlmPrompt] = useState(false);

  // ─── LLM settings ───
  const [globalInstructions, setGlobalInstructions] = useState('');
  const [temperature, setTemperature] = useState('0.9');
  const [maxTokens, setMaxTokens] = useState('4096');
  const [tokenShort, setTokenShort] = useState('300');
  const [tokenMedium, setTokenMedium] = useState('800');
  const [tokenLong, setTokenLong] = useState('2000');
  const [chatPaddingLeft, setChatPaddingLeft] = useState('16');
  const [chatPaddingRight, setChatPaddingRight] = useState('16');
  const [memorySendInterval, setMemorySendInterval] = useState('25');
  const [memoryGenerateInterval, setMemoryGenerateInterval] = useState('25');
  const [memoryWordCount, setMemoryWordCount] = useState('100');
  const [memoryMaxCount, setMemoryMaxCount] = useState('50');
  const [frequencyPenalty, setFrequencyPenalty] = useState('0');
  const [presencePenalty, setPresencePenalty] = useState('0');
  const [deepseekModel, setDeepseekModel] = useState('deepseek-chat');
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
        setApiKey(settings.deepseekKey || '');
        setGlobalInstructions(settings.globalInstructions || DEFAULT_GLOBAL_INSTRUCTIONS);
        setTemperature(settings.temperature || '0.9');
        setMaxTokens(settings.maxTokens || '4096');
        setTokenShort(settings.tokenShort || '300');
        setTokenMedium(settings.tokenMedium || '800');
        setTokenLong(settings.tokenLong || '2000');
        setChatPaddingLeft(settings.chatPaddingLeft || '16');
        setChatPaddingRight(settings.chatPaddingRight || '16');
        setFrequencyPenalty(settings.frequencyPenalty || '0');
        setPresencePenalty(settings.presencePenalty || '0');
        setSiteName(settings.siteName || '');
        setMemorySendInterval(settings.memorySendInterval || '25');
        setMemoryGenerateInterval(settings.memoryGenerateInterval || '25');
        setMemoryWordCount(settings.memoryWordCount || '100');
        setMemoryMaxCount(settings.memoryMaxCount || '50');
        setRateLimitMax(settings.rateLimitMax || '200');
        setDeepseekModel(settings.deepseekModel || 'deepseek-chat');
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

  /** Save only the DeepSeek API key */
  const handleSaveKey = async () => {
    try {
      await apiService.updateSystemSettings({ deepseekKey: apiKey });
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
      await apiService.updateSystemSettings({ siteName, rateLimitMax });
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
        chatPaddingLeft, chatPaddingRight, frequencyPenalty, presencePenalty, siteName,
        memorySendInterval, memoryGenerateInterval, memoryWordCount, memoryMaxCount,
        deepseekModel,
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
                    placeholder="sk-..."
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
                placeholder="200"
                value={rateLimitMax}
                onChange={(e) => setRateLimitMax(e.target.value)}
              />
              <p className="mt-2 text-xs text-zinc-500 italic">
                Maximum API requests per 15-minute window for non-admin users. Admins are not rate-limited.
              </p>
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
                      <option value="deepseek-chat">deepseek-chat</option>
                      <option value="deepseek-reasoner">deepseek-reasoner</option>
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
                Select which DeepSeek model to use for all AI responses. Click refresh to fetch the latest available models from the DeepSeek API.
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
            </div>

            {/* Max tokens cap slider */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-zinc-400 mb-2">Max Tokens Cap: {maxTokens}</label>
              <input type="range" min="256" max="8192" step="128" value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)} className="w-full accent-indigo-500" />
              <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                <span>256</span><span>8192</span>
              </div>
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
            </div>

            {/* Frequency & Presence Penalties */}
            <div className="border-t border-zinc-800 pt-4 mb-6">
              <h3 className="text-sm font-bold text-zinc-400 mb-3">Penalty Parameters</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">
                    Frequency Penalty: {frequencyPenalty}
                  </label>
                  <input type="range" min="-2" max="2" step="0.1" value={frequencyPenalty}
                    onChange={(e) => setFrequencyPenalty(e.target.value)} className="w-full accent-indigo-500" />
                  <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                    <span>Less repetitive (-2)</span><span>Default (0)</span><span>More varied (+2)</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">
                    Presence Penalty: {presencePenalty}
                  </label>
                  <input type="range" min="-2" max="2" step="0.1" value={presencePenalty}
                    onChange={(e) => setPresencePenalty(e.target.value)} className="w-full accent-indigo-500" />
                  <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                    <span>More focused (-2)</span><span>Default (0)</span><span>New topics (+2)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Chat Padding — left/right token padding for API requests */}
            <div className="border-t border-zinc-800 pt-4 mb-6">
              <label className="block text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
                <AlignLeft size={16} /> Chat Padding (px)
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Left Padding</label>
                  <input type="number" min="0" max="200" value={chatPaddingLeft}
                    onChange={(e) => setChatPaddingLeft(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Right Padding</label>
                  <input type="number" min="0" max="200" value={chatPaddingRight}
                    onChange={(e) => setChatPaddingRight(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase tracking-wider">Send Interval</label>
                  <input type="number" min="1" max="500" value={memorySendInterval}
                    onChange={(e) => setMemorySendInterval(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
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
