import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// 1. Sửa chính tả 'tineo' và XÓA dấu / ở cuối URL để tránh lỗi //
const PAGES = ['/', '/blog/', '/lequipe/', '/contact/', '/politique-de-confidentialite', '/mon-profil/', '/comprendre-les-acouphenes/', '/notre-approche-medicale/', '/le-parcours/'];
const PROD_URL = 'https://tinneo.care/'; 
const PREPROD_URL = 'https://acouzen.officience.com/';
const REPORT_DIR = 'D:\\Tineo\\FINAL_AUDIT_REPORT';

// Bắt buộc chạy tuần tự để tránh xung đột file ảnh khi dùng 1 worker
test.describe.configure({ mode: 'serial' });

test.describe('Audit Tineo: Real Rectangle Highlight', () => {

  test.beforeAll(() => {
    if (fs.existsSync(REPORT_DIR)) {
      fs.readdirSync(REPORT_DIR).forEach(f => fs.unlinkSync(path.join(REPORT_DIR, f)));
    } else {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
  });

  for (const route of PAGES) {
    test(`Kiểm định: ${route}`, async ({ page }) => {
      const fileName = route.replace(/\//g, '-') || 'home';
      const prodPath = path.join(REPORT_DIR, `PROD${fileName}.png`);
      const preprodPath = path.join(REPORT_DIR, `PREPROD${fileName}.png`);
      const diffPath = path.join(REPORT_DIR, `DIFF${fileName}.png`);

      // 2. Thêm kiểm tra status code để bắt lỗi 404 hoặc ERR_NAME_NOT_RESOLVED
      try {
        const prodRes = await page.goto(`${PROD_URL}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
        expect(prodRes?.status(), `❌ PROD ${route} bị lỗi ${prodRes?.status()}`).toBe(200);
        await page.screenshot({ path: prodPath, fullPage: true });

        const preRes = await page.goto(`${PREPROD_URL}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
        expect(preRes?.status(), `❌ PREPROD ${route} bị lỗi ${preRes?.status()}`).toBe(200);
        await page.screenshot({ path: preprodPath, fullPage: true });
      } catch (error) {
        console.error(`Lỗi kết nối tại ${route}: ${error.message}`);
        throw error; // Làm fail test nếu không tìm thấy domain hoặc timeout
      }

      const img1 = PNG.sync.read(fs.readFileSync(prodPath));
      const img2 = PNG.sync.read(fs.readFileSync(preprodPath));
      const width = Math.max(img1.width, img2.width);
      const height = Math.max(img1.height, img2.height);

      const img1Resized = new PNG({ width, height, fill: true });
      const img2Resized = new PNG({ width, height, fill: true });
      const diffTemp = new PNG({ width, height });
      PNG.bitblt(img1, img1Resized, 0, 0, img1.width, img1.height, 0, 0);
      PNG.bitblt(img2, img2Resized, 0, 0, img2.width, img2.height, 0, 0);

      const diffPixels = pixelmatch(img1Resized.data, img2Resized.data, diffTemp.data, width, height, { threshold: 0.1 });

      let minX = width, minY = height, maxX = 0, maxY = 0;
      let foundDiff = false;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (width * y + x) << 2;
          if (diffTemp.data[idx] === 255 && diffTemp.data[idx + 1] === 0) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            foundDiff = true;
          }
        }
      }

      const diffFinal = new PNG({ width, height });
      PNG.bitblt(img1Resized, diffFinal, 0, 0, width, height, 0, 0);

      if (foundDiff) {
        const borderSize = 3; // Tăng độ dày viền cho dễ nhìn giống hình mẫu
        const color = { r: 255, g: 0, b: 0, a: 255 };

        for (let y = Math.max(0, minY - 5); y <= Math.min(height - 1, maxY + 5); y++) {
          for (let x = Math.max(0, minX - 5); x <= Math.min(width - 1, maxX + 5); x++) {
            if (x <= minX - 5 + borderSize || x >= maxX + 5 - borderSize || y <= minY - 5 + borderSize || y >= maxY + 5 - borderSize) {
              const idx = (width * y + x) << 2;
              diffFinal.data[idx] = color.r;
              diffFinal.data[idx + 1] = color.g;
              diffFinal.data[idx + 2] = color.b;
              diffFinal.data[idx + 3] = color.a;
            }
          }
        }
      }

      fs.writeFileSync(diffPath, PNG.sync.write(diffFinal));
      console.log(`> [OK] ${route}: Match ${(100 - (diffPixels / (width * height)) * 100).toFixed(2)}%`);
    });
  }
});