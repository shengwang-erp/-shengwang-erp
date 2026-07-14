import { useCallback, useEffect, useRef, useState } from 'react'

import { isSupabaseConfigured } from '../lib/supabaseClient.js'
import {
  EmployeeAuthError,
  employeeAuthService,
} from '../services/employeeAuthService.js'
import ChangeTemporaryPasswordPage from './ChangeTemporaryPasswordPage.jsx'
import LoginPage from './LoginPage.jsx'
import { runCoalescedSessionValidation } from './authGateSession.js'

const TERMINAL_AUTH_ERROR_CODES = new Set([
  'ACCOUNT_DISABLED',
  'ACCOUNT_UNAVAILABLE',
  'AUTH_INVALID',
  'AUTH_SESSION_INVALID',
  'AUTH_TOKEN_INVALID',
  'EMPLOYEE_INACTIVE',
  'EMPLOYEE_NOT_LINKED',
  'PASSWORD_STATE_SYNC_FAILED',
])

function AuthStatusPage({ title, message, kind = 'loading' }) {
  return (
    <main className={`auth-shell auth-${kind}`}>
      <section className="auth-panel auth-status-panel" role="status" aria-live="polite">
        <img
          className="auth-brand-mark"
          src="/sw-erp-logo.jpg"
          alt="生旺株式会社标志"
        />
        <p>生旺株式会社 · ERP 数据中心</p>
        <h1>{title}</h1>
        <span>{message}</span>
      </section>
    </main>
  )
}

function toBusinessCurrentUser(profile) {
  return {
    ...profile,
    employeeId: profile.employeeNumber,
  }
}

function hasBusinessPermissions(currentUser) {
  return currentUser.effectivePermissionKeys.length > 0
}

function NoPermissionsPage({ currentUser, onChangePassword, onLogout }) {
  return (
    <main className="auth-shell">
      <section
        className="auth-panel auth-status-panel auth-no-permissions-panel"
        role="status"
        aria-labelledby="no-permissions-title"
      >
        <img
          className="auth-brand-mark"
          src="/sw-erp-logo.jpg"
          alt="生旺株式会社标志"
        />
        <p>{currentUser.employeeNumber} · {currentUser.name}</p>
        <h1 id="no-permissions-title">尚未配置权限</h1>
        <span>当前账号已登录，但所属部门和职位尚未分配可访问模块，请联系管理员。</span>
        <div className="auth-account-actions">
          <button className="auth-primary-button" type="button" onClick={onChangePassword}>
            修改密码
          </button>
          <button className="auth-secondary-button" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </section>
    </main>
  )
}

export default function AuthGate({
  children,
  authService = employeeAuthService,
  configured = isSupabaseConfigured,
}) {
  const [gate, setGate] = useState(() => ({
    status: configured ? 'loading' : 'configuration-error',
    currentUser: null,
  }))
  const validationVersion = useRef(0)
  const validationInFlight = useRef(null)

  const moveToLogin = useCallback(async () => {
    validationVersion.current += 1
    setGate({ status: 'login', currentUser: null })
    try {
      await authService.logout()
    } catch {
      // Rendering stays fail-closed even if remote session revocation is unavailable.
    }
  }, [authService])

  const performSessionValidation = useCallback(
    async (session) => {
      const currentValidation = validationVersion.current + 1
      validationVersion.current = currentValidation
      if (!session?.access_token) {
        setGate({ status: 'login', currentUser: null })
        return null
      }

      setGate({ status: 'loading', currentUser: null })
      try {
        const profile = await authService.getCurrentEmployee()
        if (validationVersion.current !== currentValidation) return null
        const currentUser = toBusinessCurrentUser(profile)
        setGate({
          status: currentUser.mustChangePassword
            ? 'password-change'
            : hasBusinessPermissions(currentUser)
              ? 'authenticated'
              : 'no-permissions',
          currentUser,
          passwordMode: currentUser.mustChangePassword ? 'forced' : null,
        })
        return currentUser
      } catch {
        if (validationVersion.current === currentValidation) await moveToLogin()
        return null
      }
    },
    [authService, moveToLogin],
  )

  const validateSession = useCallback(
    (session) =>
      runCoalescedSessionValidation(
        validationInFlight,
        session,
        performSessionValidation,
      ),
    [performSessionValidation],
  )

  useEffect(() => {
    if (!configured) {
      validationVersion.current += 1
      setGate({ status: 'configuration-error', currentUser: null })
      return undefined
    }

    let isMounted = true
    const pendingTimers = new Set()
    let subscription

    const scheduleValidation = (session) => {
      const timer = window.setTimeout(() => {
        pendingTimers.delete(timer)
        if (isMounted) void validateSession(session)
      }, 0)
      pendingTimers.add(timer)
    }

    try {
      subscription = authService.onAuthStateChange((_event, session) => {
        scheduleValidation(session)
      })
    } catch {
      setGate({ status: 'configuration-error', currentUser: null })
      return undefined
    }

    void authService
      .getSession()
      .then((session) => {
        if (isMounted) return validateSession(session)
        return null
      })
      .catch(() => {
        if (isMounted) void moveToLogin()
      })

    return () => {
      isMounted = false
      validationVersion.current += 1
      validationInFlight.current = null
      for (const timer of pendingTimers) window.clearTimeout(timer)
      subscription?.unsubscribe()
    }
  }, [authService, configured, moveToLogin, validateSession])

  const handleLogin = useCallback(
    async (credentials) => {
      const session = await authService.loginWithEmployeeNumber(credentials)
      const currentUser = await validateSession(session)
      if (!currentUser) throw new EmployeeAuthError('AUTH_SESSION_INVALID')
    },
    [authService, validateSession],
  )

  const handlePasswordChange = useCallback(
    async (password) => {
      try {
        await authService.changeTemporaryPassword(password)
        const session = await authService.getSession()
        const currentUser = await validateSession(session)
        if (!currentUser || currentUser.mustChangePassword) {
          throw new EmployeeAuthError(
            'PASSWORD_STATE_SYNC_FAILED',
            '密码状态尚未同步，请退出后重新登录',
          )
        }
      } catch (error) {
        if (TERMINAL_AUTH_ERROR_CODES.has(error?.code)) await moveToLogin()
        throw error
      }
    },
    [authService, moveToLogin, validateSession],
  )

  const openOptionalPasswordChange = useCallback(() => {
    setGate((current) =>
      current.currentUser
        ? { ...current, status: 'password-change', passwordMode: 'optional' }
        : current,
    )
  }, [])

  const closeOptionalPasswordChange = useCallback(() => {
    setGate((current) =>
      current.currentUser
        ? { ...current, status: 'no-permissions', passwordMode: null }
        : current,
    )
  }, [])

  if (gate.status === 'configuration-error') {
    return (
      <AuthStatusPage
        kind="configuration-error"
        title="系统配置未完成"
        message="认证服务尚未配置，请联系系统管理员。"
      />
    )
  }

  if (gate.status === 'loading') {
    return <AuthStatusPage title="正在确认登录状态" message="请稍候…" />
  }

  if (gate.status === 'login') {
    return <LoginPage onLogin={handleLogin} />
  }

  if (gate.status === 'password-change') {
    return (
      <ChangeTemporaryPasswordPage
        currentUser={gate.currentUser}
        isForced={gate.passwordMode !== 'optional'}
        onChangePassword={handlePasswordChange}
        onCancel={
          gate.passwordMode === 'optional' ? closeOptionalPasswordChange : undefined
        }
        onLogout={moveToLogin}
      />
    )
  }

  if (gate.status === 'no-permissions') {
    return (
      <NoPermissionsPage
        currentUser={gate.currentUser}
        onChangePassword={openOptionalPasswordChange}
        onLogout={moveToLogin}
      />
    )
  }

  if (gate.status !== 'authenticated' || !gate.currentUser) return null

  return children({ currentUser: gate.currentUser, onLogout: moveToLogin })
}
