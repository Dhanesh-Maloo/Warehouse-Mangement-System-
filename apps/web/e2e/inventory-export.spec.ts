import { test, expect } from '@playwright/test';

// Happy path for US-INV-05 (CSV export of the inventory views) and the
// New/Used condition filter added alongside it. Uses the seeded
// client_user (viewer@esevel.com — see infra/prisma/seed.ts) so the test
// also incidentally covers that a client-scoped user can reach and export
// their own inventory.
test.describe('Inventory export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill('viewer@esevel.com');
    await page.getByLabel('Password').fill('Viewer@12345');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
  });

  test('filters the asset register by New/Used condition and downloads a CSV export', async ({
    page,
  }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    // New/Used condition filter
    await page.locator('select:has-text("All conditions (New/Used)")').selectOption('new');
    await expect(page.locator('table')).toBeVisible();

    // Export CSV — always the full dataset in scope, not just the filtered page
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('asset-register-export.csv');
  });

  test('exports the ageing view as CSV', async ({ page }) => {
    await page.goto('/inventory/ageing');
    await expect(page.getByRole('heading', { name: 'Stock Ageing' })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('inventory-ageing-export.csv');
  });
});
