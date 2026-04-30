/**
 * Root Application Component
 * 
 * Sets up the application shell with:
 * - React Router for client-side navigation
 * - Notification system context provider (toast + confirm dialogs)
 * - ErrorBoundary to catch rendering errors gracefully
 * - Auth-aware routing (shows AuthPage for unauthenticated users)
 * - Site name loading from server settings
 * 
 * @module App
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { Home } from './pages/Home';
import { ChatPage } from './pages/ChatPage';
import { CreateScenario } from './pages/CreateScenario';
import { ChatsList } from './pages/ChatsList';
import { SettingsPage } from './pages/SettingsPage';
import { ScenarioDetail } from './pages/ScenarioDetail';
import { AdminPage } from './pages/AdminPage';

import { AuthPage } from './pages/AuthPage';

import { apiService } from './services/api';
import { NotificationProvider } from './utils/notifications';

/**
 * Reads the cached site name from localStorage.
 * Falls back to 'AI Roleplay' if not set.
 */
const getCachedSiteName = (): string => localStorage.getItem('fl_siteName') || 'AI Roleplay';

/**
 * The authenticated application shell.
 * Renders the navigation bar and all authenticated routes.
 * 
 * Routes:
 * - `/` or `/scenarios` → Home (scenario discovery/browsing)
 * - `/scenario/:scenarioId` → Scenario detail page
 * - `/create` → Scenario editor
 * - `/chats` → Chat list/management
 * - `/chat/:chatId` → Active chat session
 * - `/settings` → User settings
 * - `/admin` → Admin panel (protected server-side)
 * 
 * @param siteName - The configured site/brand name
 */
const AuthenticatedApp: React.FC<{ siteName: string }> = ({ siteName }) => {
  return (
    <>
      <Navbar />
      <main className="md:pt-16 pb-16 md:pb-0 flex-1 flex flex-col min-h-0">
        <Routes>
          <Route path="/" element={<Home siteName={siteName} />} />
          <Route path="/scenarios" element={<Home siteName={siteName} />} />
          <Route path="/scenario/:scenarioId" element={<ScenarioDetail />} />
          <Route path="/create" element={<CreateScenario />} />
          <Route path="/chats" element={<ChatsList />} />
          <Route path="/chat/:chatId" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </>
  );
};

/**
 * Core application content component that manages auth state.
 * 
 * - Checks for an existing user session from localStorage
 * - Loads the site name from server settings on mount
 * - Shows AuthPage if no user is logged in
 * - Wraps authenticated content in the app shell layout
 */
const AppContent: React.FC = () => {
  const [user, setUser] = React.useState(apiService.getCurrentUser());
  const [siteName, setSiteName] = React.useState(getCachedSiteName());
  const navigate = useNavigate();

  // Load site name from server on mount (for branding in UI/tab title)
  React.useEffect(() => {
    const loadSiteName = async () => {
      try {
        const settings = await apiService.getLlmSettings();
        if (settings.siteName) {
          setSiteName(settings.siteName);
          localStorage.setItem('fl_siteName', settings.siteName);
          document.title = settings.siteName;
        }
      } catch {
        // Keep using cached value if server is unavailable
      }
    };
    loadSiteName();

    // Listen for auth:unauthorized events (dispatched by api.ts response interceptor)
    // so the app can react to invalid/expired tokens without a full page reload.
    const handleUnauthorized = () => setUser(null);
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  // Show login/register page if not authenticated
  if (!user) {
    return <AuthPage onLogin={() => {
      setUser(apiService.getCurrentUser());
      navigate('/');
    }} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col">
      <AuthenticatedApp siteName={siteName} />
    </div>
  );
};

/**
 * Error boundary component that catches rendering errors anywhere in the tree.
 * Displays a friendly error message with a reload button instead of crashing the app.
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 flex items-center justify-center p-8">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-lg w-full text-center space-y-4">
            <div className="p-3 bg-red-900/20 text-red-500 rounded-xl inline-flex">
              <AlertTriangle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
            <p className="text-zinc-400 text-sm">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold transition-all"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Top-level application component.
 * Wraps everything in Router, NotificationProvider, and ErrorBoundary.
 */
const App: React.FC = () => {
  return (
    <Router>
      <NotificationProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </NotificationProvider>
    </Router>
  );
};

export default App;
