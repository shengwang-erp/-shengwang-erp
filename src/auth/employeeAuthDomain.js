export const DEPARTMENT_OPTIONS = Object.freeze([
  '总务部',
  '营业部',
  '事务部',
  '后勤部',
  '设计部',
  '工程部',
  '仓库管理部',
  '电商部',
  '采购部',
  '财务部',
])

export const POSITION_OPTIONS = Object.freeze([
  '社长',
  '总务部长',
  '营业部长',
  '部长',
  '主任',
  '主任设计师',
  '设计师',
  '仓库管理员',
  '工事部长',
  '职长',
  '大工',
  '中工',
  '小工',
  '会计主管',
  '会计',
])

const EMPLOYEE_NUMBER_PATTERN = /^SW-\d{3,}$/
const UPPERCASE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWERCASE_ALPHABET = 'abcdefghijkmnopqrstuvwxyz'
const DIGIT_ALPHABET = '23456789'
const PASSWORD_ALPHABET = `${UPPERCASE_ALPHABET}${LOWERCASE_ALPHABET}${DIGIT_ALPHABET}`
const TEMPORARY_PASSWORD_LENGTH = 12

export function normalizeEmployeeNumber(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function isEmployeeNumber(value) {
  return EMPLOYEE_NUMBER_PATTERN.test(normalizeEmployeeNumber(value))
}

function toBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return globalThis
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '')
}

export async function buildInternalAuthAlias(
  employeeNumber,
  secret,
  cryptoImpl = globalThis.crypto,
) {
  const normalizedEmployeeNumber = normalizeEmployeeNumber(employeeNumber)
  if (!isEmployeeNumber(normalizedEmployeeNumber)) {
    throw new TypeError('员工编号格式无效')
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('内部认证别名密钥不能为空')
  }
  if (!cryptoImpl?.subtle) {
    throw new TypeError('Web Crypto API 不可用')
  }

  const encoder = new TextEncoder()
  const key = await cryptoImpl.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await cryptoImpl.subtle.sign(
    'HMAC',
    key,
    encoder.encode(normalizedEmployeeNumber),
  )

  return `sw-${toBase64Url(new Uint8Array(digest))}@auth.invalid`
}

function defaultRandomBytes(size) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new TypeError('Web Crypto API 不可用')
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(size))
}

function pickCharacter(alphabet, byte) {
  return alphabet[byte % alphabet.length]
}

export function generateTemporaryPassword(randomBytes = defaultRandomBytes) {
  const bytes = randomBytes(TEMPORARY_PASSWORD_LENGTH)
  if (!(bytes instanceof Uint8Array) || bytes.length < TEMPORARY_PASSWORD_LENGTH) {
    throw new TypeError('randomBytes 必须返回至少 12 字节的 Uint8Array')
  }

  const characters = [
    pickCharacter(UPPERCASE_ALPHABET, bytes[0]),
    pickCharacter(LOWERCASE_ALPHABET, bytes[1]),
    pickCharacter(DIGIT_ALPHABET, bytes[2]),
  ]
  for (let index = characters.length; index < TEMPORARY_PASSWORD_LENGTH; index += 1) {
    characters.push(pickCharacter(PASSWORD_ALPHABET, bytes[index]))
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = bytes[index] % (index + 1)
    ;[characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]]
  }

  return characters.join('')
}

export function mergePermissionKeys(departmentKeys, positionKeys) {
  const departmentPermissionKeys = Array.isArray(departmentKeys) ? departmentKeys : []
  const positionPermissionKeys = Array.isArray(positionKeys) ? positionKeys : []
  return [...new Set([...departmentPermissionKeys, ...positionPermissionKeys])]
}

export function isPersonnelAdministrator(employee = {}) {
  const employeeNumber = employee.employeeNumber ?? employee.employee_number
  if (normalizeEmployeeNumber(employeeNumber) === 'SW-000') return true

  const accountStatus = employee.accountStatus ?? employee.account_status
  const employmentStatus = employee.employmentStatus ?? employee.employment_status
  return (
    employee.position === '社长' &&
    accountStatus === 'active' &&
    employmentStatus === '在职'
  )
}
