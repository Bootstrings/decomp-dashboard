// main.js - Main process for the Electron application

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path =require('path');
const fs = require('fs');
const { exec, execSync } = require('child_process');
const Store = require('electron-store');

const store = new Store();

// --- Window Creation ---

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'src/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src/index.html'));
  // win.webContents.openDevTools(); // Uncomment for debugging
};

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });


// --- Internal Helper Functions ---

/**
 * Finds the full path of an executable using the 'where' command.
 * @param {string} command - The executable name (e.g., 'git').
 * @returns {string | null} The full path or null if not found.
 */
function findExecutable(command) {
    try {
        const result = execSync(`where ${command}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        // Return the first path found, which is usually the one in the system PATH.
        return result.split(/\r?\n/)[0].trim();
    } catch (error) {
        return null; // Command not found
    }
}

/**
 * Resolves the paths for all required tools, prioritizing stored settings over auto-detection.
 * @param {Electron.IpcMainInvokeEvent} event
 * @returns {Promise<{git: string|null, python: string|null, ninja: string|null}>}
 */
async function resolveToolchainPaths(event) {
    event.sender.send('log:message', 'Resolving toolchain paths...');
    const customPaths = store.get('toolchainPaths', {});

    const resolved = {
        git: customPaths.git || findExecutable('git'),
        python: customPaths.python || findExecutable('py'),
        ninja: customPaths.ninja || findExecutable('ninja'),
    };
    
    if (resolved.git) event.sender.send('log:message', `Found Git: ${resolved.git}`);
    else event.sender.send('log:error', `Git not found. Please set it in Settings.`);

    if (resolved.python) event.sender.send('log:message', `Found Python: ${resolved.python}`);
    else event.sender.send('log:error', `Python not found. Please set it in Settings.`);

    // We don't log an error for Ninja yet, as we might install it.
    if (resolved.ninja) event.sender.send('log:message', `Found Ninja: ${resolved.ninja}`);

    return resolved;
}

/**
 * Builds a session-specific environment object with the tool paths prepended to the PATH.
 * @param {object} resolvedPaths - Object containing paths for git, python, ninja.
 * @returns {object} An environment object for child_process.
 */
function buildEnvFromPaths(resolvedPaths) {
    const pathSet = new Set(process.env.PATH.split(path.delimiter));
    const addToPath = (toolPath) => {
        if (toolPath && fs.existsSync(toolPath)) {
            pathSet.add(path.dirname(toolPath));
        }
    };
    
    addToPath(resolvedPaths.git);
    addToPath(resolvedPaths.python);
    addToPath(resolvedPaths.ninja);

    return { ...process.env, PATH: [...pathSet].join(path.delimiter) };
}

/**
 * Helper to execute a command and stream its output to the renderer.
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {string} command
 * @param {object} options
 * @returns {Promise<{code: number, error?: string}>}
 */
function executeAndLog(event, command, options) {
    return new Promise((resolve) => {
        event.sender.send('log:message', `Executing: ${command}`);
        const execOptions = { ...options, shell: 'powershell.exe' };

        const child = exec(command, execOptions);
        child.stdout.on('data', (data) => event.sender.send('log:message', data.toString().trim()));
        child.stderr.on('data', (data) => event.sender.send('log:message', data.toString().trim()));
        child.on('close', (code) => {
            if (code === 0) {
                event.sender.send('log:message', `Command finished successfully.`);
            } else {
                event.sender.send('log:error', `Command failed with exit code: ${code}`);
            }
            resolve({ code });
        });
        child.on('error', (err) => {
            event.sender.send('log:error', `Command execution error: ${err.message}`);
            resolve({ code: 1, error: err.message });
        });
    });
}


// --- IPC Handlers for Backend Operations ---

ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return canceled ? null : filePaths[0];
});

ipcMain.handle('dialog:openFile', async (event, options = {}) => {
    const defaultOptions = {
        properties: ['openFile'],
        filters: [{ name: 'All Files', extensions: ['*'] }]
    };
    const { canceled, filePaths } = await dialog.showOpenDialog({ ...defaultOptions, ...options });
    return canceled ? null : filePaths[0];
});

ipcMain.on('shell:openExternal', (event, url) => shell.openExternal(url));

ipcMain.handle('project:run-setup', async (event, { projectPath, dolPath }) => {
    const resolvedPaths = await resolveToolchainPaths(event);

    if (!resolvedPaths.git || !resolvedPaths.python) {
        const errorMsg = "Git or Python could not be found. Please configure their paths in Settings and try again.";
        event.sender.send('log:error', errorMsg);
        return { success: false, error: errorMsg };
    }
    
    let sessionEnv = buildEnvFromPaths(resolvedPaths);
    
    if (!resolvedPaths.ninja) {
        event.sender.send('log:message', 'Ninja not found. Attempting to install via pip...');
        const installResult = await executeAndLog(event, 'py -m pip install ninja', { env: sessionEnv });
        
        if (installResult.code !== 0) {
            const errorMsg = 'Failed to install Ninja via pip.';
            event.sender.send('log:error', errorMsg);
            return { success: false, error: errorMsg };
        }
        
        // After install, find its path and update our records
        resolvedPaths.ninja = findExecutable('ninja');
        if (!resolvedPaths.ninja) {
             const errorMsg = 'Failed to find Ninja after installation.';
             event.sender.send('log:error', errorMsg);
             return { success: false, error: errorMsg };
        }
        event.sender.send('log:message', `Found newly installed Ninja: ${resolvedPaths.ninja}`);
        sessionEnv = buildEnvFromPaths(resolvedPaths); // Rebuild env with new Ninja path
    }
    event.sender.send('log:message', 'All tools are available.');

    const meleePath = path.join(projectPath, 'melee');
    
    if (!fs.existsSync(meleePath)) {
        const cloneResult = await executeAndLog(event, `git clone https://github.com/doldecomp/melee.git "${meleePath}"`, { cwd: projectPath, env: sessionEnv });
        if (cloneResult.code !== 0) return { success: false, error: "Failed to clone 'melee' repository." };
    } else {
        event.sender.send('log:message', `'melee' directory already exists. Skipping clone.`);
    }

    const origDolDir = path.join(meleePath, 'orig', 'GALE01', 'sys');
    await executeAndLog(event, `New-Item -ItemType Directory -Force -Path "${origDolDir}"`, { env: sessionEnv });
    await executeAndLog(event, `Copy-Item "${dolPath}" -Destination "${path.join(origDolDir, 'main.dol')}"`, { env: sessionEnv });
    
    const configureResult = await executeAndLog(event, 'py configure.py', { cwd: meleePath, env: sessionEnv });
    if (configureResult.code !== 0) return { success: false, error: 'Failed to run configure.py' };

    const ninjaResult = await executeAndLog(event, 'ninja', { cwd: meleePath, env: sessionEnv });
    if (ninjaResult.code !== 0) return { success: false, error: 'Initial ninja build failed' };

    // Persist the final successful configuration
    store.set('toolchainPaths', resolvedPaths);
    event.sender.send('log:message', 'Project setup successful! Toolchain paths have been saved.');
    return { success: true, env: sessionEnv };
});

ipcMain.handle('exec:command', (event, { command, cwd, env = {} }) => {
    return executeAndLog(event, command, { cwd, env: { ...process.env, ...env }});
});

// --- Settings Handlers ---
ipcMain.handle('settings:get', async (event) => {
    return await resolveToolchainPaths(event);
});

ipcMain.handle('settings:set', async (event, settings) => {
    store.set('toolchainPaths', settings);
    return { success: true };
});
// --- Project Path Handlers ---
ipcMain.handle('paths:get', async () => {
    return store.get('userPaths', {});
});

ipcMain.handle('paths:set', async (event, paths) => {
    const currentPaths = store.get('userPaths', {});
    const newPaths = { ...currentPaths, ...paths };
    store.set('userPaths', newPaths);
    return { success: true };
});

// --- Filesystem Handlers ---
ipcMain.handle('fs:exists', async (event, pathToCheck) => fs.existsSync(pathToCheck));
ipcMain.handle('files:getAsmFiles', async (event, { projectPath, hideCompleted }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const asmDir = path.join(meleePath, 'build', 'GALE01', 'asm', 'melee');
        if (!fs.existsSync(asmDir)) return { error: `Assembly directory not found. Path: ${asmDir}` };
        
        const allAsmFiles = [];
        function findAllAsmFiles(currentPath) {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    findAllAsmFiles(fullPath);
                } else if (entry.name.endsWith('.s')) {
                    allAsmFiles.push(path.relative(asmDir, fullPath).replace(/\\/g, '/'));
                }
            }
        }
        findAllAsmFiles(asmDir);

        const filesWithCounts = [];
        for (const relativePath of allAsmFiles) {
            const asmPath = path.join(asmDir, relativePath);
            const cPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c'));
            const hPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.h'));

            const asmContent = fs.readFileSync(asmPath, 'utf-8');
            const cContent = fs.existsSync(cPath) ? fs.readFileSync(cPath, 'utf-8') : '';
            const hContent = fs.existsSync(hPath) ? fs.readFileSync(hPath, 'utf-8') : '';

            const allFuncsInFile = [...asmContent.matchAll(/^\.fn\s+([a-zA-Z0-9_]+),/gm)].map(m => m[1]);
            
            let vacantCount = 0;
            let claimedCount = 0;
            for (const funcName of allFuncsInFile) {
                if (!cContent.includes(funcName) && !hContent.includes(funcName)) {
                    vacantCount++;
                } else {
                    claimedCount++;
                }
            }

            if (!hideCompleted || vacantCount > 0) {
                filesWithCounts.push({
                    path: relativePath,
                    vacant: vacantCount,
                    claimed: claimedCount
                });
            }
        }
        
        filesWithCounts.sort((a, b) => b.vacant - a.vacant);
        
        return { files: filesWithCounts };
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('files:analyze', async (event, { projectPath, relativePath }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const asmPath = path.join(meleePath, 'build', 'GALE01', 'asm', 'melee', relativePath);
        const cPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c'));
        const hPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.h'));

        if (!fs.existsSync(asmPath)) return { error: `Assembly file not found at: ${asmPath}` };
        
        const asmContent = fs.readFileSync(asmPath, 'utf-8');
        const cContent = fs.existsSync(cPath) ? fs.readFileSync(cPath, 'utf-8') : '';
        const hContent = fs.existsSync(hPath) ? fs.readFileSync(hPath, 'utf-8').toString() : '';

        const lines = asmContent.split(/\r?\n/);
        const functionsWithSize = [];
        let currentFunction = null;
        let lineCount = 0;

        for (const line of lines) {
            const fnMatch = line.match(/^\.fn\s+([a-zA-Z0-9_]+),/);
            if (fnMatch) {
                if (currentFunction) functionsWithSize.push({ name: currentFunction, size: lineCount });
                currentFunction = fnMatch[1];
                lineCount = 1;
            } else if (currentFunction) {
                lineCount++;
                if (line.match(/^\.endfn/)) {
                    functionsWithSize.push({ name: currentFunction, size: lineCount });
                    currentFunction = null;
                    lineCount = 0;
                }
            }
        }
        
        const vacant = functionsWithSize
            .filter(func => !cContent.includes(func.name) && !hContent.includes(func.name))
            .sort((a, b) => a.size - b.size);
        
        const claimed = functionsWithSize
            .filter(func => cContent.includes(func.name) || hContent.includes(func.name))
            .map(func => func.name);
        
        const includesRegex = /#include\s*(<[^>]+>|"[^"]+")/g;
        const includes = [...cContent.matchAll(includesRegex)].map(m => m[0]).join('\n');

        return { vacant, claimed, includes };
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('files:getFunctionAsm', async (event, { projectPath, relativePath, functionName }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const asmPath = path.join(meleePath, 'build', 'GALE01', 'asm', 'melee', relativePath);

        if (!fs.existsSync(asmPath)) return { error: `Assembly file not found at: ${asmPath}` };
        
        const asmContent = fs.readFileSync(asmPath, 'utf-8');
        const lines = asmContent.split(/\r?\n/);
        let inFunction = false;
        const functionLines = [];

        for (const line of lines) {
            if (line.match(new RegExp(`^\\.fn\\s+${functionName},`))) inFunction = true;
            if (inFunction) {
                if (!line.match(/^\.fn/) && !line.match(/^\.endfn/)) {
                    const instructionOnly = line.replace(/\/\*.*\*\/\s*/, '').trim();
                    if (instructionOnly) functionLines.push(instructionOnly);
                }
                if (line.match(/^\.endfn/)) break;
            }
        }

        if (functionLines.length === 0) return { error: `Could not find function ${functionName} in ${relativePath}` };
        return { asm: functionLines.join('\n') };
    } catch (error) {
        return { error: error.message };
    }
});

function replaceFunctionInContent(content, functionName, newCode) {
    const funcStartRegex = new RegExp(`(?:void|int|char|float|double|struct\\s+\\w+\\s*\\*?)\\s+${functionName}\\s*\\([^)]*\\)`);
    const match = content.match(funcStartRegex);

    if (!match) {
        return content.trim() + `\n\n${newCode}\n`;
    }

    const startIndex = match.index;
    let openBraces = 0;
    let endIndex = -1;

    const startBraceIndex = content.indexOf('{', startIndex);
    if (startBraceIndex === -1) {
        return content.trim() + `\n\n${newCode}\n`;
    }

    for (let i = startBraceIndex; i < content.length; i++) {
        if (content[i] === '{') openBraces++;
        else if (content[i] === '}') openBraces--;
        
        if (openBraces === 0) {
            endIndex = i;
            break;
        }
    }

    if (endIndex === -1) {
        return content.trim() + `\n\n${newCode}\n`;
    }

    const before = content.substring(0, startIndex);
    const after = content.substring(endIndex + 1);
    
    return before + newCode + after;
}

ipcMain.handle('files:revertChanges', async (event, { projectPath, relativePath }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const cPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c'));
        const hPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.h'));

        const options = { cwd: meleePath, shell: 'powershell.exe' };

        if (fs.existsSync(cPath)) {
            await executeAndLog(event, `git restore "${cPath}"`, options);
        }
        if (fs.existsSync(hPath)) {
            await executeAndLog(event, `git restore "${hPath}"`, options);
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('files:injectCode', async(event, { projectPath, relativePath, code }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const cPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c'));
        const hPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.h'));

        const signatureMatch = code.match(/(.*{)/);
        if (!signatureMatch) return { success: false, error: 'Could not parse function signature from your code.' };
        
        const newSignature = signatureMatch[1].replace('{', ';').trim();
        const nameMatch = newSignature.match(/\b(\w+)\s*\(/);
        if (!nameMatch) return { success: false, error: 'Could not parse function name from your code.' };
        
        const functionName = nameMatch[1];

        if (fs.existsSync(cPath)) {
            let cContent = fs.readFileSync(cPath, 'utf-8');
            let updatedCContent = replaceFunctionInContent(cContent, functionName, code);
            fs.writeFileSync(cPath, updatedCContent);
            event.sender.send('log:message', `Updated function ${functionName} in ${path.basename(cPath)}.`);
        } else {
            fs.writeFileSync(cPath, code + '\n');
            event.sender.send('log:message', `Created ${path.basename(cPath)} with function ${functionName}.`);
        }

        if (!fs.existsSync(hPath)) {
            fs.writeFileSync(hPath, newSignature + '\n');
            event.sender.send('log:message', `Created ${path.basename(hPath)} with signature for ${functionName}.`);
        } else {
            let hContent = fs.readFileSync(hPath, 'utf-8');
            // UPDATED REGEX: Anchors to start of line (^), searches for the function name, and uses multiline flag (m).
            const oldSignatureRegex = new RegExp(`^.*\\b${functionName}\\b\\s*\\([^)]*\\);`, 'gm');
            
            if (oldSignatureRegex.test(hContent)) {
                hContent = hContent.replace(oldSignatureRegex, newSignature);
                event.sender.send('log:message', `Updated signature for ${functionName} in ${path.basename(hPath)}.`);
            } else {
                hContent = hContent.trim() + `\n${newSignature}\n`;
                event.sender.send('log:message', `Appended signature for ${functionName} to ${path.basename(hPath)}.`);
            }
            fs.writeFileSync(hPath, hContent);
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});