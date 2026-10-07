import { useState } from 'react'
import { storageMode } from './storage/runtime'
import { ActiveReminders } from './ui/ActiveReminders'
import { DemoBanner } from './ui/DemoBanner'
import { SettingsView } from './ui/SettingsView'
import { TasksView } from './ui/tasks/TasksView'
import { TodayView } from './ui/TodayView'

type View = 'today' | 'tasks' | 'settings'

const VIEWS: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'settings', label: 'Settings' },
]

export function App() {
  const [view, setView] = useState<View>('today')

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Miss Minutes
        </h1>
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
      </header>

      <main className={`content${view === 'settings' ? '' : ' wide'}`} id="main">
        <DemoBanner />
        <ActiveReminders />
        {view === 'tasks' ? (
          <TasksView />
        ) : view === 'settings' ? (
          <SettingsView />
        ) : (
          <TodayView onOpenTasks={() => setView('tasks')} />
        )}
      </main>

      <footer className="statusbar">
        <span>Storage: {storageMode === 'sqlite' ? 'SQLite (desktop)' : 'this browser (demo)'}</span>
        {storageMode === 'localStorage' && (
          <a href="./privacy.html" className="footer-link">Privacy</a>
        )}
      </footer>
    </div>
  )
}
