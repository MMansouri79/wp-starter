import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGuiServer } from "../gui/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let gui = null;

function isLocalUrl(value, origin) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

async function createMainWindow() {
  gui = await startGuiServer({ port: 0, openBrowser: false, log: false });
  const localOrigin = new URL(gui.url).origin;
  const icon = path.join(here, "assets", "icon.svg");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    title: "WP Starter Builder",
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isLocalUrl(url, localOrigin)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(gui.url);
}

async function stopGuiServer() {
  if (!gui?.server?.listening) return;
  await new Promise((resolve) => gui.server.close(() => resolve()));
  gui = null;
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(createMainWindow).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    void stopGuiServer();
  });
}
