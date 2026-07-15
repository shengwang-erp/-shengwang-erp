import { createAttendancePhotoCleanupHandler } from './handler.js'

const handler = createAttendancePhotoCleanupHandler()

Deno.serve(handler)
