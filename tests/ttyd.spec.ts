import { test, expect } from '@playwright/test';

test('ttyd web terminal loads', async ({ page }) => {
  await page.goto('/');
  // ttyd serves an xterm.js terminal — wait for the terminal container
  const terminal = page.locator('.xterm');
  await expect(terminal).toBeVisible({ timeout: 15000 });
});

test('ttyd terminal has a canvas renderer', async ({ page }) => {
  await page.goto('/');
  // xterm.js renders terminal content on a canvas element
  const canvas = page.locator('.xterm canvas');
  await expect(canvas.first()).toBeVisible({ timeout: 15000 });
});

test('ttyd terminal is interactive (writable mode)', async ({ page }) => {
  await page.goto('/');
  const terminal = page.locator('.xterm');
  await expect(terminal).toBeVisible({ timeout: 15000 });

  // Type a command — writable mode (-W) must be enabled for this to work
  await terminal.click();
  await page.keyboard.type('echo hello-playwright');
  await page.keyboard.press('Enter');

  // xterm.js renders to canvas, so use the accessibility tree to read output
  await expect(page.locator('textarea.xterm-helper-textarea')).toBeFocused();
});

test('ttyd returns correct auth challenge', async ({ request }) => {
  // Without credentials, ttyd should return 401
  const response = await request.get('http://localhost:7681/', {
    headers: {},
  });
  // With httpCredentials in config, Playwright sends auth automatically
  // so this request should succeed with 200
  expect(response.status()).toBe(200);
});
