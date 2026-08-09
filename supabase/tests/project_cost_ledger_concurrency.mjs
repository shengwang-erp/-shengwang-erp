import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'

const ISOLATED_WORKDIR = /^\/private\/tmp\/kaobeierp-project-cost-ledger\.[A-Za-z0-9_-]+$/u
const ISOLATED_PROJECT = /^kaobeierp-project-cost-ledger-[a-z0-9-]+$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function fail(message) { throw new Error(message) }

async function run(command, args) {
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
    fail([stderr.trim(), stdout.trim()].filter(Boolean).join('\n') || `${command} failed`)
  }
  return stdout
}

function argumentWorkdir(argv) {
  if (argv.length !== 2 || argv[0] !== '--workdir') {
    fail('usage: project_cost_ledger_concurrency.mjs --workdir <isolated-workdir>')
  }
  return argv[1]
}

function configValue(text, section, name) {
  const block = new RegExp(`\\[${section.replace('.', '\\.') }\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'u')
    .exec(text)?.[1]
  return block ? new RegExp(`^${name} = (?:"([^"]+)"|([0-9]+))$`, 'mu').exec(block) : null
}

function statusValue(text, name) {
  const value = new RegExp(`^${name}="([^"]+)"$`, 'mu').exec(text)?.[1]
  if (!value) fail(`isolated Supabase status omitted ${name}`)
  return value
}

async function assertIsolatedTarget(workdir) {
  const canonical = await realpath(workdir).catch(() => '')
  if (canonical !== workdir || !ISOLATED_WORKDIR.test(canonical)) {
    fail('concurrency target is not the explicit isolated project-cost workdir')
  }
  const config = await readFile(`${canonical}/supabase/config.toml`, 'utf8')
  const projectId = /^project_id = "([^"]+)"$/mu.exec(config)?.[1]
  const apiPort = Number(configValue(config, 'api', 'port')?.[2])
  const dbPort = Number(configValue(config, 'db', 'port')?.[2])
  if (!ISOLATED_PROJECT.test(projectId ?? '') || !Number.isInteger(apiPort) ||
      !Number.isInteger(dbPort) || apiPort === 54321 || dbPort === 54322 ||
      apiPort < 1024 || dbPort < 1024 || apiPort === dbPort) {
    fail('isolated Supabase config identity or ports are unsafe')
  }
  const container = `supabase_db_${projectId}`
  const inspected = JSON.parse(await run('docker', ['inspect', container]))
  const database = Array.isArray(inspected) && inspected.length === 1 ? inspected[0] : null
  const bindings = database?.NetworkSettings?.Ports?.['5432/tcp']
  if (database?.Name !== `/${container}` || database?.State?.Running !== true ||
      database?.Config?.Labels?.['com.supabase.cli.project'] !== projectId ||
      !Array.isArray(bindings) || bindings.length < 1 ||
      bindings.some(({ HostPort }) => HostPort !== String(dbPort))) {
    fail('database container does not match the explicit isolated target')
  }
  const status = await run('npx', [
    '--no-install', 'supabase', 'status', '--output', 'env', '--workdir', canonical,
  ])
  const apiUrl = statusValue(status, 'API_URL')
  const anonKey = statusValue(status, 'ANON_KEY')
  const parsedApi = new URL(apiUrl)
  if (parsedApi.protocol !== 'http:' || parsedApi.hostname !== '127.0.0.1' ||
      Number(parsedApi.port) !== apiPort || parsedApi.pathname !== '/') {
    fail('status API URL is not the configured loopback endpoint')
  }
  return Object.freeze({ workdir: canonical, projectId, container, apiUrl, anonKey })
}

async function jsonRequest(url, options) {
  const startedAt = performance.now()
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { fail('local API returned non-JSON data') }
  return {
    ok: response.ok,
    status: response.status,
    body,
    elapsedMs: Math.round(performance.now() - startedAt),
  }
}

async function passwordGrant(target, email, password) {
  return jsonRequest(`${target.apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: target.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.sub === 'string' && UUID.test(payload.sub) ? payload.sub : null
  } catch { return null }
}

async function createAccount(target, email, password) {
  return jsonRequest(`${target.apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: target.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

async function ensureAccount(target, email, password) {
  let login = await passwordGrant(target, email, password)
  if (!login.ok) {
    const signup = await createAccount(target, email, password)
    const accountAlreadyExists = signup.status === 422 &&
      signup.body?.error_code === 'user_already_exists'
    if (!signup.ok && signup.status !== 504 && !accountAlreadyExists) {
      fail(`fixture accountant signup failed with HTTP ${signup.status}: ${JSON.stringify(signup.body)}`)
    }
    login = signup.ok && typeof signup.body?.access_token === 'string'
      ? signup
      : await passwordGrant(target, email, password)
  }
  const token = login.body?.access_token
  const userId = typeof token === 'string' ? tokenSubject(token) : null
  if (!login.ok || typeof token !== 'string' || !userId) {
    fail(`fixture accountant sign-in failed with HTTP ${login.status}: ${JSON.stringify(login.body)}`)
  }
  return Object.freeze({ token, userId, signInMs: login.elapsedMs })
}

async function rpc(target, token, name, body) {
  return jsonRequest(`${target.apiUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: target.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function fixtureSql(fixture) {
  return `
begin;
alter role authenticator set statement_timeout = '60s';
alter role anon set statement_timeout = '60s';
alter role authenticated set statement_timeout = '60s';
notify pgrst, 'reload config';
insert into public.employee_profiles(
  id,employee_number,auth_user_id,name,department,position,
  employment_status,account_status,must_change_password
) values
('${fixture.profileA}','${fixture.employeeNumberA}','${fixture.userA}','并发会计甲','财务部','会计','在职','active',false),
('${fixture.profileB}','${fixture.employeeNumberB}','${fixture.userB}','并发会计乙','财务部','会计','在职','active',false)
on conflict (auth_user_id) do nothing;
insert into public.permission_grants(subject_type,subject_code,permission_key) values
('department','财务部','module.project_costs.view'),
('department','财务部','module.project_costs.create'),
('department','财务部','module.project_costs.update')
on conflict do nothing;
insert into public.projects(record_key,payload,status) values
('${fixture.projectId}',jsonb_build_object('projectId','${fixture.projectId}','projectName','并发测试项目'),'active');
insert into public.project_cost_records(record_key,payload,status) values
('${fixture.costId}',jsonb_build_object(
  'costRecordId','${fixture.costId}','projectId','${fixture.projectId}',
  'projectName','并发测试项目','costType','其他费用','amount',100,
  'date','2099-12-30','operator','系统测试','remark','双会话版本冲突'
),'active'),
('${fixture.allocationCostId}',jsonb_build_object(
  'costRecordId','${fixture.allocationCostId}','projectId','${fixture.projectId}',
  'projectName','并发测试项目','costType','其他费用','amount',100,
  'date','2099-12-30','operator','系统测试','remark','双会话分摊冲突'
),'active');
commit;`
}

function fixture(target) {
  const values = Array.from({ length: 3 }, () => randomUUID())
  if (values.some((value) => !UUID.test(value))) fail('runtime UUID generator is unsafe')
  const [nonce, profileA, profileB] = values
  const short = nonce.slice(0, 8)
  return Object.freeze({
    short, profileA, profileB,
    employeeNumberA: `SW-9${Number.parseInt(nonce.slice(0, 12).replaceAll('-', ''), 16)}`,
    employeeNumberB: `SW-8${Number.parseInt(nonce.slice(12, 24).replaceAll('-', ''), 16)}`,
    emailA: `ledger-race-a-${target.projectId.slice(-12)}@auth.invalid`,
    emailB: `ledger-race-b-${target.projectId.slice(-12)}@auth.invalid`,
    password: `Ledger-Race-${target.projectId.slice(-8)}!`,
    projectId: `LEDGER-RACE-P-${nonce}`,
    costId: `LEDGER-RACE-COST-${nonce}`,
    allocationCostId: `LEDGER-RACE-COST-ALLOCATION-${nonce}`,
    sourceKey: `legacy-manual:LEDGER-RACE-COST-${nonce}`,
    allocationSourceKey: `legacy-manual:LEDGER-RACE-COST-ALLOCATION-${nonce}`,
  })
}

export async function runProjectCostLedgerConcurrency(argv = process.argv.slice(2)) {
  const target = await assertIsolatedTarget(argumentWorkdir(argv))
  const base = fixture(target)
  const accountA = await ensureAccount(target, base.emailA, base.password)
  const accountB = await ensureAccount(target, base.emailB, base.password)
  const data = Object.freeze({
    ...base, userA: accountA.userId, userB: accountB.userId,
  })
  await run('docker', [
    'exec', target.container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', fixtureSql(data),
  ])
  const tokenA = accountA.token
  const tokenB = accountB.token

  let release
  const barrier = new Promise((resolve) => { release = resolve })
  const adjust = (token, reason) => barrier.then(() => rpc(
    target, token, 'create_project_cost_adjustment_secure', {
      p_source_key: data.sourceKey,
      p_expected_version: 1,
      p_adjustment_amount: 10,
      p_reason: reason,
    },
  ))
  const calls = [adjust(tokenA, '并发会计甲调整'), adjust(tokenB, '并发会计乙调整')]
  release()
  const results = await Promise.all(calls)
  const succeeded = results.filter((result) => result.ok)
  const conflicted = results.filter((result) =>
    !result.ok && result.body?.code === 'P0001' &&
    result.body?.hint === 'PROJECT_COST_LEDGER_VERSION_CONFLICT')
  if (succeeded.length !== 1 || conflicted.length !== 1) {
    fail(`expected one success and one version conflict, received ${JSON.stringify(results)}`)
  }

  let releaseAllocation
  const allocationBarrier = new Promise((resolve) => { releaseAllocation = resolve })
  const allocate = (token, reason) => allocationBarrier.then(() => rpc(
    target, token, 'replace_project_cost_allocations_secure', {
      p_source_key: data.allocationSourceKey,
      p_expected_version: 1,
      p_reason: reason,
      p_allocations: [{ projectId: data.projectId, amount: 100 }],
    },
  ))
  const allocationCalls = [
    allocate(tokenA, '并发会计甲分摊'),
    allocate(tokenB, '并发会计乙分摊'),
  ]
  releaseAllocation()
  const allocationResults = await Promise.all(allocationCalls)
  const allocationSucceeded = allocationResults.filter((result) => result.ok)
  const allocationConflicted = allocationResults.filter((result) =>
    !result.ok && result.body?.code === 'P0001' &&
    result.body?.hint === 'PROJECT_COST_LEDGER_VERSION_CONFLICT')
  if (allocationSucceeded.length !== 1 || allocationConflicted.length !== 1) {
    fail(`expected one allocation success and one version conflict, received ${JSON.stringify(allocationResults)}`)
  }

  const audit = await rpc(target, tokenA, 'list_project_cost_audit_secure', {
    p_filters: {
      projectId: data.projectId, dateFrom: '2099-12-30', dateTo: '2099-12-30',
    },
  })
  const events = audit.body?.events
  const adjustmentEvents = Array.isArray(events)
    ? events.filter((event) => event.sourceKey === data.sourceKey)
    : []
  const allocationEvents = Array.isArray(events)
    ? events.filter((event) => event.sourceKey === data.allocationSourceKey)
    : []
  if (!audit.ok || adjustmentEvents.length !== 1 ||
      adjustmentEvents[0]?.eventType !== 'adjustment' ||
      adjustmentEvents[0]?.sequenceNo !== 1 || adjustmentEvents[0]?.amountBefore !== 100 ||
      adjustmentEvents[0]?.amountAfter !== 110 || adjustmentEvents[0]?.adjustmentAmount !== 10) {
    fail('concurrent loser left a partial or malformed audit trail')
  }
  if (allocationEvents.length !== 1 || allocationEvents[0]?.eventType !== 'allocation' ||
      allocationEvents[0]?.sequenceNo !== 1 || allocationEvents[0]?.amountBefore !== 100 ||
      allocationEvents[0]?.amountAfter !== 100 ||
      allocationEvents[0]?.allocationsAfter?.length !== 1 ||
      allocationEvents[0]?.allocationsAfter?.[0]?.projectId !== data.projectId ||
      allocationEvents[0]?.allocationsAfter?.[0]?.amount !== 100) {
    fail('concurrent allocation loser left a partial or malformed audit trail')
  }
  const ledger = await rpc(target, tokenA, 'list_project_cost_ledger_secure', {
    p_filters: {
      projectId: data.projectId, dateFrom: '2099-12-30', dateTo: '2099-12-30',
      page: 1, pageSize: 20,
    },
  })
  const row = ledger.body?.rows?.find((candidate) => candidate.sourceKey === data.sourceKey)
  const allocationRow = ledger.body?.rows?.find(
    (candidate) => candidate.sourceKey === data.allocationSourceKey,
  )
  if (!ledger.ok || ledger.body?.totalRows !== 2 || row?.sourceKey !== data.sourceKey ||
      row?.originalAmount !== 100 || row?.adjustmentAmount !== 10 ||
      row?.effectiveAmount !== 110 || row?.version !== 2) {
    fail('concurrent mutation did not leave one complete ledger version')
  }
  if (allocationRow?.originalAmount !== 100 || allocationRow?.adjustmentAmount !== 0 ||
      allocationRow?.effectiveAmount !== 100 || allocationRow?.version !== 2 ||
      allocationRow?.allocations?.length !== 1 ||
      allocationRow?.allocations?.[0]?.projectId !== data.projectId ||
      allocationRow?.allocations?.[0]?.amount !== 100) {
    fail('concurrent allocation did not leave one complete ledger version')
  }
  return Object.freeze({
    projectId: target.projectId,
    apiUrl: target.apiUrl,
    signInMs: [accountA.signInMs, accountB.signInMs],
    adjustmentRace: results.map(({ status, elapsedMs, body }) => ({
      status, elapsedMs, code: body?.code ?? null, hint: body?.hint ?? null,
    })),
    allocationRace: allocationResults.map(({ status, elapsedMs, body }) => ({
      status, elapsedMs, code: body?.code ?? null, hint: body?.hint ?? null,
    })),
    successCount: succeeded.length,
    conflictCount: conflicted.length,
    allocationSuccessCount: allocationSucceeded.length,
    allocationConflictCount: allocationConflicted.length,
    auditEventCount: Array.isArray(events) ? events.length : 0,
  })
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = await runProjectCostLedgerConcurrency()
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
