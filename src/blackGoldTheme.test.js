import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import postcss from 'postcss'

const [themeSource, mainSource, appSource, shellSource, executiveDashboardStyles] = await Promise.all([
  readFile(new URL('./blackGoldTheme.css', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('./main.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./DesktopAdminShell.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./features/executive-dashboard/executiveDashboard.css', import.meta.url), 'utf8'),
])

const themeRoot = postcss.parse(themeSource, { from: 'blackGoldTheme.css' })

function declarationsFor(selector, media = null) {
  const declarations = new Map()
  themeRoot.walkRules((rule) => {
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

test('black-gold theme loads after legacy styles and defines the exact palette tokens', () => {
  const legacyIndex = mainSource.indexOf("import './styles.css'")
  const themeIndex = mainSource.indexOf("import './blackGoldTheme.css'")
  assert.ok(legacyIndex >= 0)
  assert.ok(themeIndex > legacyIndex)

  const expectedTokens = new Map([
    ['--erp-bg-canvas', '#080806'],
    ['--erp-bg-surface', '#0f0f0d'],
    ['--erp-bg-elevated', '#171612'],
    ['--erp-bg-hover', '#211f18'],
    ['--erp-border-subtle', '#3a3120'],
    ['--erp-accent-gold', '#d6aa5c'],
    ['--erp-accent-gold-soft', '#f0c56d'],
    ['--erp-text-primary', '#f4efe4'],
    ['--erp-text-muted', '#9c9485'],
    ['--erp-status-success', '#63b36a'],
    ['--erp-status-danger', '#e05c46'],
    ['--erp-status-warning', '#d98a3d'],
    ['--erp-status-info', '#6d94bd'],
  ])
  const root = postcss.parse(themeSource, { from: 'blackGoldTheme.css' })
  const tokenRule = root.nodes.find((node) =>
    node.type === 'rule' && node.selectors.includes('.erp-black-gold'))
  assert.ok(tokenRule)
  const actualTokens = new Map(tokenRule.nodes
    .filter((node) => node.type === 'decl')
    .map((node) => [node.prop, node.value.toLowerCase()]))
  for (const [token, value] of expectedTokens) assert.equal(actualTokens.get(token), value, token)
  const dashboardTokens = new Set(
    [...executiveDashboardStyles.matchAll(/var\((--erp-[a-z0-9-]+)/gu)].map((match) => match[1]),
  )
  for (const token of dashboardTokens) assert.equal(actualTokens.has(token), true, token)
})

test('every theme selector is ERP-scoped and login/auth remain untouched', () => {
  const root = postcss.parse(themeSource, { from: 'blackGoldTheme.css' })
  let ruleCount = 0
  root.walkRules((rule) => {
    ruleCount += 1
    for (const selector of rule.selectors) {
      assert.match(selector.trim(), /^\.erp-black-gold(?:\b|\s|\.|:|\[)/u)
      assert.doesNotMatch(selector, /(?:^|[-_.])(?:login|auth)(?:[-_.]|$)/iu)
    }
  })
  assert.ok(ruleCount >= 35)
  assert.doesNotMatch(themeSource, /(?:^|[,{]\s*)(?:html|body|button|input|select|textarea)(?:\b|\s|:|\[)/mu)
  assert.doesNotMatch(themeSource, /@keyframes\b/iu)
})

test('theme covers shell, business surfaces, exact responsive tiers, and reduced motion', () => {
  for (const marker of [
    '.erp-black-gold .desktop-admin-sidebar',
    '.erp-black-gold .top-panel',
    '.erp-black-gold .summary-grid',
    '.erp-black-gold .module-grid',
    '.erp-black-gold .page-shell',
    '.erp-black-gold .form-card',
    '.erp-black-gold .field',
    '.erp-black-gold .filter-panel',
    '.erp-black-gold .stats-grid',
    '.erp-black-gold .stat-card',
    '.erp-black-gold .record-card',
    '.erp-black-gold .payment-table',
    '.erp-black-gold .empty-state',
    '.erp-black-gold .project-page',
    '.erp-black-gold .personnel-page',
    '.erp-black-gold .labor-accounting-page',
    '.erp-black-gold .attendance-page',
    '.erp-black-gold .contract-revenue-page',
    '.erp-black-gold .accounting-cost-page',
    '.erp-black-gold .purchase-management-page',
    '.erp-black-gold .vehicle-management-page',
    '.erp-black-gold .inventory-section',
    '.erp-black-gold .tool-management-page',
    '.erp-black-gold .mobile-bottom-navigation',
  ]) assert.match(themeSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), marker)

  assert.match(themeSource, /\.erp-black-gold \.desktop-admin-topbar\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*space-between[^}]*gap:\s*12px/u)
  assert.match(themeSource, /\.erp-black-gold \.desktop-admin-topbar-user\s*>\s*span\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*clamp\([^}]*overflow:\s*hidden/u)
  assert.match(themeSource, /\.erp-black-gold \.desktop-admin-topbar-user\s*>\s*span\s*>\s*(?:strong|small)[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/u)
  assert.match(themeSource, /\.erp-black-gold \.desktop-admin-topbar-user\s*>\s*button\s*\{[^}]*white-space:\s*nowrap[^}]*border:\s*1px solid var\(--erp-border-gold-muted\)[^}]*color:\s*var\(--erp-accent-gold-soft\)[^}]*background:\s*var\(--erp-accent-gold-surface\)/u)

  const root = postcss.parse(themeSource, { from: 'blackGoldTheme.css' })
  const media = []
  root.walkAtRules('media', (rule) => media.push(rule.params.replace(/\s+/gu, ' ').trim()))
  for (const required of [
    '(max-width: 767px)',
    '(min-width: 768px) and (max-width: 1023px)',
    '(min-width: 1024px)',
    '(prefers-reduced-motion: reduce)',
  ]) assert.equal(media.includes(required), true, required)

  assert.match(themeSource, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.erp-black-gold \.mobile-bottom-navigation\s*\{[\s\S]*?position:\s*fixed[\s\S]*?padding-bottom:\s*max\([^;]*env\(safe-area-inset-bottom\)/u)
  const mobile = themeSource.match(
    /@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/u,
  )?.[1] ?? ''
  assert.match(mobile, /\.erp-black-gold \.desktop-admin-workspace\s*\{[^}]*display:\s*block\s*!important/u)
  assert.match(mobile, /\.erp-black-gold \.desktop-admin-topbar\s*\{[^}]*position:\s*sticky\s*!important[^}]*display:\s*flex\s*!important/u)
  assert.match(mobile, /\.erp-black-gold \.desktop-admin-content\s*\{[^}]*display:\s*block\s*!important[^}]*padding-bottom:\s*calc\(82px \+ env\(safe-area-inset-bottom\)\)/u)
  const compactDesktop = themeSource.match(
    /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*1023px\)\s*\{([\s\S]*?)\n\}/u,
  )?.[1] ?? ''
  assert.match(compactDesktop, /\.erp-black-gold \.desktop-admin-sidebar\s*\{[^}]*position:\s*static\s*!important[^}]*display:\s*block\s*!important[^}]*min-height:\s*0\s*!important/u)
  assert.match(compactDesktop, /\.erp-black-gold \.desktop-admin-workspace\s*\{[^}]*display:\s*block\s*!important[^}]*margin-left:\s*0\s*!important/u)
  assert.match(compactDesktop, /\.erp-black-gold \.desktop-admin-topbar\s*\{[^}]*position:\s*static\s*!important[^}]*display:\s*flex\s*!important/u)
  assert.match(compactDesktop, /\.erp-black-gold \.desktop-admin-content\s*\{[^}]*display:\s*block\s*!important[^}]*padding-top:\s*0\s*!important/u)
})

test('black-gold overrides legacy light module, purchase table, and project form surfaces', () => {
  const moduleTitle = declarationsFor('.erp-black-gold .module-copy strong')
  assert.equal(moduleTitle.get('color'), 'var(--erp-accent-gold-soft)')

  const moduleCount = declarationsFor('.erp-black-gold .module-count')
  assert.equal(moduleCount.get('background'), 'var(--erp-bg-elevated)')
  assert.equal(moduleCount.get('border'), '1px solid var(--erp-border-subtle)')

  const moduleAction = declarationsFor('.erp-black-gold .module-action')
  assert.equal(moduleAction.get('color'), 'var(--erp-accent-gold-soft)')
  assert.equal(moduleAction.get('background'), 'var(--erp-accent-gold-surface)')
  assert.equal(moduleAction.get('border'), '1px solid var(--erp-border-gold-muted)')

  const paymentHeader = declarationsFor('.erp-black-gold .payment-table th')
  const paymentCell = declarationsFor('.erp-black-gold .payment-table td')
  const paymentRow = declarationsFor('.erp-black-gold .payment-table tbody tr')
  const paymentHover = declarationsFor('.erp-black-gold .payment-table tbody tr:hover td')
  assert.equal(paymentHeader.get('background'), 'var(--erp-bg-elevated)')
  assert.equal(paymentCell.get('background'), 'var(--erp-bg-surface)')
  assert.equal(paymentRow.get('background'), 'var(--erp-bg-surface)')
  assert.equal(paymentHover.get('background'), 'var(--erp-bg-hover)')

  const mobileMedia = '(max-width: 767px)'
  const mobilePaymentRow = declarationsFor(
    '.erp-black-gold .payment-table tbody tr',
    mobileMedia,
  )
  const mobilePaymentCell = declarationsFor('.erp-black-gold .payment-table td', mobileMedia)
  const mobilePaymentHover = declarationsFor(
    '.erp-black-gold .payment-table tbody tr:hover td',
    mobileMedia,
  )
  assert.equal(mobilePaymentRow.get('background'), 'var(--erp-bg-surface)')
  assert.equal(mobilePaymentRow.get('border'), '1px solid var(--erp-border-subtle)')
  assert.equal(mobilePaymentCell.get('background'), 'var(--erp-bg-surface)')
  assert.equal(mobilePaymentHover.get('background'), 'var(--erp-bg-hover)')

  const projectHeadingStrong = declarationsFor(
    '.erp-black-gold .project-page .project-form-heading strong',
  )
  const projectHeadingSmall = declarationsFor(
    '.erp-black-gold .project-page .project-form-heading small',
  )
  const locationSection = declarationsFor(
    '.erp-black-gold .project-page .project-location-form-section',
  )
  const locationTitle = declarationsFor(
    '.erp-black-gold .project-page .project-location-form-title strong',
  )
  const radiusHelp = declarationsFor(
    '.erp-black-gold .project-page .project-radius-field p',
  )
  assert.equal(projectHeadingStrong.get('color'), 'var(--erp-text-primary)')
  assert.equal(projectHeadingSmall.get('color'), 'var(--erp-text-muted)')
  assert.equal(locationSection.get('background'), 'var(--erp-bg-elevated)')
  assert.equal(locationSection.get('border'), '1px solid var(--erp-border-subtle)')
  assert.equal(locationTitle.get('color'), 'var(--erp-text-primary)')
  assert.equal(radiusHelp.get('color'), 'var(--erp-text-muted)')
})

test('accounting labels are gold while monetary values remain white', () => {
  for (const selector of [
    '.erp-black-gold .accounting-cost-page .subsection-title h2',
    '.erp-black-gold .accounting-cost-page .subsection-title span',
    '.erp-black-gold .accounting-cost-page .stat-card span',
  ]) {
    assert.equal(
      declarationsFor(selector).get('color'),
      'var(--erp-accent-gold-soft)',
      selector,
    )
  }

  assert.equal(
    declarationsFor('.erp-black-gold .stat-card strong').get('color'),
    'var(--erp-text-primary)',
  )
})

test('compact desktop resets legacy desktop geometry and wraps the menu at every 768-1023 width', () => {
  const media = '(min-width: 768px) and (max-width: 1023px)'
  const menu = declarationsFor('.erp-black-gold .desktop-admin-menu', media)
  const menuItem = declarationsFor('.erp-black-gold .desktop-admin-menu-item', media)
  const topbar = declarationsFor('.erp-black-gold .desktop-admin-topbar', media)

  assert.equal(menu.get('display'), 'flex')
  assert.equal(menu.get('flex-wrap'), 'wrap')
  assert.equal(menu.get('margin-top'), '0')
  assert.equal(menu.get('overflow'), 'visible')
  assert.equal(menu.has('overflow-x'), false)
  assert.equal(menuItem.get('flex'), '1 1 156px')
  assert.equal(topbar.get('flex-wrap'), 'wrap')
  assert.equal(topbar.get('height'), 'auto')
  assert.equal(topbar.get('min-height'), '62px')
  assert.equal(topbar.get('padding'), '10px 16px')
})

test('Home and mobile surfaces consume shared route and access sources', () => {
  assert.match(appSource, /from ['"]\.\/auth\/businessAccess\.js['"]/u)
  assert.match(appSource, /from ['"]\.\/navigation\/adminRoutes\.js['"]/u)
  assert.doesNotMatch(appSource.slice(appSource.indexOf('function HomePage'), appSource.indexOf('function SystemSettingsPage')), /const\s+modules\s*=\s*\[/u)
  assert.match(shellSource, /MobileBottomNavigation/u)
  assert.match(shellSource, /getVisibleAdminRoutes/u)
  assert.match(appSource, /rootClassName="purchase-management-page"/u)
  assert.match(appSource, /rootClassName="vehicle-management-page"/u)
  assert.match(appSource, /rootClassName="tool-management-page"/u)
  assert.match(appSource, /className="inventory-section"/u)
})
