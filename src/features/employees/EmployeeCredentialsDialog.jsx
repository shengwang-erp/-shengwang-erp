import { useEffect, useRef, useState } from 'react'

export default function EmployeeCredentialsDialog({
  employeeNumber,
  initialPassword,
  onClose,
}) {
  const dialogRef = useRef(null)
  const firstActionRef = useRef(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [copyError, setCopyError] = useState('')

  useEffect(() => {
    firstActionRef.current?.focus()
  }, [])

  const copyText = async (value, successMessage) => {
    setCopyStatus('')
    setCopyError('')
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(successMessage)
    } catch {
      setCopyError('复制失败，请手动选择并安全保存凭据')
    }
  }

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="credentials-backdrop">
      <section
        ref={dialogRef}
        className="credentials-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credentials-dialog-title"
        aria-describedby="credentials-dialog-guidance"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="credentials-heading">
          <p>一次性安全交付</p>
          <h2 id="credentials-dialog-title">员工初始凭据</h2>
        </div>

        <p id="credentials-dialog-guidance" className="credentials-warning">
          初始密码关闭后无法再次查看。复制内容会保留在操作系统剪贴板中，请仅通过安全渠道交付。
        </p>

        <div className="credentials-grid">
          <div>
            <span>员工编号</span>
            <strong>{employeeNumber}</strong>
          </div>
          <div>
            <span>初始密码</span>
            <strong>{initialPassword}</strong>
          </div>
        </div>

        <div className="credentials-copy-actions">
          <button
            ref={firstActionRef}
            className="ghost-button"
            type="button"
            onClick={() => copyText(employeeNumber, '员工编号已复制')}
          >复制员工编号</button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => copyText(initialPassword, '初始密码已复制')}
          >复制初始密码</button>
          <button
            className="primary-button"
            type="button"
            onClick={() =>
              copyText(
                `员工编号：${employeeNumber}\n初始密码：${initialPassword}`,
                '员工编号和初始密码已复制',
              )
            }
          >全部复制</button>
        </div>

        {copyStatus && <p className="credentials-copy-status" role="status">{copyStatus}</p>}
        {copyError && <p className="credentials-copy-error" role="alert">{copyError}</p>}

        <label className="credentials-acknowledgement">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>我已安全保存并交付以上凭据</span>
        </label>

        <button
          className="primary-button credentials-close-button"
          type="button"
          disabled={!acknowledged}
          onClick={() => {
            if (acknowledged) onClose()
          }}
        >确认并关闭</button>
      </section>
    </div>
  )
}
