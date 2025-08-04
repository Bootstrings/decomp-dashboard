// src/preload.js - Securely exposes backend functions to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Dialogs ---
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  selectFile: (options) => ipcRenderer.invoke('dialog:openFile', options),

  // --- Settings ---
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

  // --- Project Paths ---
  getPaths: () => ipcRenderer.invoke('paths:get'),
  setPaths: (paths) => ipcRenderer.invoke('paths:set', paths),

  // --- Project Setup & Commands ---
  runProjectSetup: (args) => ipcRenderer.invoke('project:run-setup', args),
  execCommand: (command, cwd, env) => ipcRenderer.invoke('exec:command', { command, cwd, env }),

  // --- Logging from Main Process ---
  onLogMessage: (callback) => {
    ipcRenderer.on('log:message', (_event, value) => callback(value));
  },
  onLogError: (callback) => {
    ipcRenderer.on('log:error', (_event, value) => callback(value));
  },
  
  // --- External Links ---
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),

  // --- File System Operations ---
  fsExists: (pathToCheck) => ipcRenderer.invoke('fs:exists', pathToCheck),
  getAsmFiles: (args) => ipcRenderer.invoke('files:getAsmFiles', args),
  analyzeFiles: (args) => ipcRenderer.invoke('files:analyze', args),
  getFunctionAsm: (args) => ipcRenderer.invoke('files:getFunctionAsm', args),
  injectCode: (args) => ipcRenderer.invoke('files:injectCode', args),
  revertChanges: (args) => ipcRenderer.invoke('files:revertChanges', args), // <-- ADDED THIS LINE

  // --- Cleanup ---
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});