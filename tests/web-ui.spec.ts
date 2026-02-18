import { test, expect } from '@playwright/test';

test('login page loads', async ({ page }) => {
  await page.goto('/');
  // Should show password input
  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('authenticates with correct password', async ({ page }) => {
  await page.goto('/');
  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 10000 });

  await passwordInput.fill(process.env.API_PASSWORD || 'changeme');
  await page.locator('button[type="submit"]').click();

  // After login, should see the session list (or empty state)
  await expect(
    page.locator('.session-list-container, .empty-state').first()
  ).toBeVisible({ timeout: 10000 });
});

test('rejects incorrect password', async ({ page }) => {
  await page.goto('/');
  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 10000 });

  await passwordInput.fill('wrong-password');
  await page.locator('button[type="submit"]').click();

  // Should show error and stay on login page
  await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
  await expect(passwordInput).toBeVisible();
});
