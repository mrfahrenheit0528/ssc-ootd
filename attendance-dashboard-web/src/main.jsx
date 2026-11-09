import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { configurationError } from './supabase'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return <SetupMessage message={this.state.error.message} />
    return this.props.children
  }
}
function SetupMessage({ message }) {
  return <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950">
    <div className="card p-8 max-w-xl space-y-4">
      <h1 className="text-xl font-bold text-white">SSC Attendance Setup</h1>
      <p className="text-slate-300 whitespace-pre-wrap">{message}</p>
      <p className="text-sm text-slate-400">Follow docs/SUPABASE_SETUP.md in the repository. Use the project URL and publishable key for the dashboard.</p>
    </div>
  </div>
}
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {configurationError ? <SetupMessage message={configurationError} /> : <BrowserRouter>
        <App />
        <Toaster position="bottom-right" toastOptions={{ style: {
          background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 12,
        } }} />
      </BrowserRouter>}
    </ErrorBoundary>
  </React.StrictMode>,
)
