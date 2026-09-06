import { AnimatePresence, motion } from 'motion/react'
import { NavLink } from 'react-router-dom'
import { NAV_GROUPS } from './nav'

export function MobileNav({ open, reduceMotion }: { open: boolean; reduceMotion: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          className="sidebar-mobile"
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        >
          <nav className="nav" id="primary-nav" aria-label="Primary">
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
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
