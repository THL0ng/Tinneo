import { test, chromium, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// ─── 1. CẤU HÌNH (CONFIG) ─────────────────────────────────────
const PROD_URL    = 'https://welcome:M0sk1t!@tinneo.care';
const PREPROD_URL = 'https://acouzen.officience.com';
const REPORT_DIR  = path.resolve('D:/Tineo/FINAL_AUDIT_REPORT');
const MAX_DEPTH   = 2;
const AUTH_FILE   = path.resolve(__dirname, 'prod_auth.json');

async function loginBasicAuth(browser: any) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(PROD_URL, { waitUntil: 'networkidle' });
    await context.storageState({ path: AUTH_FILE });
    console.log("✅ Đăng nhập thành công qua URL Auth.");
  } catch (err: any) {
    console.error("❌ Vẫn không login được:", err.message);
  } finally {
    await context.close();
  }
}

// ─── 2. HÀM CRAWL LẤY TẤT CẢ CÁC TRANG ────────────────────────
async function crawlAllRoutes(baseUrl: string, maxDepth: number): Promise<string[]> {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: '/', depth: 0 }];
  const routes: string[] = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { url: route, depth } = item;

    if (visited.has(route) || depth > maxDepth) continue;
    visited.add(route);
    routes.push(route);

    try {
      console.log(`🔍 Crawling: ${baseUrl}${route}`);
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(2000);

      if (depth < maxDepth) {
        const foundLinks = await page.evaluate(() => {
          const domain = window.location.hostname.replace('www.', '');
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.getAttribute('href') || '')
            .filter(h => h.startsWith('/') || h.includes(domain))
            .map(h => {
              try { return new URL(h, window.location.origin).pathname; }
              catch { return ''; }
            })
            .filter(p => p.length > 1 && !p.includes('#') && !p.match(/\.(pdf|jpg|png|svg|webp|zip)$/i));
        });
        for (const link of foundLinks) {
          if (!visited.has(link)) queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch { /* Skip error pages */ }
  }
  await browser.close();
  return routes.length > 0 ? [...new Set(routes)] : ['/'];
}

// ─── 3. HÀM SO SÁNH CÓ KẺ KHUNG HIGHLIGHT (BOUNDING BOX) ──────
// ─── 3. HÀM SO SÁNH THEO TỪNG VÙNG ──────────────────────────
function compareVisualWithHighlight(prodPath: string, preprodPath: string, diffPath: string, route: string) {
  if (!fs.existsSync(prodPath) || !fs.existsSync(preprodPath)) return null;

  const img1 = PNG.sync.read(fs.readFileSync(prodPath));
  const img2 = PNG.sync.read(fs.readFileSync(preprodPath));
  const width  = Math.max(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);

  const img1Resized = new PNG({ width, height, fill: true });
  const img2Resized = new PNG({ width, height, fill: true });
  const diffTemp    = new PNG({ width, height, fill: true });

  PNG.bitblt(img1, img1Resized, 0, 0, img1.width, height, 0, 0);
  PNG.bitblt(img2, img2Resized, 0, 0, img2.width, height, 0, 0);

  const diffPixels = pixelmatch(img1Resized.data, img2Resized.data, diffTemp.data, width, height, { threshold: 0.1 });

  // ─── Định nghĩa 5 vùng theo tỉ lệ % ───────────────────────
  const HEADER_H  = Math.floor(height * 0.10);
  const FOOTER_Y  = Math.floor(height * 0.75);
  const SIDEBAR_W = Math.floor(width  * 0.15);

  const zones = [
    { name: 'HEADER', x1: 0,                y1: 0,        x2: width,             y2: HEADER_H },
    { name: 'FOOTER', x1: 0,                y1: FOOTER_Y, x2: width,             y2: height   },
    { name: 'LEFT',   x1: 0,                y1: HEADER_H, x2: SIDEBAR_W,         y2: FOOTER_Y },
    { name: 'RIGHT',  x1: width - SIDEBAR_W,y1: HEADER_H, x2: width,             y2: FOOTER_Y },
    { name: 'BODY',   x1: SIDEBAR_W,        y1: HEADER_H, x2: width - SIDEBAR_W, y2: FOOTER_Y },
  ];

  const diffFinal = new PNG({ width, height });
  PNG.bitblt(img1Resized, diffFinal, 0, 0, width, height, 0, 0);

  const borderSize = 3;
  const padding    = 5;
  const color      = { r: 255, g: 0, b: 0, a: 255 };

  for (const zone of zones) {
    let minX = zone.x2, minY = zone.y2, maxX = zone.x1, maxY = zone.y1;
    let foundDiff = false;

    for (let y = zone.y1; y < zone.y2; y++) {
      for (let x = zone.x1; x < zone.x2; x++) {
        const idx = (width * y + x) << 2;
        if (diffTemp.data[idx] === 255 && diffTemp.data[idx + 1] === 0 && diffTemp.data[idx + 2] === 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          foundDiff = true;
        }
      }
    }

    if (foundDiff) {
      console.log(`>>> [DIFF] ${route} | Zone: ${zone.name} | minX=${minX} minY=${minY} maxX=${maxX} maxY=${maxY}`);
      for (let y = Math.max(zone.y1, minY - padding); y <= Math.min(zone.y2 - 1, maxY + padding); y++) {
        for (let x = Math.max(zone.x1, minX - padding); x <= Math.min(zone.x2 - 1, maxX + padding); x++) {
          if (x <= minX - padding + borderSize || x >= maxX + padding - borderSize ||
              y <= minY - padding + borderSize || y >= maxY + padding - borderSize) {
            const idx = (width * y + x) << 2;
            diffFinal.data[idx]     = color.r;
            diffFinal.data[idx + 1] = color.g;
            diffFinal.data[idx + 2] = color.b;
            diffFinal.data[idx + 3] = color.a;
          }
        }
      }
    } else {
      console.log(`>>> [OK]   ${route} | Zone: ${zone.name} | no diff`);
    }
  }

  fs.writeFileSync(diffPath, PNG.sync.write(diffFinal));
  const matchPercent = (100 - (diffPixels / (width * height)) * 100).toFixed(2);
  console.log(`> [TOTAL] ${route}: Match ${matchPercent}%`);
  return matchPercent;
}

// ─── 4. HÀM ẨN COOKIE BANNER ─────────────────────────────────
async function hideCookieBanner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const selectors = [
      '[class*="cookie"]', '[class*="Cookie"]',
      '[id*="cookie"]',    '[id*="Cookie"]',
      '[class*="consent"]','[class*="Consent"]',
      '[class*="gdpr"]',   '[class*="GDPR"]',
      '[class*="banner"]', '[class*="Banner"]',
      '[class*="popup"]',  '[class*="Popup"]',
      '[class*="overlay"]','[class*="Overlay"]',
      '[class*="modal"]',  '[class*="Modal"]',
      '[id*="consent"]',   '[id*="gdpr"]',
      '[id*="banner"]',    '[id*="popup"]',
      '[id*="overlay"]',   '[id*="modal"]',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        (el as HTMLElement).style.setProperty('display', 'none', 'important');
      });
    }
    document.body.style.setProperty('overflow', 'auto', 'important');
    document.documentElement.style.setProperty('overflow', 'auto', 'important');
  });
  await page.waitForTimeout(500);
}

// ─── 5. HÀM CUỘN TRANG ───────────────────────────────────────
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) { clearInterval(timer); resolve(); }
      }, 150);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
}

// ─── 6. TEST SUITE ────────────────────────────────────────────
test.describe('Full Site Audit with Bounding Box', () => {
  let pagesToTest: string[] = [];

  test.beforeAll(async () => {
    test.setTimeout(600000);

    if (fs.existsSync(REPORT_DIR)) {
      fs.readdirSync(REPORT_DIR).forEach(f => {
        try { fs.unlinkSync(path.join(REPORT_DIR, f)); } catch {}
      });
    } else {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }

    console.log("🚀 Quét link trên PROD & PREPROD...");
    const [prodRoutes, preprodRoutes] = await Promise.all([
      crawlAllRoutes(PROD_URL, MAX_DEPTH),
      crawlAllRoutes(PREPROD_URL, MAX_DEPTH)
    ]);

    pagesToTest = [...new Set([...prodRoutes, ...preprodRoutes])];
    console.log(`✅ Tổng cộng tìm thấy ${pagesToTest.length} trang.`);
  });

  test('So sánh Visual PROD vs PREPROD', async ({ browser }) => {
    test.setTimeout(1200000);

    for (const route of pagesToTest) {
      const key  = route.replace(/[^a-z0-9]/gi, '_') || 'home';
      const pProd = path.join(REPORT_DIR, `PROD_${key}.png`);
      const pPre  = path.join(REPORT_DIR, `PRE_${key}.png`);
      const pDiff = path.join(REPORT_DIR, `DIFF_${key}.png`);

      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      try {
        console.log(`📸 Processing: ${route}`);

        // Chụp PROD
        const resProd = await page.goto(`${PROD_URL}${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
        if (resProd?.status() === 200) {
          await hideCookieBanner(page);
          await autoScroll(page);
          await page.screenshot({ path: pProd, fullPage: true });
        }

        // Chụp PREPROD
        const resPre = await page.goto(`${PREPROD_URL}${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
        if (resPre?.status() === 200) {
          await hideCookieBanner(page);
          await autoScroll(page);
          await page.screenshot({ path: pPre, fullPage: true });
        }

        // So sánh với Khung Đỏ Highlight
        if (fs.existsSync(pProd) && fs.existsSync(pPre)) {
          compareVisualWithHighlight(pProd, pPre, pDiff, route);
        }

      } catch (err: any) {
        console.error(`❌ Lỗi tại ${route}: ${err.message}`);
      } finally {
        await context.close().catch(() => {});
      }
    }
    console.log(`\n🎉 HOÀN TẤT. Báo cáo tại: ${REPORT_DIR}`);
  });
});