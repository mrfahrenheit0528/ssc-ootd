import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

// ---------------------------------------------------------------------------
// Error Boundary — catches Firebase init errors (missing .env) and shows
// a helpful setup screen instead of a white blank page.
// ---------------------------------------------------------------------------
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error)
      const isFirebaseConfig = msg.includes('Firebase') || msg.includes('VITE_FIREBASE')
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif', padding: '24px',
        }}>
          <div style={{
            maxWidth: 560, width: '100%', background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 32,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>{isFirebaseConfig ? '🔧' : '❌'}</span>
              <h1 style={{ color: '#f1f5f9', fontSize: 20, fontWeight: 700, margin: 0 }}>
                {isFirebaseConfig ? 'Firebase Setup Required' : 'App Error'}
              </h1>
            </div>

            {isFirebaseConfig ? (
              <>
                <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
                  Your <code style={{ color: '#818cf8' }}>.env</code> file is missing Firebase credentials.
                  Open <code style={{ color: '#818cf8' }}>attendance-dashboard-web/.env</code> and fill in the values from your Firebase project.
                </p>
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <p style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Where to find these values:
                  </p>
                  <ol style={{ color: '#94a3b8', fontSize: 13, lineHeight: 2, paddingLeft: 18, margin: 0 }}>
                    <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>console.firebase.google.com</a></li>
                    <li>Select your project → ⚙️ Project Settings</li>
                    <li>Scroll to <strong style={{ color: '#e2e8f0' }}>Your apps</strong> → click your Web app (or add one)</li>
                    <li>Copy the <strong style={{ color: '#e2e8f0' }}>firebaseConfig</strong> values into <code style={{ color: '#818cf8' }}>.env</code></li>
                    <li>Restart the dev server: <code style={{ color: '#34d399' }}>npm run dev</code></li>
                  </ol>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>
                  <div style={{ color: '#475569', marginBottom: 4 }}># attendance-dashboard-web/.env</div>
                  {['VITE_FIREBASE_API_KEY','VITE_FIREBASE_AUTH_DOMAIN','VITE_FIREBASE_PROJECT_ID',
                    'VITE_FIREBASE_STORAGE_BUCKET','VITE_FIREBASE_MESSAGING_SENDER_ID','VITE_FIREBASE_APP_ID']
                    .map(k => <div key={k} style={{ color: '#94a3b8' }}>{k}=<span style={{ color: '#f87171' }}>your_value_here</span></div>)
                  }
                </div>
              </>
            ) : (
              <pre style={{ color: '#f87171', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg}
              </pre>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'rgba(15,23,42,0.95)',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
              backdropFilter: 'blur(12px)',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#34d399', secondary: '#0f172a' } },
            error:   { iconTheme: { primary: '#f87171', secondary: '#0f172a' } },
          }}
        />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
