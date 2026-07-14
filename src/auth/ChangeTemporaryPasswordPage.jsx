import { useState } from 'react'

function validatePassword(password) {
  return (
    password.length >= 12 &&
    /[A-Z]/u.test(password) &&
    /[a-z]/u.test(password) &&
    /[0-9]/u.test(password) &&
    !/\s/u.test(password)
  )
}

export default function ChangeTemporaryPasswordPage({
  currentUser,
  isForced = true,
  onChangePassword,
  onCancel,
  onLogout,
}) {
  const [form, setForm] = useState({ password: '', confirmation: '' })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isSubmitting) return
    if (!validatePassword(form.password)) {
      setError('新密码至少 12 位，且需包含大写字母、小写字母和数字')
      return
    }
    if (form.password !== form.confirmation) {
      setError('两次输入的新密码不一致')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      await onChangePassword(form.password)
    } catch (submissionError) {
      setError(submissionError?.message || '密码更新失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="temporary-password-title">
        <header className="auth-brand auth-brand-compact">
          <img
            className="auth-brand-mark"
            src="/sw-erp-logo.jpg"
            alt="生旺株式会社标志"
          />
          <div>
            <p>{currentUser.employeeNumber}</p>
            <h1 id="temporary-password-title">
              {isForced ? '设置新密码' : '修改密码'}
            </h1>
            <span>{currentUser.name}</span>
          </div>
        </header>

        <div className="auth-guidance" role="status">
          {isForced
            ? '当前使用的是一次性初始密码。首次登录必须设置新密码后，才能进入 ERP。'
            : '请输入新的登录密码。保存成功后，新密码立即生效。'}
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field" htmlFor="new-password">
            <span>新密码</span>
            <input
              id="new-password"
              name="newPassword"
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              autoComplete="new-password"
              disabled={isSubmitting}
              aria-describedby="password-requirements"
              required
              autoFocus
            />
          </label>
          <p className="auth-field-help" id="password-requirements">
            至少 12 位，包含大写字母、小写字母和数字，不能包含空格。
          </p>

          <label className="auth-field" htmlFor="confirm-new-password">
            <span>确认新密码</span>
            <input
              id="confirm-new-password"
              name="confirmNewPassword"
              type="password"
              value={form.confirmation}
              onChange={(event) =>
                setForm((current) => ({ ...current, confirmation: event.target.value }))
              }
              autoComplete="new-password"
              disabled={isSubmitting}
              required
            />
          </label>

          {error && (
            <p className="auth-form-error" role="alert">
              {error}
            </p>
          )}

          <button className="auth-primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '正在更新…' : '保存新密码'}
          </button>
          {!isForced && (
            <button
              className="auth-secondary-button"
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              返回
            </button>
          )}
          <button
            className="auth-secondary-button"
            type="button"
            onClick={onLogout}
            disabled={isSubmitting}
          >
            退出登录
          </button>
        </form>
      </section>
    </main>
  )
}
