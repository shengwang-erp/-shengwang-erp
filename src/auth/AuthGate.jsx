import { useCallback, useEffect, useRef, useState } from 'react'

import { isSupabaseConfigured } from '../lib/supabaseClient.js'
import {
  EmployeeAuthError,
  employeeAuthService,
} from '../services/employeeAuthService.js'
import ChangeTemporaryPasswordPage from './ChangeTemporaryPasswordPage.jsx'
import LoginPage from './LoginPage.jsx'
import {
  isTerminalAuthError,
  runCoalescedSessionValidation,
} from './authGateSession.js'

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

function AuthStatusPage({ title, message, kind = 'loading', children }) {
  return (
    <main className={`auth-shell auth-${kind}`}>
      <section className="auth-panel auth-status-panel" role="status" aria-live="polite">
        <img
          className="auth-brand-mark"
          src="/sw-sidebar-mark.png"
          alt="生旺株式会社标志"
        />
        <p>生旺株式会社 · ERP 数据中心</p>
        <h1>{title}</h1>
        <span>{message}</span>
        {children}
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

function sessionUserId(session) {
  return typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
}

function canKeepAuthenticatedRuntime(gate, session) {
  const nextAuthUserId = sessionUserId(session)
  return gate.status === 'authenticated'
    && Boolean(gate.currentUser)
    && Boolean(gate.authUserId)
    && gate.authUserId === nextAuthUserId
}

export default function AuthGate({
  children,
  authService = employeeAuthService,
  configured = isSupabaseConfigured,
}) {
  const [gate, setGate] = useState(() => ({
    status: localDemoMode ? 'authenticated' : configured ? 'loading' : 'configuration-error',
    currentUser: localDemoMode ? localDemoUser : null,
    authUserId: localDemoMode ? 'local-demo' : '',
  }))
  const validationVersion = useRef(0)
  const validationInFlight = useRef(null)

  const moveToLogin = useCallback(async () => {
    validationVersion.current += 1
    setGate({ status: 'login', currentUser: null, authUserId: '' })
    try {
      await authService.logout()
    } catch {
      // Rendering stays fail-closed even if remote session revocation is unavailable.
    }
  }, [authService])

  const moveToValidationError = useCallback(() => {
    validationVersion.current += 1
    setGate({ status: 'validation-error', currentUser: null, authUserId: '' })
  }, [])

  const performSessionValidation = useCallback(
    async (session) => {
      const currentValidation = validationVersion.current + 1
      validationVersion.current = currentValidation
      if (!session?.access_token) {
        setGate({ status: 'login', currentUser: null, authUserId: '' })
        return null
      }

      const nextAuthUserId = sessionUserId(session)
      setGate((currentGate) => canKeepAuthenticatedRuntime(currentGate, session)
        ? currentGate
        : {
            status: 'loading',
            currentUser: null,
            authUserId: nextAuthUserId,
          })
      try {
        const profile = await authService.getCurrentEmployee()
        if (validationVersion.current !== currentValidation) return null
        const currentUser = toBusinessCurrentUser(profile)
        setGate({
          status: currentUser.mustChangePassword ? 'password-change' : 'authenticated',
          currentUser,
          passwordMode: currentUser.mustChangePassword ? 'forced' : null,
          authUserId: nextAuthUserId,
        })
        return currentUser
      } catch (error) {
        if (validationVersion.current !== currentValidation) return null
        if (isTerminalAuthError(error)) await moveToLogin()
        else moveToValidationError()
        return null
      }
    },
    [authService, moveToLogin, moveToValidationError],
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
      setGate({ status: 'configuration-error', currentUser: null, authUserId: '' })
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
      setGate({ status: 'configuration-error', currentUser: null, authUserId: '' })
      return undefined
    }

    void authService
      .getSession()
      .then((session) => {
        if (isMounted) return validateSession(session)
        return null
      })
      .catch((error) => {
        if (!isMounted) return
        if (isTerminalAuthError(error)) void moveToLogin()
        else moveToValidationError()
      })

    return () => {
      isMounted = false
      validationVersion.current += 1
      validationInFlight.current = null
      for (const timer of pendingTimers) window.clearTimeout(timer)
      subscription?.unsubscribe()
    }
  }, [
    authService,
    configured,
    moveToLogin,
    moveToValidationError,
    validateSession,
  ])

  const onRefreshCurrentUser = useCallback(async () => {
    if (localDemoMode) {
      setGate({ status: 'authenticated', currentUser: localDemoUser, authUserId: 'local-demo' })
      return localDemoUser
    }

    let session
    try {
      session = await authService.getSession()
    } catch (error) {
      if (isTerminalAuthError(error)) await moveToLogin()
      else moveToValidationError()
      throw error
    }

    const currentUser = await validateSession(session)
    if (!currentUser) {
      throw new EmployeeAuthError(
        'AUTH_SERVICE_UNAVAILABLE',
        '认证服务暂不可用，请稍后重试',
      )
    }
    return currentUser
  }, [authService, moveToLogin, moveToValidationError, validateSession])

  const handleRetryValidation = useCallback(async () => {
    try {
      await onRefreshCurrentUser()
    } catch {
      // The authentication boundary already selected retry or login state.
    }
  }, [onRefreshCurrentUser])

  const handleLogin = useCallback(
    async (credentials) => {
      if (localDemoMode) {
        if (
          credentials.employeeNumber.trim().toUpperCase() !== localDemoCredentials.employeeNumber ||
          credentials.password !== localDemoCredentials.password
        ) throw new EmployeeAuthError('AUTH_INVALID', '员工编号或密码错误')
        setGate({ status: 'authenticated', currentUser: localDemoUser, authUserId: 'local-demo' })
        return
      }
      const session = await authService.loginWithEmployeeNumber(credentials)
      const currentUser = await validateSession(session)
      if (!currentUser) throw new EmployeeAuthError('AUTH_SERVICE_UNAVAILABLE')
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
        if (isTerminalAuthError(error)) await moveToLogin()
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

  if (gate.status === 'validation-error') {
    return (
      <AuthStatusPage
        kind="validation-error"
        title="认证服务暂不可用"
        message="登录会话仍保留。请重新验证后继续使用 ERP。"
      >
        <div className="auth-account-actions">
          <button className="auth-primary-button" type="button" onClick={handleRetryValidation}>重新验证</button>
          <button className="auth-secondary-button" type="button" onClick={moveToLogin}>退出登录</button>
        </div>
      </AuthStatusPage>
    )
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

  return children({
    currentUser: gate.currentUser,
    onLogout: moveToLogin,
    onRefreshCurrentUser,
  })
}
