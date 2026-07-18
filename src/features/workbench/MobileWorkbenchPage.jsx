import { projectAuthorizedWorkbenchItems } from './workbenchModel.js'

export default function MobileWorkbenchPage({ currentUser, items = [], onNavigate }) {
  const visibleItems = projectAuthorizedWorkbenchItems(currentUser, items)

  return (
    <main className="mobile-workbench-page page-shell">
      <header className="mobile-workbench-header">
        <p className="eyebrow">AUTHORIZED WORKSPACE</p>
        <h1>工作台</h1>
        <span>只显示当前账号已开通的业务模块</span>
      </header>

      <section className="mobile-workbench-grid" aria-label="已授权业务模块">
        {visibleItems.map(({ route, badgeCount }) => (
          <button
            className="mobile-workbench-card"
            type="button"
            key={route.view}
            onClick={() => onNavigate?.(route.view)}
          >
            <span className="mobile-workbench-icon" aria-hidden="true">{route.iconText}</span>
            <span className="mobile-workbench-copy">
              <strong>{route.label}</strong>
              <small>进入业务模块</small>
            </span>
            {badgeCount > 0 && (
              <span
                className="mobile-workbench-badge"
                aria-label={badgeCount > 99 ? '99 条以上待处理' : `${badgeCount} 条待处理`}
              >
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </button>
        ))}
      </section>

      {visibleItems.length === 0 && (
        <div className="empty-state" role="status">当前没有可进入的业务模块</div>
      )}
    </main>
  )
}
