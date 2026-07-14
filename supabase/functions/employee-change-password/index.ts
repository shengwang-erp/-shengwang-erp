import { withCors } from '../_shared/cors.ts'
import { createEmployeeChangePasswordHandler } from './handler.js'

const handler = createEmployeeChangePasswordHandler()

Deno.serve((request) => withCors(request, handler))
