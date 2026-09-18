import { useState } from 'react'

import { isSixDigitPassword } from './employeeAuthDomain.js'

export default function ChangeTemporaryPasswordPage({
  currentUser,
  isForced = true,
  onChangePassword,
  onCancel,
  onLogout,
}) {
  const [form, setForm] = useState({ password: '', confirmation: '' })
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isSubmitting) return
    if (!isSixDigitPassword(form.password)) {
      setError('请输入6位数字')
      return
    }
    if (form.password !== form.confirmation) {
      setError('两次输入的密码不一致')
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

  const passwordType = passwordVisible ? 'text' : 'password'

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="temporary-password-title">
        <header className="auth-brand auth-brand-compact">
          <img
            className="auth-brand-mark"
            src="/sw-sidebar-mark.png"
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
            ? '首次使用初始密码登录后，请设置新密码。保存成功后直接进入 ERP。'
            : '设置后新密码立即生效。'}
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field" htmlFor="new-password">
            <span>新密码</span>
            <div className="auth-password-control">
              <input
                id="new-password"
                name="newPassword"
                type={passwordType}
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="new-password"
                disabled={isSubmitting}
                aria-describedby="password-requirements"
                required
                autoFocus
              />
              <button
                className="auth-password-toggle"
                type="button"
                onClick={() => setPasswordVisible((visible) => !visible)}
                disabled={isSubmitting}
                aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
              >
                {passwordVisible ? '隐藏' : '显示'}
              </button>
            </div>
          </label>
          <p className="auth-field-help" id="password-requirements">
            请输入6位数字
          </p>

          <label className="auth-field" htmlFor="confirm-new-password">
            <span>再次确认</span>
            <div className="auth-password-control">
              <input
                id="confirm-new-password"
                name="confirmNewPassword"
                type={passwordType}
                value={form.confirmation}
                onChange={(event) =>
                  setForm((current) => ({ ...current, confirmation: event.target.value }))
                }
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="new-password"
                disabled={isSubmitting}
                required
              />
            </div>
          </label>

          {error && (
            <p className="auth-form-error" role="alert">
              {error}
            </p>
          )}

          <button className="auth-primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '正在保存…' : '保存密码'}
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
