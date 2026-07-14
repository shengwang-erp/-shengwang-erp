export class EdgeSecurityError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'EdgeSecurityError'
    this.code = code
    this.status = status
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

export function safeErrorResponse(error: unknown) {
  const safeError = error instanceof EdgeSecurityError
    ? error
    : new EdgeSecurityError('INTERNAL_ERROR', '服务暂时不可用', 500)

  return jsonResponse(
    {
      error: {
        code: safeError.code,
        message: safeError.message,
      },
    },
    safeError.status,
  )
}
