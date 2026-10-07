// Page retrieval: plain fetch for server-rendered pages, Playwright for the
// ones whose rate tables are filled in by client-side JavaScript.
//
// Both paths retry transient failures. A bank site that is briefly unreachable
// should not cost us a day's data, but a 404 or a changed page layout is a real
// problem and is surfaced immediately rather than retried.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const RETRIES = 2;
const BASE_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Worth retrying: network drops, timeouts, rate limiting and server errors. */
function isTransient(error) {
  if (error?.status !== undefined) return error.status === 429 || error.status >= 500;
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return true;
  // Undici wraps DNS/socket failures as a TypeError with a cause.
  return error instanceof TypeError || error?.cause !== undefined;
}

async function withRetry(attempt) {
  let lastError;
  for (let tryNumber = 0; tryNumber <= RETRIES; tryNumber += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || tryNumber === RETRIES) break;
      await sleep(BASE_DELAY_MS * 2 ** tryNumber);
    }
  }
  throw lastError;
}

/** GET a URL and return the response body as text. */
export async function fetchText(url, { timeoutMs = 30000 } = {}) {
  return withRetry(async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'et,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const error = new Error(`GET ${url} failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.text();
  });
}

/**
 * When SCRAPE_DEBUG_DIR is set (CI does this), keep a screenshot and the HTML
 * of every rendered page. A scraper that works locally but fails on a CI
 * runner is otherwise impossible to diagnose: the log only says the selector
 * never appeared, not what the page showed instead (consent wall, bot check,
 * geo redirect).
 */
async function saveDebugArtifacts(page, url) {
  const dir = process.env.SCRAPE_DEBUG_DIR;
  if (!dir) return;
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    const { hostname, pathname } = new URL(url);
    const name = `${hostname}${pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    await writeFile(`${dir}/${name}.html`, await page.content());
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  } catch {
    // Diagnostics must never turn a scrape result into a failure.
  }
}

/**
 * Load a URL in headless Chromium and return the rendered HTML.
 * `waitForSelector` lets a scraper block until its own table exists rather
 * than relying on a fixed sleep.
 */
export async function renderHtml(url, { waitForSelector, timeoutMs = 60000, settleMs = 1500 } = {}) {
  const { chromium } = await import('playwright');

  return withRetry(async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ locale: 'et-EE', userAgent: USER_AGENT });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        if (waitForSelector) {
          // 'attached' rather than 'visible': several of these tables live inside
          // collapsed accordions or inactive tabs but still hold the real numbers.
          await page.waitForSelector(waitForSelector, { state: 'attached', timeout: timeoutMs });
        } else {
          await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
        }
        await page.waitForTimeout(settleMs);
        return await page.content();
      } finally {
        await saveDebugArtifacts(page, url);
      }
    } finally {
      await browser.close();
    }
  });
}

/**
 * Try a plain fetch first and fall back to a rendered page if parsing fails.
 * Used by banks whose rendering mode was not known up front; the returned
 * `method` is what belongs in the scrapeMethod field of data/data.json.
 */
export async function fetchOrRender(url, parse, renderOptions = {}) {
  let fetchError;
  try {
    return { result: parse(await fetchText(url)), method: 'fetch' };
  } catch (error) {
    fetchError = error;
  }
  try {
    return { result: parse(await renderHtml(url, renderOptions)), method: 'playwright' };
  } catch (renderError) {
    throw new Error(
      `plain fetch did not yield a usable table (${fetchError.message}); ` +
      `Playwright fallback also failed (${renderError.message})`,
    );
  }
}
