import { useState } from 'react'
import { storageMode } from './storage/runtime'
import { ActiveReminders } from './ui/ActiveReminders'
import { ConsoleClock } from './ui/ConsoleClock'
import { DemoBanner } from './ui/DemoBanner'
import { SettingsView } from './ui/SettingsView'
import { TasksView } from './ui/tasks/TasksView'
import { TodayView } from './ui/TodayView'
import { PlanView } from './ui/plan/PlanView'
import { applyTheme, savedTheme, type Theme } from './ui/theme'

type View = 'today' | 'plan' | 'tasks' | 'settings'

const VIEWS: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'plan', label: 'Plan' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'settings', label: 'Settings' },
]

export function App() {
  const [view, setView] = useState<View>('today')
  const [theme, setTheme] = useState<Theme>(savedTheme)
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <h1 className="brand">Miss Minutes</h1>
          <p className="brand-sub" aria-hidden="true">Bureau of personal time</p>
        </div>
        <ConsoleClock />
        <nav aria-label="Main">
          <ul className="nav">
            {VIEWS.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className="nav-item"
                  aria-current={view === v.id ? 'page' : undefined}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <button type="button" className="theme-switch" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to the light Office theme' : 'Switch to the dark Terminal theme'}>
          <span className="switch-lamp" aria-hidden="true" />
          <span className="visually-hidden">Theme: </span>
          {theme === 'dark' ? 'Terminal' : 'Office'}
        </button>
      </header>

      <main className={`content${view === 'settings' ? '' : ' wide'}`} id="main">
        <DemoBanner />
        <ActiveReminders />
        {view === 'tasks' ? (
          <TasksView />
        ) : view === 'settings' ? (
          <SettingsView />
        ) : view === 'plan' ? (
          <PlanView />
        ) : (
          <TodayView onOpenTasks={() => setView('tasks')} />
        )}
      </main>

      <footer className="statusbar">
        <span>
          <span className="status-lamp" aria-hidden="true" />
          Storage: {storageMode === 'sqlite' ? 'SQLite (desktop)' : 'this browser (demo)'}
        </span>
        {storageMode === 'localStorage' && (
          <a href="./privacy.html" className="footer-link">Privacy</a>
        )}
      </footer>
    </div>
  )
}
