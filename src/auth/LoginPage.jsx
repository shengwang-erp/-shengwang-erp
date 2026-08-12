import { useState } from 'react'

export default function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ employeeNumber: '', password: '' })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)
    try {
      await onLogin(form)
    } catch (submissionError) {
      setError(submissionError?.message || '登录失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="employee-login-title">
        <header className="auth-brand">
          <img
            className="auth-brand-mark"
            src="/sw-sidebar-mark.png"
            alt="生旺株式会社标志"
          />
          <div>
            <p>生旺株式会社</p>
            <h1 id="employee-login-title">ERP 数据中心</h1>
            <span>员工安全登录</span>
          </div>
        </header>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field" htmlFor="employee-number">
            <span>员工编号</span>
            <input
              id="employee-number"
              name="employeeNumber"
              type="text"
              value={form.employeeNumber}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  employeeNumber: event.target.value.toUpperCase(),
                }))
              }
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck="false"
              placeholder="SW-001"
              disabled={isSubmitting}
              required
              autoFocus
            />
          </label>

          <label className="auth-field" htmlFor="employee-password">
            <span>密码</span>
            <input
              id="employee-password"
              name="password"
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
              autoComplete="current-password"
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
            {isSubmitting ? '正在登录…' : '登录'}
          </button>
        </form>

        <p className="auth-security-note">账号状态会在每次访问时由服务端重新确认</p>
      </section>
    </main>
  )
}
