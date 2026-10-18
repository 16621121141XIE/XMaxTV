// XMaxTV Desktop Shell
// Starts the XMaxTV Next.js server (bundled node.exe) and shows it in a native window.
// Shows a friendly "starting service" page while the server boots, then
// auto-navigates to the player page. Closing the window stops the server.
// Robust restart: single-instance lock + stale-port cleanup + crash auto-restart.

const { app, BrowserWindow, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 8080;
const BASE = 'http://localhost:' + PORT;
const IS_MAC = process.platform === 'darwin';
// Windows：exe 平铺目录即应用目录；macOS：应用资源目录（Contents/Resources）
const APP_DIR = IS_MAC ? path.join(__dirname, '..') : path.dirname(app.getPath('exe'));
// macOS 的 node 无扩展名；Windows 用 node.exe
const NODE_BIN = IS_MAC ? path.join(APP_DIR, 'node') : path.join(APP_DIR, 'node.exe');
// macOS 应用图标用 png，Windows 用 ico
const APP_ICON = IS_MAC ? path.join(APP_DIR, 'icon.png') : path.join(APP_DIR, 'favicon.ico');

let serverProc = null;
let win = null;
let pollTimer = null;
let stopping = false;

// ---- single instance: a second launch focuses the running app ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function loadingPage() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
  body{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a,#1e293b 60%,#334155);color:#e2e8f0}
  .card{text-align:center;padding:48px 56px;border-radius:24px;background:rgba(255,255,255,.06);box-shadow:0 20px 60px rgba(0,0,0,.45);backdrop-filter:blur(6px)}
  .logo{font-size:56px;margin-bottom:8px}
  h1{font-size:26px;font-weight:600;margin:0 0 6px;letter-spacing:1px}
  .spinner{width:44px;height:44px;margin:26px auto;border:5px solid rgba(148,163,184,.25);border-top-color:#38bdf8;border-radius:50%;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .dots{color:#94a3b8;font-size:14px}
  .hint{color:#64748b;font-size:12.5px;margin-top:14px}
</style></head><body>
  <div class="card">
    <div class="logo">📺</div>
    <h1>XMaxTV</h1>
    <div class="spinner"></div>
    <div class="dots">正在启动服务，请稍候…</div>
    <div class="hint">服务就绪后将自动打开播放器<br>首次启动通常需要几秒钟</div>
  </div>
</body></html>`);
}

function errorPage(reason) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
  body{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a,#1e293b 60%,#334155);color:#e2e8f0}
  .card{text-align:center;padding:48px 56px;border-radius:24px;background:rgba(255,255,255,.06);box-shadow:0 20px 60px rgba(0,0,0,.45);max-width:460px}
  .icon{font-size:52px;margin-bottom:8px}
  h1{font-size:24px;font-weight:600;margin:0 0 12px}
  p{color:#94a3b8;font-size:14px;line-height:1.8;margin:0 0 20px}
  ul{text-align:left;color:#94a3b8;font-size:13px;line-height:2;margin:0 0 24px;padding-left:20px}
  a.retry{display:inline-block;padding:11px 34px;border-radius:999px;background:#38bdf8;color:#0f172a;font-size:14px;font-weight:600;text-decoration:none}
  a.retry:hover{background:#7dd3fc}
</style></head><body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>服务启动失败</h1>
    <p>${reason || '播放器服务未能正常启动，请检查以下可能的原因：'}</p>
    <ul>
      <li>8080 端口被其他程序占用</li>
      <li>安装目录被移动或文件不完整</li>
      <li>运行环境异常</li>
    </ul>
    <a class="retry" href="XMaxTV://retry">重新尝试启动</a>
    <p style="margin-top:16px;color:#475569;font-size:12px">也可以关闭窗口后重新打开应用</p>
  </div>
</body></html>`);
}

function portPids() {
  try {
    if (IS_MAC) {
      // macOS: lsof 列出占用端口 8080 的 PID
      const out = execSync('lsof -ti :' + PORT, { encoding: 'utf8', timeout: 5000 });
      return out.split(/\s+/).map(s => s.trim()).filter(Boolean);
    }
    const out = execSync('netstat -ano | findstr :' + PORT + ' | findstr LISTENING', { encoding: 'utf8', timeout: 5000 });
    return [...new Set(out.split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(Boolean))];
  } catch (e) {
    return [];
  }
}

function serverHealthy() {
  return new Promise(resolve => {
    const req = http.get(BASE + '/api/status', { timeout: 2500 }, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
  });
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      if (IS_MAC) {
        execSync('kill -9 ' + pid, { stdio: 'ignore', timeout: 8000 });
      } else {
        execSync('taskkill /pid ' + pid + ' /T /F', { stdio: 'ignore', timeout: 8000 });
      }
    } catch (e) {}
  }
}

function killPortOwner() {
  killPids(portPids());
}

function stopServer() {
  stopping = true;
  if (serverProc && serverProc.pid) {
    killPids([String(serverProc.pid)]);
    try { serverProc.kill(); } catch (e) {}
    serverProc = null;
  } else {
    killPortOwner();
  }
}

function startServer(callback) {
  const nextBin = path.join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextBin) || !fs.existsSync(NODE_BIN)) {
    console.error('[XMaxTV] runtime missing: next=' + fs.existsSync(nextBin) + ' node=' + fs.existsSync(NODE_BIN));
    if (callback) callback(false);
    return;
  }

  // macOS zip 解压可能丢失可执行位，启动前确保 node 可执行
  if (IS_MAC) {
    try { fs.chmodSync(NODE_BIN, 0o755); } catch (e) {}
  }

  const tryStart = () => {
    serverProc = spawn(NODE_BIN, [nextBin, 'start', '-p', String(PORT)], {
      cwd: APP_DIR,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProc.stdout.on('data', d => { process.stdout.write('[server] ' + d); });
    serverProc.stderr.on('data', d => { process.stderr.write('[server] ' + d); });
    serverProc.on('exit', code => {
      console.log('[XMaxTV] server exited with code ' + code);
      serverProc = null;
      if (!stopping && win && !win.isDestroyed()) {
        console.log('[XMaxTV] server died unexpectedly, restarting in 2s...');
        setTimeout(() => startServer(() => waitForServer(win)), 2000);
      }
    });
    if (callback) callback(true);
  };

  (async () => {
    if (portPids().length > 0) {
      if (await serverHealthy()) {
        console.log('[XMaxTV] existing healthy server found, reusing');
        if (callback) callback(true);
        return;
      }
      console.log('[XMaxTV] stale port owner detected, cleaning...');
      killPortOwner();
      await new Promise(r => setTimeout(r, 1500));
    }
    tryStart();
  })();
}

function waitForServer(winRef) {
  clearInterval(pollTimer);
  let tries = 0;
  pollTimer = setInterval(async () => {
    tries++;
    if (await serverHealthy()) {
      clearInterval(pollTimer);
      if (winRef && !winRef.isDestroyed()) {
        winRef.loadURL(BASE);
      }
      return;
    }
    if (tries >= 40) {
      clearInterval(pollTimer);
      if (winRef && !winRef.isDestroyed()) {
        winRef.loadURL(errorPage('播放器服务长时间未就绪。'));
      }
    }
  }, 1500);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    autoHideMenuBar: true,
    title: 'XMaxTV',
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE)) {
      win.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (url === 'XMaxTV://retry') {
      e.preventDefault();
      win.loadURL(loadingPage());
      stopping = false;
      startServer(() => waitForServer(win));
    }
  });

  win.loadURL(loadingPage());
}

app.whenReady().then(() => {
  stopping = false;
  startServer(() => {
    if (win && !win.isDestroyed()) waitForServer(win);
  });
  createWindow();
  waitForServer(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      stopping = false;
      startServer(() => waitForServer(win));
    }
  });
});

app.on('window-all-closed', () => {
  clearInterval(pollTimer);
  stopServer();
  app.quit();
});

app.on('before-quit', () => {
  clearInterval(pollTimer);
  stopServer();
});
