import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS,
  createProjectAddressAutoLocateScheduler,
} from './projectAddressAutoLocate.js'

function fakeTimers() {
  let nextId = 0
  const tasks = new Map()
  return {
    tasks,
    setTimer(task, delay) {
      nextId += 1
      tasks.set(nextId, { task, delay })
      return nextId
    },
    clearTimer(id) { tasks.delete(id) },
    runAll() {
      const pending = [...tasks.values()]
      tasks.clear()
      for (const entry of pending) entry.task()
    },
  }
}

test('only the last scheduled address lookup runs after 1200 ms', () => {
  const timers = fakeTimers()
  const calls = []
  const scheduler = createProjectAddressAutoLocateScheduler(timers)
  scheduler.schedule(() => calls.push('旧地址'))
  scheduler.schedule(() => calls.push('最新地址'))
  assert.deepEqual([...timers.tasks.values()].map(({ delay }) => delay), [
    PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS,
  ])
  timers.runAll()
  assert.deepEqual(calls, ['最新地址'])
})

test('cancel prevents a scheduled address lookup', () => {
  const timers = fakeTimers()
  let calls = 0
  const scheduler = createProjectAddressAutoLocateScheduler(timers)
  scheduler.schedule(() => { calls += 1 })
  scheduler.cancel()
  timers.runAll()
  assert.equal(calls, 0)
})
