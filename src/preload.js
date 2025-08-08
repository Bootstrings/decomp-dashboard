// src/preload.js - Securely exposes backend functions to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Navigation ---
  navigate: (page) => ipcRenderer.send('navigate', page),

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
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('log:message', handler);
    return () => ipcRenderer.removeListener('log:message', handler);
  },
  onLogError: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('log:error', handler);
    return () => ipcRenderer.removeListener('log:error', handler);
  },
  
  // --- External Links ---
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),

  // --- Decompilation & Analysis ---
  structs: {
    load: (projectPath) => ipcRenderer.invoke('structs:load', projectPath),
    lookup: (offset) => ipcRenderer.invoke('structs:lookup', offset),
  },
  getAsmFiles: (args) => ipcRenderer.invoke('files:getAsmFiles', args),
  analyzeFiles: (args) => ipcRenderer.invoke('files:analyze', args),
  getFunctionCode: (args) => ipcRenderer.invoke('files:getFunctionCode', args),
  getFunctionAsm: (args) => ipcRenderer.invoke('files:getFunctionAsm', args),
  injectCode: (args) => ipcRenderer.invoke('files:injectCode', args),
  revertChanges: (args) => ipcRenderer.invoke('files:revertChanges', args),

  // --- AI Copilot ---
  ai: {
    getSuggestion: (args) => ipcRenderer.invoke('ai:getRefactoringSuggestion', args),
  },

  // --- Refactor & Verify ---
  refactor: {
    verify: (args) => ipcRenderer.invoke('refactor:verify', args),
  },

  // --- Verification ---
  objdiff: {
    runReport: () => ipcRenderer.invoke('objdiff:run-report'),
  },

  // --- Cleanup ---
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});