import { withCors } from '../_shared/cors.ts'
import { createEmployeeAdminHandler } from './handler.js'

const handler = createEmployeeAdminHandler()

Deno.serve((request) => withCors(request, handler))
