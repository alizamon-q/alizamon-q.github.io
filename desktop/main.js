// Davomat — Windows (exe) ilovasi. Internetdagi Davomat sahifasini alohida oynada ochadi.
const { app, BrowserWindow, shell, Menu } = require("electron");
const APP_URL = require("./package.json").appUrl;

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 600,
    title: "Davomat", backgroundColor: "#f4f6fa", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.loadURL(APP_URL);
  // Tashqi havolalar (Google Maps va h.k.) oddiy brauzerda ochiladi
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(APP_URL)) { e.preventDefault(); shell.openExternal(url); }
  });
  // Internet yo'q bo'lsa — qayta urinish sahifasi
  win.webContents.on("did-fail-load", (_e, code) => {
    if (code === -3) return;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
      `<body style="font-family:Segoe UI,Arial;display:grid;place-items:center;height:100vh;margin:0;background:#f4f6fa">
       <div style="text-align:center"><h2>Internet aloqasi yo‘q</h2><p>Ulanishni tekshirib, qayta urinib ko‘ring.</p>
       <button onclick="location.href='${APP_URL}'" style="padding:10px 18px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;cursor:pointer">Qayta urinish</button></div></body>`));
  });
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(["clipboard-sanitized-write", "notifications"].includes(perm)));
}
app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
