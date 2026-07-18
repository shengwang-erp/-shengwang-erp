import { canAccessView } from '../auth/businessAccess.js'
import {
  countAuthorizedMessageBadges,
  countAuthorizedWorkbenchBadges,
} from '../features/workbench/workbenchModel.js'
import { MOBILE_PRIMARY_TABS, getAdminRoute } from './adminRoutes.js'

function safeBadgeCount(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

export default function MobileBottomNavigation({
  currentView,
  currentUser,
  workbenchItems = [],
  messages = [],
  onNavigate,
}) {
  const currentRoute = getAdminRoute(currentView)
  const activePrimaryView = !currentRoute
    ? 'home'
    : currentRoute.mobileTab
      ? currentRoute.view
      : 'workbench'
  const badgeCounts = {
    workbench: countAuthorizedWorkbenchBadges(currentUser, workbenchItems),
    messages: countAuthorizedMessageBadges(messages),
  }

  return (
    <nav className="mobile-bottom-navigation" aria-label="移动主导航">
      {MOBILE_PRIMARY_TABS.filter((tab) => canAccessView(currentUser, tab.view)).map((tab) => {
        const active = tab.view === activePrimaryView
        const badgeCount = safeBadgeCount(badgeCounts[tab.view])
        return (
          <button
            type="button"
            className={active ? 'is-active' : ''}
            key={tab.view}
            aria-current={active ? 'page' : undefined}
            aria-label={badgeCount > 0 ? `${tab.label}，${badgeCount} 条待处理` : tab.label}
            onClick={() => onNavigate?.(tab.view)}
          >
            <span className="mobile-bottom-icon" aria-hidden="true">{tab.iconText}</span>
            <span className="mobile-bottom-label">{tab.label}</span>
            {badgeCount > 0 && (
              <span className="mobile-bottom-badge" aria-hidden="true">
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
