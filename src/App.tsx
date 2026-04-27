
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Home } from './pages/Home';
import { ChatPage } from './pages/ChatPage';
import { CreateScenario } from './pages/CreateScenario';
import { ChatsList } from './pages/ChatsList';
import { SettingsPage } from './pages/SettingsPage';
import { ScenarioDetail } from './pages/ScenarioDetail';

import { AuthPage } from './pages/AuthPage';
import { apiService } from './services/api';

const App: React.FC = () => {
  const [user, setUser] = React.useState(apiService.getCurrentUser());

  if (!user) {
    return <AuthPage onLogin={() => setUser(apiService.getCurrentUser())} />;
  }

  return (
    <Router>
      <div className="min-h-screen bg-zinc-950 text-zinc-200">
        <Navbar />
        <main className="md:pt-16 pb-16 md:pb-0">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/scenarios" element={<Home />} />
            <Route path="/scenario/:scenarioId" element={<ScenarioDetail />} />
            <Route path="/create" element={<CreateScenario />} />
            <Route path="/chats" element={<ChatsList />} />
            <Route path="/chat/:chatId" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
