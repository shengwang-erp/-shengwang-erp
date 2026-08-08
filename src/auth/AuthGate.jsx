import { useCallback, useEffect, useRef, useState } from 'react'

import { isSupabaseConfigured } from '../lib/supabaseClient.js'
import {
  EmployeeAuthError,
  employeeAuthService,
} from '../services/employeeAuthService.js'
import ChangeTemporaryPasswordPage from './ChangeTemporaryPasswordPage.jsx'
import LoginPage from './LoginPage.jsx'
import { runCoalescedSessionValidation } from './authGateSession.js'

const localDemoMode = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEMO_MODE === 'true'
const localDemoCredentials = import.meta.env.DEV
  ? { employeeNumber: 'SW-000', password: '320086' }
  : null
const localDemoUser = import.meta.env.DEV
  ? {
      employeeNumber: 'SW-000',
      employeeId: 'SW-000',
      name: 'システム管理者',
      department: '总务部',
      position: '社长',
      employmentStatus: '在职',
      accountStatus: 'active',
      mustChangePassword: false,
      effectivePermissionKeys: ['module.projects.view', 'module.projects.create', 'module.projects.update'],
    }
  : null

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

export default function AuthGate({
  children,
  authService = employeeAuthService,
  configured = isSupabaseConfigured,
}) {
  const [gate, setGate] = useState(() => ({
    status: localDemoMode ? 'authenticated' : configured ? 'loading' : 'configuration-error',
    currentUser: localDemoMode ? localDemoUser : null,
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
          status: currentUser.mustChangePassword ? 'password-change' : 'authenticated',
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
    if (localDemoMode) return undefined
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
      if (localDemoMode) {
        if (
          credentials.employeeNumber.trim().toUpperCase() !== localDemoCredentials.employeeNumber ||
          credentials.password !== localDemoCredentials.password
        ) throw new EmployeeAuthError('AUTH_INVALID', '员工编号或密码错误')
        setGate({ status: 'authenticated', currentUser: localDemoUser })
        return
      }
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
        isForced
        onChangePassword={handlePasswordChange}
        onLogout={moveToLogin}
      />
    )
  }

  if (gate.status !== 'authenticated' || !gate.currentUser) return null

  return children({ currentUser: gate.currentUser, onLogout: moveToLogin })
}
