import { NavLink } from 'react-router-dom'
import type { Health } from '../../api/types'
import { NAV_GROUPS } from './nav'

export function Sidebar({ health }: { health: Health | null }) {
  return (
    <aside className="sidebar">
      <nav className="nav" aria-label="Primary (desktop)">
        {NAV_GROUPS.map((group) => (
          <div className="nav-section" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <item.icon size={16} strokeWidth={2} aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="muted status-panel" style={{ marginTop: 'auto', fontSize: '0.72rem' }}>
        {health ? (
          <>
            <div>db: {health.database}</div>
            <div>model: {health.screening_model}</div>
            <div>rag: {health.rag_backend}</div>
            <div>llm: {health.llm}</div>
            <div>policy: v{health.policy_version}</div>
          </>
        ) : (
          <div>backend unreachable</div>
        )}
      </div>
    </aside>
  )
}
