import { canAccessModule, isSuperAdmin } from './utils/permissions'

const desktopMenuItems = [
  { view: 'home', label: '首页', code: '首' },
  { view: 'dashboard', label: '老板驾驶舱', code: '舱', permissionName: '老板驾驶舱' },
  { view: 'projects', label: '工程项目', code: '项', permissionName: '工程项目' },
  { view: 'employees', label: '人员管理', code: '人', permissionName: '人员管理' },
  { view: 'accounting', label: '会计成本', code: '财', permissionName: '会计成本' },
  { view: 'labor', label: '人工记录', code: '工', permissionName: '人工记录' },
  { view: 'stockOut', label: '我要出库', code: '出', permissionName: '仓库库存' },
  { view: 'stockReturn', label: '我要退回', code: '退', permissionName: '仓库库存' },
  { view: 'purchase', label: '采购管理', code: '采', permissionName: '采购管理' },
  { view: 'vehicle', label: '车辆管理', code: '车', permissionName: '车辆管理' },
  { view: 'toolBorrow', label: '借工具', code: '借', permissionName: '工具管理' },
  { view: 'todayAttendance', label: '今日打卡', code: '勤', alwaysAvailable: true },
  { view: 'settings', label: '系统设置', code: '设', permissionName: '系统设置' },
]

function getDesktopActiveView(currentView) {
  return currentView === 'contractRevenue' ? 'projects' : currentView
}

export default function DesktopAdminShell({
  currentView,
  currentUser,
  onNavigate,
  onLogout,
  laborAlertCount = 0,
  laborAlertStale = false,
  children,
}) {
  const activeView = getDesktopActiveView(currentView)
  const normalizedLaborAlertCount =
    Number.isSafeInteger(laborAlertCount) && laborAlertCount > 0 ? laborAlertCount : 0
  const visibleMenuItems = desktopMenuItems.filter(
    (item) =>
      item.view === 'home' ||
      item.alwaysAvailable === true ||
      isSuperAdmin(currentUser) ||
      canAccessModule(currentUser, item.permissionName),
  )
  const activeMenuItem =
    desktopMenuItems.find((item) => item.view === activeView) || desktopMenuItems[0]

  return (
    <div className="desktop-admin-layout">
      <aside className="desktop-admin-sidebar">
        <div className="desktop-admin-brand">
          <span className="desktop-admin-brand-mark" aria-hidden="true">
            SW
          </span>
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
                <span aria-hidden="true">{item.code}</span>
                <strong>
                  {item.label}
                  {showLaborAlert && (
                    <em
                      data-labor-alert-badge
                      aria-hidden="true"
                      style={{
                        alignItems: 'center',
                        background: laborAlertStale ? '#8a6d3b' : '#b42318',
                        borderRadius: '999px',
                        color: '#fff',
                        display: 'inline-flex',
                        fontSize: '11px',
                        fontStyle: 'normal',
                        fontWeight: 700,
                        justifyContent: 'center',
                        lineHeight: 1,
                        marginLeft: '8px',
                        minHeight: '19px',
                        minWidth: '19px',
                        padding: '0 5px',
                      }}
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
            <strong>{activeMenuItem.label}</strong>
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
    </div>
  )
}
