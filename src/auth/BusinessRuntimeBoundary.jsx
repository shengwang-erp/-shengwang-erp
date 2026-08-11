import React, { Component } from 'react'

import {
  buildBusinessRuntimeDiagnostic,
  formatBusinessRuntimeDiagnostic,
} from './businessRuntimeDiagnostic.js'

const defaultReload = () => window.location.reload()
const defaultNow = () => new Date().toISOString()
const defaultCopy = (text) => {
  if (!globalThis.navigator?.clipboard?.writeText) {
    return Promise.reject(new Error('clipboard unavailable'))
  }
  return globalThis.navigator.clipboard.writeText(text)
}

export function detectBusinessRuntime() {
  const userAgent = typeof globalThis.navigator?.userAgent === 'string'
    ? globalThis.navigator.userAgent
    : ''
  const isIOS = /iPhone|iPad|iPod/iu.test(userAgent)
  const browser = /CriOS/iu.test(userAgent)
    ? 'Chrome iOS'
    : /FxiOS/iu.test(userAgent)
      ? 'Firefox iOS'
      : isIOS ? 'Safari Web App' : 'Web Browser'
  return { platform: isIOS ? 'iOS' : 'Other', browser }
}

export default class BusinessRuntimeBoundary extends Component {
  state = { error: null, diagnostic: null, copyStatus: '' }

  static getDerivedStateFromError(error) {
    return { error, diagnostic: null, copyStatus: '' }
  }

  componentDidCatch(error, info) {
    this.setState({
      diagnostic: this.createDiagnostic(error, info?.componentStack),
    })
  }

  createDiagnostic(error, componentStack = '') {
    const now = this.props.now || defaultNow
    const runtime = this.props.runtime || detectBusinessRuntime
    return buildBusinessRuntimeDiagnostic({
      error,
      componentStack,
      buildId: this.props.buildId,
      occurredAt: now(),
      runtime: runtime(),
    })
  }

  copy = async () => {
    const copyText = this.props.copyText || defaultCopy
    try {
      await copyText(formatBusinessRuntimeDiagnostic(this.currentDiagnostic()))
      this.setState({ copyStatus: '诊断信息已复制' })
    } catch {
      this.setState({ copyStatus: '复制失败，请长按下面的诊断信息手动复制。' })
    }
  }

  reload = () => (this.props.onReload || defaultReload)()

  logout = async () => {
    try {
      await this.props.onLogout?.()
    } catch {
      this.setState({ copyStatus: '退出失败，请关闭页面后重试。' })
    }
  }

  currentDiagnostic() {
    return this.state.diagnostic || this.createDiagnostic(this.state.error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const diagnostic = this.currentDiagnostic()
    const diagnosticText = formatBusinessRuntimeDiagnostic(diagnostic)
    return (
      <main className="auth-shell business-runtime-error-shell">
        <section className="auth-panel auth-status-panel" role="alert">
          <img className="auth-brand-mark" src="/sw-erp-logo.jpg" alt="生旺株式会社标志" />
          <p>生旺株式会社 · ERP 数据中心</p>
          <h1>系统页面发生错误</h1>
          <span>业务界面已安全停止。请复制诊断信息后重新加载，或退出登录。</span>
          <strong className="business-runtime-error-code">{diagnostic.code}</strong>
          <textarea
            className="business-runtime-diagnostic"
            aria-label="诊断信息"
            readOnly
            ref={(field) => { if (field) field.readOnly = true }}
            value={diagnosticText}
          />
          {this.state.copyStatus && <span role="status">{this.state.copyStatus}</span>}
          <div className="auth-account-actions business-runtime-actions">
            <button className="auth-primary-button" type="button" onClick={this.copy}>复制诊断信息</button>
            <button className="auth-secondary-button" type="button" onClick={this.reload}>重新加载</button>
            <button className="auth-secondary-button" type="button" onClick={this.logout}>退出登录</button>
          </div>
        </section>
      </main>
    )
  }
}
