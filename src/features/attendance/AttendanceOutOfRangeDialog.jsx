import { useEffect, useId, useRef } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function AttendanceOutOfRangeDialog({
  confirmation,
  pending = false,
  returnFocus = null,
  onCancel,
  onConfirm,
}) {
  const headingId = useId()
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  const pendingRef = useRef(pending)
  const onCancelRef = useRef(onCancel)
  pendingRef.current = pending
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!confirmation) return undefined
    if (pendingRef.current) dialogRef.current?.focus()
    else cancelRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !pendingRef.current) {
        event.preventDefault()
        onCancelRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])]
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!dialogRef.current?.contains(globalThis.document?.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && globalThis.document?.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && globalThis.document?.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    globalThis.document?.addEventListener('keydown', handleKeyDown)
    return () => {
      globalThis.document?.removeEventListener('keydown', handleKeyDown)
      returnFocus?.isConnected && returnFocus.focus()
    }
  }, [confirmation, returnFocus])

  if (!confirmation) return null
  return (
    <div
      ref={dialogRef}
      className="attendance-out-of-range-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      aria-busy={pending}
      tabIndex={-1}
    >
      <div className="attendance-out-of-range-panel">
        <h2 id={headingId}>当前位置超出项目打卡范围</h2>
        <dl className="attendance-out-of-range-details">
          <div><dt>项目</dt><dd>{confirmation.projectName}</dd></div>
          <div><dt>当前位置距离</dt><dd>{Math.round(confirmation.distanceMeters)} 米</dd></div>
          <div><dt>允许半径</dt><dd>{Math.round(confirmation.radiusMeters)} 米</dd></div>
        </dl>
        <p>请确认是否使用本次定位结果继续打卡。</p>
        <div className="attendance-action-row">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={() => onCancel?.()}
          >
            取消，重新定位
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={pending}
            onClick={() => onConfirm?.()}
          >
            仍然打卡
          </button>
        </div>
      </div>
    </div>
  )
}
