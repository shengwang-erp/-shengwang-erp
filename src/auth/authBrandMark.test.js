import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import postcss from 'postcss'
import { createServer } from 'vite'

async function loadLoginPage() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/auth/LoginPage.jsx')
  } finally {
    await server.close()
  }
}

const loginPageModule = await loadLoginPage()
const stylesSource = await readFile(
  new URL('../styles.css', import.meta.url),
  'utf8',
)

function declarationsFor(selector, media = null) {
  const declarations = new Map()
  postcss.parse(stylesSource, { from: 'styles.css' }).walkRules((rule) => {
    const parentMedia = rule.parent?.type === 'atrule' && rule.parent.name === 'media'
      ? rule.parent.params.replace(/\s+/gu, ' ').trim()
      : null
    if (parentMedia !== media || !rule.selectors.includes(selector)) return
    for (const node of rule.nodes) {
      if (node.type === 'decl') declarations.set(node.prop, node.value)
    }
  })
  return declarations
}

test('login renders the approved transparent oval SW company mark', async () => {
  const markup = renderToStaticMarkup(createElement(loginPageModule.default, {
    onLogin: async () => {},
  }))

  assert.match(
    markup,
    /<img class="auth-brand-mark" src="\/sw-sidebar-mark\.png" alt="生旺株式会社标志"\/>/u,
  )

  const logo = await readFile(
    new URL('../../public/sw-sidebar-mark.png', import.meta.url),
  ).catch(() => Buffer.alloc(0))
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(logo.readUInt32BE(16), 1120)
  assert.equal(logo.readUInt32BE(20), 800)
  assert.equal(logo[25], 6)
})

test('auth layout displays the company mark as an unclipped horizontal oval', () => {
  const desktop = declarationsFor('.auth-brand-mark')
  const mobile = declarationsFor('.auth-brand-mark', '(max-width: 520px)')

  assert.ok(Number.parseFloat(desktop.get('width')) > Number.parseFloat(desktop.get('height')))
  assert.equal(desktop.get('object-fit'), 'contain')
  assert.notEqual(desktop.get('border-radius'), '50%')
  assert.equal(desktop.get('border'), '0')
  assert.ok(Number.parseFloat(mobile.get('width')) > Number.parseFloat(mobile.get('height')))
})
