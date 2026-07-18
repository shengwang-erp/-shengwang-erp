import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')

test('App threads contract migration callbacks through the SystemSettingsPage boundary', () => {
  const invocationStart = appSource.indexOf('<SystemSettingsPage')
  const invocationEnd = appSource.indexOf('/>', invocationStart)
  const invocationSource = appSource.slice(invocationStart, invocationEnd)
  assert.match(
    invocationSource,
    /loadContractMigrationPreview=\{loadContractMigrationPreview\}/,
  )
  assert.match(
    invocationSource,
    /executeContractMigration=\{executeContractMigration\}/,
  )

  const definitionStart = appSource.indexOf('function SystemSettingsPage({')
  const definitionEnd = appSource.indexOf('}) {', definitionStart)
  const definitionSource = appSource.slice(definitionStart, definitionEnd)
  assert.match(definitionSource, /loadContractMigrationPreview/)
  assert.match(definitionSource, /executeContractMigration/)
})
