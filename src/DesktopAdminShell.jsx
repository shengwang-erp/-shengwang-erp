import { getVisibleAdminRoutes } from './auth/businessAccess.js'
import MobileBottomNavigation from './navigation/MobileBottomNavigation.jsx'
import { normalizeAdminView } from './navigation/adminRoutes.js'

export default function DesktopAdminShell({
  currentView,
  currentUser,
  onNavigate,
  onLogout,
  laborAlertCount = 0,
  laborAlertStale = false,
  workbenchItems = [],
  messages = [],
  children,
}) {
  const normalizedLaborAlertCount =
    Number.isSafeInteger(laborAlertCount) && laborAlertCount > 0 ? laborAlertCount : 0
  const visibleMenuItems = getVisibleAdminRoutes(currentUser)
  const requestedActiveView = normalizeAdminView(currentView)
  const activeMenuItem =
    visibleMenuItems.find((item) => item.view === requestedActiveView) ||
    visibleMenuItems.find((item) => item.view === 'home')
  const activeView = activeMenuItem?.view || 'home'

  return (
    <div className="erp-black-gold desktop-admin-layout">
      <aside className="desktop-admin-sidebar">
        <div className="desktop-admin-brand">
          <img
            className="desktop-admin-brand-mark"
            src="/sw-sidebar-mark.png"
            alt="生旺株式会社标志"
          />
          <span>
            <strong>生旺株式会社</strong>
            <small>ERP 管理数据中心</small>
          </span>
        </div>

        <nav className="desktop-admin-menu" aria-label="桌面一级菜单">
          {visibleMenuItems.map((item) => {
            const isActive = item.view === activeView
            const showLaborAlert =
              item.view === 'labor' && normalizedLaborAlertCount > 0
            return (
              <button
                className={`desktop-admin-menu-item ${isActive ? 'active' : ''}`}
                type="button"
                key={item.view}
                aria-current={isActive ? 'page' : undefined}
                aria-label={showLaborAlert
                  ? ['人工记录，', normalizedLaborAlertCount, ' 条待处理', laborAlertStale ? '，数据可能已过期' : ''].join('')
                  : undefined}
                title={showLaborAlert
                  ? ['人工记录：', normalizedLaborAlertCount, ' 条待处理', laborAlertStale ? '（数据可能已过期）' : ''].join('')
                  : undefined}
                onClick={() => onNavigate(item.view)}
              >
                <span aria-hidden="true">{item.iconText}</span>
                <strong>
                  {item.label}
                  {showLaborAlert && (
                    <em
                      className={`desktop-admin-alert-badge ${laborAlertStale ? 'is-stale' : ''}`}
                      data-labor-alert-badge
                      aria-hidden="true"
                    >
                      {normalizedLaborAlertCount}
                    </em>
                  )}
                </strong>
              </button>
            )
          })}
        </nav>

        <div className="desktop-admin-sidebar-foot">
          <span>当前登录</span>
          <strong>{currentUser.name}</strong>
          <small>{currentUser.department || '未设置部门'} · {currentUser.position || '未设置职位'}</small>
        </div>
      </aside>

      <div className="desktop-admin-workspace">
        <header className="desktop-admin-topbar">
          <div className="desktop-admin-topbar-title">
            <span>生旺 ERP 数据中心</span>
            <strong>{activeMenuItem?.label || ''}</strong>
          </div>
          <div className="desktop-admin-topbar-user">
            <span>
              <strong>{currentUser.name}</strong>
              <small>{currentUser.position || currentUser.department || '员工'}</small>
            </span>
            <button type="button" onClick={onLogout}>
              退出登录
            </button>
          </div>
        </header>
        <div className="desktop-admin-content">{children}</div>
      </div>
      <MobileBottomNavigation
        currentView={currentView}
        currentUser={currentUser}
        workbenchItems={workbenchItems}
        messages={messages}
        onNavigate={onNavigate}
      />
    </div>
  )
}
