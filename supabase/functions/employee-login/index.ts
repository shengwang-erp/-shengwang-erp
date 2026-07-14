import { withCors } from '../_shared/cors.ts'
import { createEmployeeLoginHandler } from './handler.js'

const handler = createEmployeeLoginHandler()

Deno.serve((request) => withCors(request, handler))
