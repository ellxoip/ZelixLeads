import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/auth'
import { usePushNotifications } from './hooks/usePushNotifications'
import { RealtimeProvider } from './contexts/RealtimeContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import LeadDetail from './pages/LeadDetail'
import Pipeline from './pages/Pipeline'
import Contactos from './pages/Contactos'
import Calendario from './pages/Calendario'
import Pagos from './pages/Pagos'
import Notificaciones from './pages/Notificaciones'
import WhatsApp from './pages/WhatsApp'
import Admin from './pages/Admin'
import Tecnico from './pages/Tecnico'
import Agenda from './pages/Agenda'
import VendorPipeline from './pages/VendorPipeline'
import MisWhatsApp from './pages/MisWhatsApp'
import Telegram from './pages/Telegram'
import PagarCuota from './pages/PagarCuota'
import Seguimiento from './pages/Seguimiento'
import AgentIA from './pages/AgentIA'
import CobradoresDashboard from './pages/CobradoresDashboard'
import CobradoresCartera from './pages/CobradoresCartera'
import CobradoresPipeline from './pages/CobradoresPipeline'
import CobradoresHistorial from './pages/CobradoresHistorial'
import AsistenteSeguimiento from './pages/AsistenteSeguimiento'
import AnalistaDashboard from './pages/AnalistaDashboard'
import Nexin from './pages/Nexin'
import Integraciones from './pages/Integraciones'

function homeFor(role?: string) {
  if (role === 'tecnico') return '/tecnico'
  if (role === 'vendedor') return '/'
  if (role === 'verificador') return '/pagos'
  if (role === 'agendadora') return '/'
  if (role === 'analista') return '/analista'
  if (role === 'cobrador') return '/cobrador'
  if (role === 'asistente_seguimiento') return '/asistente-seguimiento'
  return '/'
}

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, user } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />
  }
  return <>{children}</>
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuthStore()
  usePushNotifications(isAuthenticated)
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to={homeFor(user?.role)} replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute roles={['superadmin','subadmin','agendadora','verificador','vendedor']}><Layout><Dashboard /></Layout></ProtectedRoute>} />
      <Route path="/analista" element={<ProtectedRoute roles={['analista','superadmin','subadmin']}><Layout><AnalistaDashboard /></Layout></ProtectedRoute>} />
      <Route path="/nexin" element={<ProtectedRoute roles={['superadmin']}><Layout><Nexin /></Layout></ProtectedRoute>} />
      <Route path="/integraciones" element={<ProtectedRoute roles={['superadmin']}><Layout><Integraciones /></Layout></ProtectedRoute>} />
      <Route path="/leads" element={<ProtectedRoute roles={['superadmin','subadmin','agendadora']}><Layout><Leads /></Layout></ProtectedRoute>} />
      <Route path="/leads/:id" element={<ProtectedRoute roles={['superadmin','subadmin','agendadora']}><Layout><LeadDetail /></Layout></ProtectedRoute>} />
      <Route path="/pipeline" element={<ProtectedRoute roles={['superadmin','subadmin','agendadora']}><Layout><Pipeline /></Layout></ProtectedRoute>} />
      <Route path="/contactos" element={<ProtectedRoute roles={['superadmin','subadmin','agendadora']}><Layout><Contactos /></Layout></ProtectedRoute>} />
      <Route path="/calendario" element={<ProtectedRoute roles={['superadmin','subadmin','agendadora']}><Layout><Calendario /></Layout></ProtectedRoute>} />
      <Route path="/agenda" element={<ProtectedRoute roles={['vendedor']}><Layout><Agenda /></Layout></ProtectedRoute>} />
      <Route path="/mi-pipeline" element={<ProtectedRoute roles={['vendedor']}><Layout><VendorPipeline /></Layout></ProtectedRoute>} />
      <Route path="/pagos" element={<ProtectedRoute roles={['verificador','superadmin','subadmin']}><Layout><Pagos /></Layout></ProtectedRoute>} />
      <Route path="/notificaciones" element={<ProtectedRoute><Layout><Notificaciones /></Layout></ProtectedRoute>} />
      <Route path="/whatsapp" element={<ProtectedRoute roles={['superadmin','subadmin','agendadora','cobrador']}><Layout><WhatsApp /></Layout></ProtectedRoute>} />
      <Route path="/mis-whatsapp" element={<ProtectedRoute roles={['agendadora','cobrador','superadmin','subadmin']}><Layout><MisWhatsApp /></Layout></ProtectedRoute>} />
      <Route path="/telegram" element={<ProtectedRoute roles={['agendadora','superadmin','subadmin','tecnico']}><Layout><Telegram /></Layout></ProtectedRoute>} />
      <Route path="/seguimiento" element={<ProtectedRoute roles={['agendadora','superadmin','subadmin']}><Layout><Seguimiento /></Layout></ProtectedRoute>} />
      <Route path="/agente-ia" element={<ProtectedRoute roles={['agendadora','superadmin','subadmin']}><Layout><AgentIA /></Layout></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute roles={['superadmin','subadmin']}><Layout><Admin /></Layout></ProtectedRoute>} />
      <Route path="/tecnico" element={<ProtectedRoute roles={['tecnico']}><Layout><Tecnico /></Layout></ProtectedRoute>} />
      {/* Asistente seguimiento panel */}
      <Route path="/asistente-seguimiento" element={<ProtectedRoute roles={['asistente_seguimiento','superadmin','subadmin']}><Layout><AsistenteSeguimiento /></Layout></ProtectedRoute>} />
      {/* Cobrador panel */}
      <Route path="/cobrador" element={<ProtectedRoute roles={['cobrador','superadmin','subadmin']}><Layout><CobradoresDashboard /></Layout></ProtectedRoute>} />
      <Route path="/cobrador/cartera" element={<ProtectedRoute roles={['cobrador','superadmin','subadmin']}><Layout><CobradoresCartera /></Layout></ProtectedRoute>} />
      <Route path="/cobrador/pipeline" element={<ProtectedRoute roles={['cobrador','superadmin','subadmin']}><Layout><CobradoresPipeline /></Layout></ProtectedRoute>} />
      <Route path="/cobrador/historial" element={<ProtectedRoute roles={['cobrador','superadmin','subadmin']}><Layout><CobradoresHistorial /></Layout></ProtectedRoute>} />
      {/* Public payment portal — no auth required */}
      <Route path="/pagar/:token" element={<PagarCuota />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <RealtimeProvider>
        <AppRoutes />
        <Toaster position="top-right" toastOptions={{ duration: 3000, style: { borderRadius: '12px', fontSize: '14px' } }} />
      </RealtimeProvider>
    </BrowserRouter>
  )
}
