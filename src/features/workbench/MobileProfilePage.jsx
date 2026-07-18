import { getVisibleAdminRoutes } from '../../auth/businessAccess.js'
import { getAdminRoute } from '../../navigation/adminRoutes.js'

export default function MobileProfilePage({ currentUser, onLogout }) {
  const visibleModules = getVisibleAdminRoutes(currentUser)
    .filter((route) => route.view !== 'home')
    .filter((route) => getAdminRoute(route.view)?.desktop === true)

  return (
    <main className="mobile-profile-page page-shell">
      <section className="mobile-profile-card">
        <span className="mobile-profile-mark" aria-hidden="true">
          {(currentUser?.name || '员').slice(0, 1)}
        </span>
        <div>
          <p className="eyebrow">CURRENT EMPLOYEE</p>
          <h1>{currentUser?.name || '未设置姓名'}</h1>
          <p>{currentUser?.department || '未设置部门'} · {currentUser?.position || '未设置职位'}</p>
          <small>{currentUser?.employeeNumber || ''}</small>
        </div>
      </section>

      <section className="mobile-profile-modules" aria-labelledby="profile-module-title">
        <div className="section-heading">
          <h2 id="profile-module-title">可见模块范围</h2>
          <span>{visibleModules.length} 个</span>
        </div>
        <div className="mobile-profile-module-list">
          {visibleModules.map((route) => (
            <span key={route.view}>{route.label}</span>
          ))}
        </div>
      </section>

      <button className="mobile-profile-logout" type="button" onClick={onLogout}>
        退出登录
      </button>
    </main>
  )
}
