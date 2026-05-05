import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { SELECTORS } from '../transports/chatgpt-selectors.js';

export async function runAuthDoctor() {
  console.log('Auth doctor\n');
  
  // 1. System browser
  const isMac = process.platform === 'darwin';
  console.log(`system browser: ${isMac ? 'available (macOS)' : 'unknown'}`);
  
  // 2. Profiles
  const profileChromium = path.join(os.homedir(), '.conduit', 'browser-profiles', 'chatgpt');
  const profileChrome = path.join(os.homedir(), '.conduit', 'browser-profiles', 'chatgpt-chrome');
  
  console.log(`profile chromium: ${existsSync(profileChromium) ? 'exists' : 'missing'}`);
  console.log(`profile chrome: ${existsSync(profileChrome) ? 'exists' : 'missing'}`);
  
  // 3. Launch bundled Chromium
  let chromiumLaunches = false;
  let chromiumStatus = 'unknown';
  try {
    const browser = await chromium.launch({ headless: true });
    chromiumLaunches = true;
    await browser.close();
    console.log('playwright chromium: launches');
  } catch (err: any) {
    console.log(`playwright chromium: failed (${err.message})`);
  }
  
  // 4. Launch Chrome channel
  let chromeLaunches = false;
  try {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    chromeLaunches = true;
    await browser.close();
    console.log('playwright chrome: launches');
  } catch (err: any) {
    console.log('playwright chrome: missing or failed');
  }

  let chromiumState = 'unknown';
  let chromeState = 'unknown';
  
  // 5. Check Chromium Auth State
  chromiumState = await checkBrowserAuth('chromium', profileChromium, undefined);
  
  // 6. Check Chrome Auth State
  chromeState = await checkBrowserAuth('chrome', profileChrome, 'chrome');
  
  // Recommendation logic
  let recommendation = 'unknown';
  if (chromiumState.includes('composer detected') || chromeState.includes('composer detected')) {
    recommendation = 'conduit run --transport chatgpt';
  } else if (isMac) {
    recommendation = 'conduit login:system + conduit run --transport clipboard';
  } else {
    recommendation = 'conduit run --transport fake';
  }
  
  console.log(`\nrecommended next step: ${recommendation}`);
}

async function checkBrowserAuth(name: string, profilePath: string, channel: string | undefined): Promise<string> {
  try {
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: true, // headless to avoid popups during doctor
      channel,
      viewport: { width: 1280, height: 800 }
    });
    
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    let state = 'unknown';
    try {
      await page.waitForSelector(SELECTORS.composer, { timeout: 5000 });
      state = 'composer detected (ready)';
    } catch {
      const url = page.url();
      const text = await page.content();
      if (url.includes('/api/auth/error')) {
        state = 'blocked at /api/auth/error';
      } else if (text.includes('Verify you are human')) {
        state = 'blocked by human verification';
      } else {
        state = `unknown state at ${url}`;
      }
    }
    
    console.log(`chatgpt ${name}: ${state}`);
    await context.close();
    return state;
  } catch (err: any) {
    console.log(`chatgpt ${name}: error launching persistent context (${err.message})`);
    return `error (${err.message})`;
  }
}
