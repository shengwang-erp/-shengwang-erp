import { useEffect, useRef } from 'react'

function topLevelModalNode(node, body) {
  let current = node
  while (current?.parentNode && current.parentNode !== body) current = current.parentNode
  return current
}

export function useProjectCostModalA11y({ open, submitting, onRequestClose }) {
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  const closeRef = useRef(onRequestClose)
  const submittingRef = useRef(submitting)
  const releaseRef = useRef(() => {})
  closeRef.current = onRequestClose
  submittingRef.current = submitting

  useEffect(() => {
    if (!open) return undefined
    const dialog = dialogRef.current
    const documentRef = dialog?.ownerDocument ?? globalThis.document
    const body = documentRef?.body
    if (!dialog || !body) return undefined
    const opener = documentRef.activeElement
    const modalRoot = topLevelModalNode(dialog, body)
    const backgrounds = Array.from(body.children ?? []).filter((node) => node !== modalRoot)
    const previous = backgrounds.map((node) => ({
      node, inert: node.inert === true, ariaHidden: node.getAttribute?.('aria-hidden'),
    }))
    for (const node of backgrounds) {
      node.inert = true
      node.setAttribute?.('aria-hidden', 'true')
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      documentRef.removeEventListener('keydown', keydown)
      for (const item of previous) {
        item.node.inert = item.inert
        if (item.ariaHidden === null) item.node.removeAttribute?.('aria-hidden')
        else item.node.setAttribute?.('aria-hidden', item.ariaHidden)
      }
      if (opener?.focus) opener.focus()
    }
    const requestClose = () => {
      if (submittingRef.current) return
      release()
      closeRef.current?.()
    }
    const keydown = (event) => {
      if (event.key === 'Escape') {
        if (!submittingRef.current) {
          event.preventDefault()
          requestClose()
        }
        return
      }
      if (event.key !== 'Tab') return
      const focusables = Array.from(dialog.querySelectorAll(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )).filter((node) => !node.disabled)
      if (focusables.length === 0) return
      const index = focusables.indexOf(documentRef.activeElement)
      const next = event.shiftKey
        ? (index <= 0 ? focusables.at(-1) : focusables[index - 1])
        : (index < 0 || index === focusables.length - 1 ? focusables[0] : focusables[index + 1])
      event.preventDefault()
      next.focus()
    }
    releaseRef.current = release
    documentRef.addEventListener('keydown', keydown)
    ;(initialFocusRef.current ?? dialog).focus?.()
    return release
  }, [open])

  return {
    dialogRef,
    initialFocusRef,
    requestClose() {
      if (submittingRef.current) return
      releaseRef.current()
      closeRef.current?.()
    },
  }
}
