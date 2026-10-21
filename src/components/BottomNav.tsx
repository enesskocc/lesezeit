import { NavLink } from 'react-router-dom';

// Okuma and Kelimeler tabs arrive with milestones 5 and 6.
const items = [
  { to: '/', label: 'Bugün', icon: 'M4 5h16M4 10h16M4 15h10M4 20h7' },
  { to: '/sozluk', label: 'Sözlük', icon: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20' },
  { to: '/kurulum', label: 'Ayarlar', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5 7 17M17 17l1.5 1.5M5.5 5.5 7 7' },
];

export function BottomNav() {
  return (
    <nav
      aria-label="Ana menü"
      className="fixed inset-x-0 bottom-0 z-10 flex justify-center border-t border-line bg-surface px-4 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]"
    >
      <div className="flex w-full max-w-[480px]">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-xs font-semibold ${isActive ? 'text-accent' : 'text-muted'}`
            }
          >
            <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d={it.icon} />
            </svg>
            {it.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
