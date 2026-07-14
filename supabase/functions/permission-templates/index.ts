import { withCors } from '../_shared/cors.ts'
import { createPermissionTemplatesHandler } from './handler.js'

const handler = createPermissionTemplatesHandler()

Deno.serve((request) => withCors(request, handler))
