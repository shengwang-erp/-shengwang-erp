import { canAccessView } from '../../auth/businessAccess.js'
import { getAdminRoute } from '../../navigation/adminRoutes.js'

function formatYen(value) {
  return `¥${value.toLocaleString('ja-JP')}`
}

export default function MobileMessagesPage({ currentUser, messages = [], onNavigate }) {
  const visibleMessages = Array.isArray(messages) ? messages : []

  return (
    <main className="mobile-messages-page page-shell">
      <header className="mobile-workbench-header">
        <p className="eyebrow">AUTHORIZED ALERTS</p>
        <h1>消息</h1>
        <span>仅显示当前账号有权处理的业务提醒</span>
      </header>

      <section className="mobile-message-list" aria-label="业务消息">
        {visibleMessages.map((message) => {
          const route = getAdminRoute(message?.targetView)
          const canNavigate = message?.canNavigate === true && Boolean(route) &&
            canAccessView(currentUser, route.view)
          return (
            <article
              className={`mobile-message-card is-${message.severity || 'info'}`}
              key={message.id}
            >
              <span className="mobile-message-severity" aria-hidden="true" />
              <div className="mobile-message-copy">
                <strong>{message.title}</strong>
                <p>{message.summary}</p>
                <span>
                  {message.count > 0 ? `${message.count} 项` : '状态提醒'}
                  {Number.isSafeInteger(message.amount) && message.amount >= 0
                    ? ` · ${formatYen(message.amount)}`
                    : ''}
                </span>
              </div>
              {canNavigate && (
                <button type="button" onClick={() => onNavigate?.(route.view)}>
                  去处理
                </button>
              )}
            </article>
          )
        })}
      </section>

      {visibleMessages.length === 0 && (
        <div className="empty-state" role="status">暂无需要处理的授权消息</div>
      )}
    </main>
  )
}
