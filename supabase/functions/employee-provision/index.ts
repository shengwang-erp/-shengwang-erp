import { withCors } from '../_shared/cors.ts'
import { createEmployeeProvisionHandler } from './handler.js'

const handler = createEmployeeProvisionHandler()

Deno.serve((request) => withCors(request, handler))
