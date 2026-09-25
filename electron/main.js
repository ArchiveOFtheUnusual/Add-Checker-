// Desktop app: runs the dashboard in its own window. The server is internal (random
// private port, this computer only); the user never sees a browser or address.
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) app.quit();

let win;

async function createWindow() {
  process.env.UPLOAD_PREP_HOME = path.join(app.getPath('documents'), 'Upload Prep');
  let port;
  try {
    port = await require('../src/server').start(0);
  } catch (e) {
    dialog.showErrorBox('Upload Prep could not start', e.message);
    return app.quit();
  }
  const origin = `http://127.0.0.1:${port}`;

  win = new BrowserWindow({
    width: 1300,
    height: 900,
    minWidth: 420,
    title: 'Upload Prep',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Source links on the platform tabs open in the normal browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL(origin);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
