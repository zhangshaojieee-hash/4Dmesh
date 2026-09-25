import React from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './stores/auth';
import { ToastProvider } from './stores/toast';
import { ProjectProvider } from './stores/project';
import Header from './components/Header';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import NotFound from './pages/NotFound';
import Home from './pages/Home';
import Login from './pages/auth/Login';
import VoiceChat from './components/VoiceChat';

const ModelDetail = React.lazy(() => import('./pages/ModelDetail'));
const Models = React.lazy(() => import('./pages/Models'));
const DeviceControl = React.lazy(() => import('./pages/DeviceControl'));
const AICreate = React.lazy(() => import('./pages/AICreate'));
const GcodeEditor = React.lazy(() => import('./pages/GcodeEditor'));
const Profile = React.lazy(() => import('./pages/Profile'));
const Projects = React.lazy(() => import('./pages/Projects'));
const Admin = React.lazy(() => import('./pages/Admin'));
const Legal = React.lazy(() => import('./pages/Legal'));

const matchesRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`);

const getMainContentClass = (pathname: string) => {
  const workbenchRoutes = ['/models', '/device', '/ai', '/editor', '/gcode-editor', '/projects', '/profile', '/admin'];
  const documentRoutes = ['/terms', '/privacy'];
  const publicRoutes = ['/'];
  const knownRoutes = [...workbenchRoutes, ...documentRoutes, ...publicRoutes];
  const isWorkbenchRoute = workbenchRoutes.some((route) => matchesRoute(pathname, route));
  const isDocumentRoute = documentRoutes.includes(pathname);
  const isPublicRoute = publicRoutes.includes(pathname);
  const isKnownRoute = knownRoutes.some((route) => matchesRoute(pathname, route));
  const classes = ['main-content', 'main-content--route-shell'];

  if (isWorkbenchRoute) classes.push('main-content--workbench');
  if (isDocumentRoute) classes.push('main-content--document');
  if (isPublicRoute) classes.push('main-content--public');
  if (!isKnownRoute) classes.push('main-content--fallback');

  return classes.join(' ');
};

const AppContent: React.FC = () => {
  const location = useLocation();
  const isAuthRoute = location.pathname === '/login';
  const mainContentClass = isAuthRoute ? 'auth-main-content' : getMainContentClass(location.pathname);
  const [railCollapsed, setRailCollapsed] = React.useState(false);

  return (
    <div className={`app-container${isAuthRoute ? ' auth-route' : ''}${!isAuthRoute && railCollapsed ? ' rail-collapsed' : ''}`}>
      {!isAuthRoute && <Header railCollapsed={railCollapsed} onToggleRail={() => setRailCollapsed((collapsed) => !collapsed)} />}
      <div className={isAuthRoute ? 'auth-main-wrapper' : 'main-wrapper'}>
        <main className={mainContentClass}>
          <ErrorBoundary>
            <React.Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}><div className="loading-spinner" /></div>}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/models" element={<Models />} />
                <Route path="/models/:id" element={<ModelDetail />} />
                <Route path="/device" element={<ProtectedRoute><DeviceControl /></ProtectedRoute>} />
                <Route path="/ai" element={<ProtectedRoute><AICreate /></ProtectedRoute>} />
                <Route path="/editor" element={<ProtectedRoute><GcodeEditor /></ProtectedRoute>} />
                <Route path="/gcode-editor" element={<Navigate to={`/editor${location.search}`} replace />} />
                <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
                <Route path="/login" element={<Login />} />
                <Route path="/terms" element={<Legal type="terms" />} />
                <Route path="/privacy" element={<Legal type="privacy" />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </React.Suspense>
          </ErrorBoundary>
        </main>
      </div>
      {!isAuthRoute && <VoiceChat />}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <ToastProvider>
        <ProjectProvider>
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </ProjectProvider>
      </ToastProvider>
    </AuthProvider>
  );
};

export default App;
