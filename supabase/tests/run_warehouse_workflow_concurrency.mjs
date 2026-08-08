import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function fail(message) { throw new Error(message) }

export function formatWarehouseWorkflowRunFailure(stderr, stdout) {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
}

function required(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    fail(`missing explicit ${name} for isolated Task 1`)
  }
  return value
}

function port(environment, name, forbidden) {
  const raw = required(environment, name)
  if (!/^[0-9]+$/u.test(raw)) fail(`invalid isolated Task 1 ${name}`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535 || value === forbidden) {
    fail(`invalid isolated Task 1 ${name}`)
  }
  return value
}

async function defaultRun(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  if (result.code !== 0 || result.signal !== null) {
    fail(
      formatWarehouseWorkflowRunFailure(stderr, stdout) ||
      `${command} failed for isolated Task 1`,
    )
  }
  return stdout
}

async function configuration(environment, supplied) {
  for (const name of Object.keys(environment)) {
    if (/^DOCKER_/u.test(name) || name === 'BUILDKIT_HOST') {
      fail('ambient Docker override is forbidden for isolated Task 1')
    }
  }
  const projectId = required(environment, 'WAREHOUSE_TASK1_PROJECT_ID')
  const workdir = required(environment, 'WAREHOUSE_TASK1_WORKDIR')
  const databaseContainer = required(environment, 'WAREHOUSE_TASK1_DB_CONTAINER')
  const dockerContext = required(environment, 'WAREHOUSE_TASK1_DOCKER_CONTEXT')
  const dbPort = port(environment, 'WAREHOUSE_TASK1_DB_PORT', 54322)
  const apiPort = port(environment, 'WAREHOUSE_TASK1_API_PORT', 54321)
  if (
    !/^warehouse-phase3-task1-[a-z0-9-]+$/u.test(projectId) ||
    !/^\/private\/tmp\/warehouse-phase3-task1-[A-Za-z0-9._-]+$/u.test(workdir) ||
    databaseContainer !== `supabase_db_${projectId}` ||
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/u.test(dockerContext)
  ) fail('target identity is not an explicit isolated Task 1 instance')
  if (await supplied.realpath(workdir).catch(() => '') !== workdir) {
    fail('workdir is not canonical for isolated Task 1')
  }
  const config = await supplied.readFile(`${workdir}/supabase/config.toml`, 'utf8')
  const configuredProject = /^project_id = "([^"]+)"$/mu.exec(config)?.[1]
  const configuredApiPort = Number(/\[api\][\s\S]*?\nport = ([0-9]+)\n/u.exec(config)?.[1])
  const configuredDbPort = Number(/\[db\][\s\S]*?\nport = ([0-9]+)\n/u.exec(config)?.[1])
  if (
    configuredProject !== projectId || configuredApiPort !== apiPort || configuredDbPort !== dbPort
  ) fail('config does not match the explicit isolated Task 1 target')
  return Object.freeze({ projectId, workdir, databaseContainer, dockerContext, dbPort, apiPort })
}

async function inspectTarget(target, run) {
  const raw = await run('docker', [
    '--context', target.dockerContext, 'container', 'inspect', target.databaseContainer,
  ])
  let inspected
  try { inspected = JSON.parse(raw) } catch { fail('invalid isolated Task 1 Docker inspection') }
  const container = Array.isArray(inspected) && inspected.length === 1 ? inspected[0] : null
  const bindings = container?.NetworkSettings?.Ports?.['5432/tcp']
  if (
    container?.Name !== `/${target.databaseContainer}` ||
    container?.State?.Running !== true ||
    container?.Config?.Labels?.['com.supabase.cli.project'] !== target.projectId ||
    !Array.isArray(bindings) || bindings.length < 1 || bindings.length > 2 ||
    bindings.some((entry) =>
      entry?.HostPort !== String(target.dbPort) || !['0.0.0.0', '::'].includes(entry?.HostIp))
  ) fail('Docker target is not the explicit isolated Task 1 instance')
}

export async function runWarehouseWorkflowConcurrency(environment, supplied = {}) {
  const dependencies = {
    readFile: supplied.readFile ?? readFile,
    realpath: supplied.realpath ?? realpath,
    randomUuid: supplied.randomUuid ?? randomUUID,
    run: supplied.run ?? defaultRun,
  }
  const target = await configuration(environment, dependencies)
  await inspectTarget(target, dependencies.run)
  await dependencies.run('npx', [
    '--no-install', 'supabase', 'db', 'reset', '--workdir', target.workdir,
  ])
  let primaryError = null
  let nonce = null
  try {
    await inspectTarget(target, dependencies.run)
    nonce = dependencies.randomUuid()
    if (typeof nonce !== 'string' || !UUID.test(nonce)) {
      fail('fresh Task 1 marker nonce is invalid')
    }
    const markerSql = [
      'create extension if not exists pgtap with schema extensions;',
      'create extension if not exists dblink with schema extensions;',
      'create table private.warehouse_task1_test_target(',
      ' singleton boolean primary key default true check(singleton),',
      ' project_id text not null,test_workdir text not null,db_port integer not null,',
      ' api_port integer not null,marker_nonce uuid not null,',
      ' created_at timestamptz not null default clock_timestamp());',
      'revoke all on private.warehouse_task1_test_target from public,anon,authenticated,service_role;',
      'insert into private.warehouse_task1_test_target(',
      ' project_id,test_workdir,db_port,api_port,marker_nonce) values (',
      `'${target.projectId}','${target.workdir}',${target.dbPort},${target.apiPort},'${nonce}');`,
    ].join('')
    await dependencies.run('docker', [
      '--context', target.dockerContext, 'exec', target.databaseContainer,
      'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', markerSql,
    ])

    const proofSql = [
      "begin read only;select concat_ws('|',project_id,test_workdir,db_port,api_port,marker_nonce,",
      " created_at > clock_timestamp()-interval '5 minutes',",
      " exists(select 1 from supabase_migrations.schema_migrations where version='202608080004'))",
      ' from private.warehouse_task1_test_target;commit;',
    ].join('')
    const proof = await dependencies.run('docker', [
      '--context', target.dockerContext, 'exec', target.databaseContainer,
      'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-c', proofSql,
    ])
    const expected = [
      target.projectId, target.workdir, target.dbPort, target.apiPort, nonce, 't', 't',
    ].join('|')
    if (!proof.split('\n').map((line) => line.trim()).includes(expected)) {
      fail('fresh Task 1 marker proof failed')
    }

    await dependencies.run('npx', [
      '--no-install', 'supabase', 'test', 'db',
      'supabase/tests/warehouse_workflow_concurrency.sql', '--workdir', target.workdir,
    ])
  } catch (error) {
    primaryError = error
  }
  let cleanupError = null
  try {
    // The concurrency SQL commits fixtures so two independent connections can see
    // them. Cleanup begins before marker creation and always removes helper state.
    await dependencies.run('npx', [
      '--no-install', 'supabase', 'db', 'reset', '--workdir', target.workdir,
    ])
  } catch (error) {
    cleanupError = error
  }
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], 'workflow proof and cleanup both failed')
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  return Object.freeze({
    projectId: target.projectId, workdir: target.workdir,
    dbPort: target.dbPort, apiPort: target.apiPort, nonce,
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runWarehouseWorkflowConcurrency(process.env)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
