import { withCors } from '../_shared/cors.ts'
import { createEmployeeBootstrapAdminHandler } from './handler.js'

const handler = createEmployeeBootstrapAdminHandler()

Deno.serve((request) => withCors(request, handler))
