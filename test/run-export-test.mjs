/**
 * wvmTool 書き出し品質自動テスト
 *
 * 使い方: node test/run-export-test.mjs
 * （Vite dev サーバーは自動起動）
 */

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const VIDEO_IN = path.join(__dirname, 'test_input.mp4');
const VIDEO_OUT = path.join(__dirname, 'test_output.mp4');
const DEV_URL = 'http://localhost:5173';

// ─── Dev サーバー起動 ──────────────────────────────────────────────────────────

async function startDevServer() {
  console.log('[setup] Vite dev サーバーを起動中...');
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Dev server timeout')), 30000);
    proc.stdout.on('data', (d) => {
      const s = d.toString();
      if (s.includes('localhost')) {
        clearTimeout(timeout);
        console.log('[setup] Dev サーバー起動完了');
        resolve();
      }
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('localhost')) { clearTimeout(timeout); resolve(); }
    });
    proc.on('error', reject);
  });

  return proc;
}

// ─── ffprobe 解析 ──────────────────────────────────────────────────────────────

function analyzeVideo(filePath, label) {
  console.log(`\n=== ${label} ffprobe ===`);
  try {
    const raw = execSync(
      `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`,
      { encoding: 'utf8' }
    );
    const info = JSON.parse(raw);
    for (const s of info.streams) {
      const dims = s.width ? `${s.width}x${s.height}` : '';
      const fps  = s.r_frame_rate && s.r_frame_rate !== '0/0' ? ` fps=${s.r_frame_rate}` : '';
      const br   = s.bit_rate ? ` bitrate=${Math.round(parseInt(s.bit_rate)/1000)}kbps` : '';
      console.log(`  ${s.codec_type}: ${s.codec_name} ${s.profile||''} ${dims}${fps}${br}`);
      if (s.nb_frames) console.log(`    frames=${s.nb_frames} duration=${s.duration}s`);
      if (s.pix_fmt)   console.log(`    pix_fmt=${s.pix_fmt}`);
    }
    const fmt = info.format;
    if (fmt?.bit_rate) console.log(`  container bitrate: ${Math.round(parseInt(fmt.bit_rate)/1000)}kbps`);
    if (fmt?.size)     console.log(`  file size: ${(parseInt(fmt.size)/1024/1024).toFixed(2)}MB`);
    return info;
  } catch (e) {
    console.log('  ffprobe 失敗:', e.message);
    return null;
  }
}

// ─── SSIM で画質比較 ──────────────────────────────────────────────────────────

function compareQuality(refPath, testPath) {
  console.log('\n=== 画質比較 (SSIM/PSNR) ===');
  try {
    // 最初の 30 フレームだけ比較（高速化）
    const out = execSync(
      `ffmpeg -y -i "${refPath}" -i "${testPath}" ` +
      `-frames:v 30 -filter_complex "[0:v][1:v]ssim=stats_file=-;[0:v][1:v]psnr" ` +
      `-f null - 2>&1`,
      { encoding: 'utf8', timeout: 60000 }
    );
    const ssimMatch = out.match(/SSIM Mean:([0-9.]+)/);
    const psnrMatch = out.match(/average:([0-9.]+)/);
    if (ssimMatch) console.log(`  SSIM: ${ssimMatch[1]} (1.0=完全一致)`);
    if (psnrMatch) console.log(`  PSNR: ${psnrMatch[1]} dB (>40dB=高品質, >30dB=良好)`);
    if (!ssimMatch && !psnrMatch) {
      // フォールバック: 基本的なビットレート比較のみ
      console.log('  SSIM/PSNR の抽出に失敗しました');
      const lines = out.split('\n').filter(l => l.includes('SSIM') || l.includes('PSNR'));
      lines.slice(0, 3).forEach(l => console.log(' ', l.trim()));
    }
  } catch (e) {
    console.log('  比較失敗:', e.message.substring(0, 200));
  }
}

// ─── メインテスト ─────────────────────────────────────────────────────────────

async function runTest() {
  let devServer = null;

  // 既に dev サーバーが起動しているか確認
  try {
    const res = await fetch(DEV_URL).catch(() => null);
    if (!res) devServer = await startDevServer();
    else console.log('[setup] 既存の Dev サーバーを使用');
  } catch {
    devServer = await startDevServer();
  }

  // Chromium 起動（WebGL2/WebCodecs が使えるよう設定）
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--enable-webgl2',
      '--use-gl=angle',
      '--enable-features=WebCodecs,VideoPlaybackQuality',
      '--ignore-gpu-blocklist',
      '--enable-accelerated-2d-canvas',
      '--disable-gpu-sandbox',
    ],
  });

  const consoleLogs = [];
  const workerLogs = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // コンソールログを全収集
    page.on('console', (msg) => {
      const text = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(text);
      // export-worker 関連ログはリアルタイムで表示
      if (msg.text().includes('export-worker') || msg.text().includes('encoder') || msg.text().includes('drain')) {
        workerLogs.push(text);
        console.log('  ' + text);
      }
    });
    page.on('pageerror', (err) => {
      const text = `[pageerror] ${err.message}`;
      consoleLogs.push(text);
      console.log('  ' + text);
    });

    console.log('\n[test] アプリを開く...');
    await page.goto(DEV_URL);
    await page.waitForLoadState('networkidle');

    // 動画ファイルをロード
    console.log('[test] テスト動画をロード...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(VIDEO_IN);
    await page.waitForTimeout(2000);

    // 動画が読み込まれたか確認
    const hasVideo = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 2;
    });
    console.log(`[test] 動画ロード: ${hasVideo ? 'OK' : 'NG（video 要素が準備できていない）'}`);

    // モザイクトラックを追加（「追加」ボタン）
    console.log('[test] モザイクトラックを追加...');
    const addBtn = page.locator('button', { hasText: '追加' });
    await addBtn.waitFor({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(500);

    // ビューポートキャンバス上でドラッグして矩形を描く
    console.log('[test] モザイク矩形を描画...');
    const viewportArea = page.locator('.viewport-area');
    const box = await viewportArea.boundingBox();
    if (box) {
      const sx = box.x + box.width  * 0.15;
      const sy = box.y + box.height * 0.15;
      const ex = box.x + box.width  * 0.55;
      const ey = box.y + box.height * 0.55;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + 10, sy + 10, { steps: 5 });
      await page.mouse.move(ex, ey, { steps: 20 });
      await page.mouse.up();
      console.log(`[test] ドラッグ: (${Math.round(sx)},${Math.round(sy)}) → (${Math.round(ex)},${Math.round(ey)})`);
    }
    await page.waitForTimeout(500);

    // 書き出しボタンが有効か確認
    const exportBtn = page.locator('button.export-btn');
    const isDisabled = await exportBtn.getAttribute('disabled');
    console.log(`[test] 書き出しボタン: ${isDisabled === null ? '有効' : '無効（tracks=0 or 動画なし）'}`);
    if (isDisabled !== null) {
      console.log('[test] WARNING: 書き出しボタンが無効。トラックが追加されていない可能性あり。');
      // トラック数を確認
      const trackCount = await page.evaluate(() => {
        const items = document.querySelectorAll('[class*="track-item"]');
        return items.length;
      });
      console.log(`[test] DOM 上のトラック数: ${trackCount}`);
    }

    // 書き出し開始
    console.log('\n[test] 書き出し開始...');
    if (fs.existsSync(VIDEO_OUT)) fs.unlinkSync(VIDEO_OUT);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 600000 }),
      exportBtn.click(),
    ]);

    console.log('[test] ダウンロード完了。ファイルを保存中...');
    await download.saveAs(VIDEO_OUT);

    // ── 結果分析 ─────────────────────────────────────────────────────────────

    console.log('\n====== 解析結果 ======');
    const stat = fs.statSync(VIDEO_OUT);
    console.log(`\n出力ファイルサイズ: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

    analyzeVideo(VIDEO_IN, '入力動画');
    analyzeVideo(VIDEO_OUT, '出力動画');
    compareQuality(VIDEO_IN, VIDEO_OUT);

    console.log('\n=== Worker ログ全件 ===');
    consoleLogs
      .filter(l => l.includes('export') || l.includes('encoder') || l.includes('drain') || l.includes('webgl') || l.includes('fps'))
      .forEach(l => console.log(' ', l));

    console.log('\n[test] ✓ テスト完了');

  } finally {
    await browser.close();
    if (devServer) {
      devServer.kill();
      console.log('[setup] Dev サーバーを停止');
    }
  }
}

runTest().catch((err) => {
  console.error('\n[test] ✗ テスト失敗:', err.message);
  process.exit(1);
});
