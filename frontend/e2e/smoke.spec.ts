import { test as base, expect, type Page } from '@playwright/test'

// Every January view must load without a console error; the live preview and source check may hit the network.
const test = base.extend<{ consoleErrors: void }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error' && !/\/api\/v1\/(live|source)/.test(m.location().url)) errors.push(m.text())
      })
      page.on('pageerror', (e) => errors.push(e.message))
      await use()
      expect(errors).toEqual([])
    },
    { auto: true },
  ],
})

const hero = (page: Page) => page.locator('.hero')
const runUsed = (page: Page) =>
  hero(page).locator('.hero-facts > div', { hasText: 'Forecast run' }).locator('dd')

test('decision for 12 Jan: count on 12.5 GW, run 07:30', async ({ page }) => {
  await page.goto('/?day=2026-01-12')
  await expect(page.getByRole('heading', { name: 'Decision for Mon 12 Jan' })).toBeVisible()
  await expect(page.locator('#hero-title')).toHaveText(/Count on\s*12\.5\s*GW/)
  await expect(runUsed(page)).toContainText('07:30')
})

test('show what happened reveals the actual line', async ({ page }) => {
  await page.goto('/?day=2026-01-12')
  await expect(page.getByText('Actual (outturn)')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show what happened' }).click()
  await expect(page.getByText('Actual (outturn)').first()).toBeVisible()
  await expect(page).toHaveURL(/reveal=1/)
})

test('N2EX gate uses the 09:30 run', async ({ page }) => {
  await page.goto('/?day=2026-01-12')
  await expect(runUsed(page)).toContainText('07:30')
  await page.getByRole('group', { name: 'Gate closure' }).getByRole('button', { name: 'N2EX 09:50' }).click()
  await expect(runUsed(page)).toContainText('09:30')
})

test('1 in 20 risk switches to P95 and moves the number', async ({ page }) => {
  await page.goto('/?day=2026-01-12')
  await expect(page.locator('#hero-title')).toContainText('12.5')
  await page.getByRole('button', { name: /1 in 20 h/ }).click()
  await expect(hero(page).locator('.hero-sub')).toContainText('P95 wind')
  await expect(page.locator('#hero-title')).toHaveText(/Count on/)
  await expect(page.locator('#hero-title')).not.toContainText('12.5')
})

test('each tab renders its heading', async ({ page }) => {
  await page.goto('/?day=2026-01-12')
  const tabs: [RegExp, RegExp][] = [
    [/accuracy/i, /Forecast accuracy/],
    [/P90/, /Firm wind \(P90\)/],
    [/Timing/, /^Timing$/],
    [/Decision/, /Decision for Mon 12 Jan/],
  ]
  for (const [tab, heading] of tabs) {
    await page.getByRole('tab', { name: tab }).click()
    await expect(page.locator('.tabpanel h2').first()).toHaveText(heading)
  }
  // Live depends on Elexon: accept either a forecast or the unavailable state.
  await page.getByRole('tab', { name: /Tomorrow|Live/ }).click()
  await expect(page.locator('.tabpanel h2').first()).toContainText('Tomorrow')
  await expect(page.locator('#hero-title, .unavailable, .error-state').first()).toBeVisible({
    timeout: 30_000,
  })
})

test('28 Jan warns that the forecast feed froze', async ({ page }) => {
  await page.goto('/?day=2026-01-28')
  await expect(page.getByRole('alert').filter({ hasText: 'Forecast feed frozen' })).toBeVisible()
  await expect(hero(page).getByText('Status', { exact: true })).toBeVisible()
})

test('day picker opens, Escape closes it', async ({ page }) => {
  await page.goto('/?day=2026-01-12')
  const dp = page.locator('details.dp')
  await page.getByLabel(/Delivery day Mon 12 Jan/).click()
  await expect(dp).toHaveAttribute('open', '')
  await page.keyboard.press('Escape')
  await expect(dp).not.toHaveAttribute('open')
})

test('URL state survives a reload', async ({ page }) => {
  await page.goto('/?day=2026-01-12')
  await page.getByRole('button', { name: 'Next delivery day' }).click()
  await page.getByRole('tab', { name: /Timing/ }).click()
  await expect(page).toHaveURL(/tab=timing/)
  await expect(page).toHaveURL(/day=2026-01-13/)
  await page.reload()
  await expect(page.getByRole('tab', { name: /Timing/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel(/Delivery day Tue 13 Jan/)).toBeVisible()
})
