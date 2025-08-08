// main.js - Main process for the Electron application

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Store = require('electron-store');
const { handleProjectSetup, resolveToolchainPaths, buildEnvFromPaths } = require('./src/setup-handler.js');

const store = new Store();
let mainWindow; // Keep a reference to the main window

// --- Struct Parser Cache and Logic ---
let structsCache = {}; // In-memory cache for parsed struct data

function parseCHeadersForStructs(includeDir) {
    const typeSizes = {
        'u8': 1, 's8': 1, 'char': 1, 'bool': 1,
        'u16': 2, 's16': 2, 'short': 2,
        'u32': 4, 's32': 4, 'int': 4, 'float': 4, 'f32': 4,
        'u64': 8, 's64': 8, 'double': 8, 'f64': 8,
    };
    const parsedStructs = {};
    const getAlignment = (type) => type.includes('*') ? 4 : typeSizes[type.replace(/const\s+/, '').trim()] || 4;
    const getSize = (type) => type.includes('*') ? 4 : typeSizes[type.replace(/const\s+/, '').trim()] || 4;

    function findFiles(dir, allFiles = []) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) findFiles(fullPath, allFiles);
            else if (entry.name.endsWith('.h')) allFiles.push(fullPath);
        });
        return allFiles;
    }

    for (const file of findFiles(includeDir)) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split(/\r?\n/);
        let inStruct = false, currentStructName = '', currentOffset = 0, structMembers = [];

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) continue;
            const structMatch = trimmedLine.match(/^(?:typedef\s+)?struct\s+(\w+)\s*{/);
            if (structMatch) {
                inStruct = true;
                currentStructName = structMatch[1];
                currentOffset = 0;
                structMembers = [];
                continue;
            }
            if (inStruct) {
                if (trimmedLine.startsWith('}')) {
                    const structEndMatch = trimmedLine.match(/}\s*(\w+);/);
                    if (structEndMatch) currentStructName = structEndMatch[1];
                    if (currentStructName) parsedStructs[currentStructName] = structMembers;
                    inStruct = false;
                    continue;
                }
                const memberMatch = trimmedLine.match(/^(.+?)\s+([\w\d*]+)(?:\[(\d+)\])?;/);
                if (memberMatch) {
                    const type = memberMatch[1].trim(), name = memberMatch[2].trim();
                    const arraySize = memberMatch[3] ? parseInt(memberMatch[3], 10) : 1;
                    const memberSize = getSize(type), memberAlignment = getAlignment(type);
                    if (currentOffset % memberAlignment !== 0) currentOffset += memberAlignment - (currentOffset % memberAlignment);
                    structMembers.push({ name, type, offset: currentOffset, size: memberSize * arraySize });
                    currentOffset += memberSize * arraySize;
                }
            }
        }
    }
    return parsedStructs;
}

// --- Internal Helper Functions ---

function executeAndLog(event, command, options) {
    return new Promise((resolve) => {
        event.sender.send('log:message', `Executing: ${command}`);
        const execOptions = { ...options, shell: 'powershell.exe' };
        const child = exec(command, execOptions);
        let stdout = '';
        child.stdout.on('data', (data) => {
            const msg = data.toString().trim();
            event.sender.send('log:message', msg);
            stdout += msg;
        });
        child.stderr.on('data', (data) => event.sender.send('log:message', data.toString().trim()));
        child.on('close', (code) => {
            if (code === 0) event.sender.send('log:message', `Command finished successfully.`);
            else event.sender.send('log:error', `Command failed with exit code: ${code}`);
            resolve({ code, stdout });
        });
        child.on('error', (err) => {
            event.sender.send('log:error', `Command execution error: ${err.message}`);
            resolve({ code: 1, error: err.message });
        });
    });
}

// --- Window Creation & Navigation ---

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'src/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'src/index.html'));
    // mainWindow.webContents.openDevTools();
};

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('navigate', (event, page) => {
    if (mainWindow) {
        const pagePath = path.join(__dirname, `src/${page}.html`);
        mainWindow.loadFile(pagePath);
    }
});

// --- IPC Handlers ---

ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return canceled ? null : filePaths[0];
});

ipcMain.handle('dialog:openFile', async (event, options = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], ...options });
    return canceled ? null : filePaths[0];
});

ipcMain.on('shell:openExternal', (event, url) => shell.openExternal(url));

// Delegate complex setup to the handler module
ipcMain.handle('project:run-setup', (event, args) => handleProjectSetup(event, args, store, executeAndLog));

ipcMain.handle('exec:command', (event, { command, cwd, env = {} }) => {
    return executeAndLog(event, command, { cwd, env: { ...process.env, ...env } });
});

ipcMain.handle('settings:get', (event) => resolveToolchainPaths(event, store));
ipcMain.handle('settings:set', (event, settings) => {
    store.set('toolchainPaths', settings);
    return { success: true };
});

ipcMain.handle('paths:get', () => store.get('userPaths', {}));
ipcMain.handle('paths:set', (event, paths) => {
    store.set('userPaths', { ...store.get('userPaths', {}), ...paths });
    return { success: true };
});

// Replace the existing structs:load handler with this one.

ipcMain.handle('structs:load', (event, projectPath) => {
    try {
        // **THE FIX**: The headers are in 'src', not 'include'.
        const srcDir = path.join(projectPath, 'melee', 'src');
        if (!fs.existsSync(srcDir)) return { error: 'Source directory not found.' };
        
        structsCache = parseCHeadersForStructs(srcDir); // Assuming parseCHeadersForStructs reads recursively
        
        return { success: true, count: Object.keys(structsCache).length };
    } catch (error) {
        return { error: error.message };
    }
});
ipcMain.handle('structs:lookup', (event, offset) => {
    const results = [];
    for (const structName in structsCache) {
        for (const member of structsCache[structName]) {
            if (member.offset === offset) results.push({ structName, member });
        }
    }
    return results;
});

ipcMain.handle('objdiff:run-report', async (event) => {
    try {
        const projectPath = store.get('userPaths.projectPath');
        if (!projectPath) return { error: "Project path not set." };
        
        const resolvedPaths = await resolveToolchainPaths(event, store);
        if (!resolvedPaths.objdiff) return { error: "objdiff-cli.exe not found. Please set its path in Settings, or place it in your project folder." };
        
        const sessionEnv = buildEnvFromPaths(resolvedPaths);
        const command = `"${resolvedPaths.objdiff}" report --format json`;
        const result = await executeAndLog(event, command, { cwd: path.join(projectPath, 'melee'), env: sessionEnv });

        if (result.code !== 0) return { error: "objdiff-cli command failed." };
        return { report: JSON.parse(result.stdout) };
    } catch (error) {
        return { error: `Failed to run or parse report: ${error.message}` };
    }
});
// --- AI Copilot Handler ---

// Replace the existing getGeminiSuggestion function with this one.

async function getGeminiSuggestion(event, projectPath, targetAssembly, currentCCode) {
    event.sender.send('log:message', 'Starting AI refactoring suggestion...');
    
    function deIndent(str) {
        const lines = str.split('\n');
        if (lines.length > 0 && lines[0].trim() === '') lines.shift();
        if (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
        const minIndent = lines.filter(line => line.trim()).reduce((min, line) => Math.min(min, line.match(/^\s*/)[0].length), Infinity);
        return lines.map(line => line.substring(minIndent)).join('\n');
    }

    const toolsDir = path.join(projectPath, 'tools');
    const contextScriptPath = path.join(toolsDir, 'm2ctx.py');

    try {
        const pythonScriptContent = deIndent(`
            import os
            import re
            import sys

            def get_c_context(melee_dir):
                try:
                    # **THE FIX**: The headers are in 'src', not 'include'.
                    target_dir = os.path.join(melee_dir, 'src')

                    if not os.path.isdir(target_dir):
                        print(f"Error: Source directory not found at {target_dir}", file=sys.stderr)
                        sys.exit(1)

                    all_structs = []
                    struct_regex = re.compile(r'(typedef\\s+struct\\s+[\\w_]+\\s*{(?:.|\\n)*?}\\s*[\\w_]+;)', re.MULTILINE)

                    for root, _, files in os.walk(target_dir):
                        for file in files:
                            if file.endswith('.h'):
                                try:
                                    with open(os.path.join(root, file), 'r', encoding='utf-8', errors='ignore') as f:
                                        content = f.read()
                                        matches = struct_regex.findall(content)
                                        all_structs.extend(matches)
                                except Exception:
                                    pass
                    
                    key_structs = [s for s in all_structs if any(name in s for name in ['HSD_GObj', 'HSD_JObj', 'Fighter', 'Player', 'Item'])]
                    
                    if not key_structs:
                        print("No key structs (HSD_GObj, Fighter, etc.) were found in the project's headers.", file=sys.stdout)
                        return
                        
                    print("Key C Struct Definitions for Super Mario Melee:\\n")
                    for struct_def in key_structs:
                        print(struct_def)
                        print("-" * 20)

                except Exception as e:
                    print(f"An error occurred in m2ctx.py: {e}", file=sys.stderr)
                    sys.exit(1)

            if __name__ == "__main__":
                if len(sys.argv) < 2:
                    print("Error: Missing path to melee directory argument.", file=sys.stderr)
                    sys.exit(1)
                
                melee_path_arg = sys.argv[1]
                get_c_context(melee_path_arg)
        `);
        if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir);
        fs.writeFileSync(contextScriptPath, pythonScriptContent);
    } catch (e) {
        return { error: `Failed to create/update context script: ${e.message}` };
    }

    event.sender.send('log:message', 'Getting project context via m2ctx.py...');
    const resolvedPaths = await resolveToolchainPaths(event, store);
    if (!resolvedPaths.python) return { error: "Python executable not found." };
    
    const meleePath = path.join(projectPath, 'melee');
    const contextResult = await executeAndLog(event, `& "${resolvedPaths.python}" "${contextScriptPath}" "${meleePath}"`, { cwd: projectPath });
    
    if (contextResult.code !== 0) {
        return { error: `Failed to execute m2ctx.py script. Check the output log for details.` };
    }
    const projectContext = contextResult.stdout;
    event.sender.send('log:message', 'Successfully retrieved project context.');

    const prompt = `...`; // Remainder of function is unchanged

    require('dotenv').config({ path: path.join(app.getAppPath(), '.env') });
    const { GCLOUD_PROJECT_ID, GCLOUD_LOCATION, GCLOUD_MODEL_ID } = process.env;

    if (!GCLOUD_PROJECT_ID || !GCLOUD_LOCATION || !GCLOUD_MODEL_ID) {
        return { error: "Google Cloud environment variables (GCLOUD_PROJECT_ID, GCLOUD_LOCATION, GCLOUD_MODEL_ID) are not set in the .env file." };
    }

    const tempPromptPath = path.join(app.getPath('temp'), `gemini-prompt-${Date.now()}.json`);
    const requestPayload = { contents: [{ parts: [{ text: prompt }] }], generation_config: { "response_mime_type": "application/json" } };
    fs.writeFileSync(tempPromptPath, JSON.stringify(requestPayload));

    const gcloudCommand = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
    const command = `${gcloudCommand} ai platform models predict ${GCLOUD_MODEL_ID} --project=${GCLOUD_PROJECT_ID} --region=${GCLOUD_LOCATION} --json-request="${tempPromptPath}"`;
    
    event.sender.send('log:message', 'Sending request to Google Cloud AI...');
    const result = await executeAndLog(event, command, { cwd: projectPath });
    fs.unlinkSync(tempPromptPath);

    if (result.code !== 0) {
        return { error: 'gcloud command failed. Ensure it is installed, authenticated, and the correct project ID is set in .env.' };
    }
    
    try {
        const responseJson = JSON.parse(result.stdout);
        const predictionContent = responseJson.predictions[0];
        const suggestionText = (predictionContent.content || predictionContent.parts[0].text);
        const suggestion = JSON.parse(suggestionText);
        
        if (!suggestion.reasoning || !suggestion.code) {
             return { error: 'AI response was malformed. Missing "reasoning" or "code" key.' };
        }
        
        event.sender.send('log:message', 'Successfully received and parsed AI suggestion.');
        return { success: true, suggestion };
    } catch (e) {
        event.sender.send('log:error', `Failed to parse AI response: ${e.message}`);
        event.sender.send('log:message', `Raw AI Response: ${result.stdout}`);
        return { error: 'Failed to parse the JSON response from the AI model.' };
    }
}
ipcMain.handle('ai:getRefactoringSuggestion', async (event, { targetAssembly, currentCCode }) => {
    try {
        const projectPath = store.get('userPaths.projectPath');
        if (!projectPath) {
            return { error: "Project path is not set. Please configure it on the main page." };
        }
        return await getGeminiSuggestion(event, projectPath, targetAssembly, currentCCode);
    } catch (error) {
        return { error: `An unexpected error occurred: ${error.message}` };
    }
});
// --- Filesystem Handlers ---
const readFileSafe = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
ipcMain.handle('files:getAsmFiles', async (event, { projectPath, hideCompleted }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const asmDir = path.join(meleePath, 'build', 'GALE01', 'asm', 'melee');
        if (!fs.existsSync(asmDir)) return { error: `Assembly directory not found at ${asmDir}` };
        
        const allAsmFiles = [];
        function findAllAsmFiles(currentPath) {
            fs.readdirSync(currentPath, { withFileTypes: true }).forEach(entry => {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) findAllAsmFiles(fullPath);
                else if (entry.name.endsWith('.s')) allAsmFiles.push(path.relative(asmDir, fullPath).replace(/\\/g, '/'));
            });
        }
        findAllAsmFiles(asmDir);
        const filesWithCounts = allAsmFiles.map(relativePath => {
            const asmContent = readFileSafe(path.join(asmDir, relativePath));
            const cContent = readFileSafe(path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c')));
            const allFuncsInFile = [...asmContent.matchAll(/^\.fn\s+([a-zA-Z0-9_]+),/gm)].map(m => m[1]);
            const vacantCount = allFuncsInFile.filter(funcName => !cContent.includes(funcName)).length;
            return { path: relativePath, vacant: vacantCount, claimed: allFuncsInFile.length - vacantCount };
        }).filter(file => !hideCompleted || file.vacant > 0);
        
        filesWithCounts.sort((a, b) => b.vacant - a.vacant);
        return { files: filesWithCounts };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle('files:analyze', async (event, { projectPath, relativePath }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const cPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c'));
        const asmContent = readFileSafe(path.join(meleePath, 'build', 'GALE01', 'asm', 'melee', relativePath));
        const cContent = readFileSafe(cPath);
        
        const lines = asmContent.split(/\r?\n/);
        const functionsWithSize = [];
        let currentFunction = null, lineCount = 0;
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
                }
            }
        }
        
        const vacant = functionsWithSize.filter(f => !cContent.includes(f.name)).sort((a,b) => a.size - b.size);
        const claimed = functionsWithSize.filter(f => cContent.includes(f.name)).map(f => f.name);
        const includes = [...cContent.matchAll(/#include\s*(<[^>]+>|"[^"]+")/g)].map(m => m[0]).join('\n');
        return { vacant, claimed, includes };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle('files:getFunctionAsm', async (event, { projectPath, relativePath, functionName }) => {
    try {
        const asmContent = readFileSafe(path.join(projectPath, 'melee', 'build', 'GALE01', 'asm', 'melee', relativePath));
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
        if (functionLines.length === 0) return { error: `Could not find function ${functionName}` };
        return { asm: functionLines.join('\n') };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle('files:getFunctionCode', async (event, { projectPath, relativePath, functionName }) => {
    try {
        const cPath = path.join(projectPath, 'melee', 'src', 'melee', relativePath.replace('.s', '.c'));
        if (!fs.existsSync(cPath)) {
            // If C file doesn't exist, return a default stub.
            return { code: `void ${functionName}(void)\n{\n    // TODO\n}\n` };
        }
        
        const content = fs.readFileSync(cPath, 'utf-8');
        
        // This regex finds a function signature, including its return type and arguments.
        const funcStartRegex = new RegExp(`(?:\\w+\\s*\\*?\\s+)+${functionName}\\s*\\([^)]*\\)\\s*{`);
        const match = content.match(funcStartRegex);

        if (!match) {
            // If the function isn't in the file, return a default stub.
            return { code: `void ${functionName}(void)\n{\n    // TODO\n}\n` };
        }

        const startIndex = match.index;
        const startBraceIndex = content.indexOf('{', startIndex);
        let openBraces = 0;
        let endIndex = -1;

        for (let i = startBraceIndex; i < content.length; i++) {
            if (content[i] === '{') {
                openBraces++;
            } else if (content[i] === '}') {
                openBraces--;
            }
            if (openBraces === 0) {
                endIndex = i;
                break;
            }
        }

        if (endIndex === -1) {
            return { error: `Could not find matching closing brace for function ${functionName}.` };
        }

        return { code: content.substring(startIndex, endIndex + 1) };

    } catch (error) {
        return { error: error.message };
    }
});
function replaceFunctionInContent(content, functionName, newCode) {
    const funcStartRegex = new RegExp(`(?:void|int|char|float|double|struct\\s+\\w+\\s*\\*?)\\s+${functionName}\\s*\\([^)]*\\)`);
    const match = content.match(funcStartRegex);
    if (!match) return content.trim() + `\n\n${newCode}\n`;
    const startIndex = match.index;
    let openBraces = 0, endIndex = -1;
    const startBraceIndex = content.indexOf('{', startIndex);
    if (startBraceIndex === -1) return content.trim() + `\n\n${newCode}\n`;
    for (let i = startBraceIndex; i < content.length; i++) {
        if (content[i] === '{') openBraces++; else if (content[i] === '}') openBraces--;
        if (openBraces === 0) { endIndex = i; break; }
    }
    if (endIndex === -1) return content.trim() + `\n\n${newCode}\n`;
    return content.substring(0, startIndex) + newCode + content.substring(endIndex + 1);
}
ipcMain.handle('files:revertChanges', async (event, { projectPath, relativePath }) => {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const cPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c'));
        const hPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.h'));
        const options = { cwd: meleePath, shell: 'powershell.exe' };
        if (fs.existsSync(cPath)) await executeAndLog(event, `git restore "${cPath}"`, options);
        if (fs.existsSync(hPath)) await executeAndLog(event, `git restore "${hPath}"`, options);
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});
async function injectCodeAndSignature(event, { projectPath, relativePath, code }) {
    try {
        const meleePath = path.join(projectPath, 'melee');
        const cPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.c'));
        const hPath = path.join(meleePath, 'src', 'melee', relativePath.replace('.s', '.h'));
        
        // Find function signature and name from the provided code
        const signatureMatch = code.match(/(.*{)/);
        if (!signatureMatch) return { success: false, error: 'Could not parse function signature.' };
        const newSignature = signatureMatch[1].replace('{', ';').trim();
        const nameMatch = newSignature.match(/\b(\w+)\s*\(/);
        if (!nameMatch) return { success: false, error: 'Could not parse function name.' };
        const functionName = nameMatch[1];

        // Inject the full function code into the C file
        let cContent = readFileSafe(cPath);
        fs.writeFileSync(cPath, replaceFunctionInContent(cContent, functionName, code));
        event.sender.send('log:message', `Updated/Wrote function ${functionName} in ${path.basename(cPath)}.`);

        // Inject the new signature into the header file
        if (fs.existsSync(hPath)) {
            let hContent = readFileSafe(hPath);
            const oldSignatureRegex = new RegExp(`^.*\\b${functionName}\\b\\s*\\([^)]*\\);`, 'gm');
            if (oldSignatureRegex.test(hContent)) {
                hContent = hContent.replace(oldSignatureRegex, newSignature);
            } else if (!hContent.includes(newSignature)) {
                hContent = hContent.trim() + `\n${newSignature}\n`;
            }
            fs.writeFileSync(hPath, hContent);
            event.sender.send('log:message', `Updated/Wrote signature for ${functionName} in ${path.basename(hPath)}.`);
        }
        
        return { success: true };
    } catch (error) { 
        return { success: false, error: error.message };
    }
}

ipcMain.handle('files:injectCode', async(event, args) => {
    return await injectCodeAndSignature(event, args);
});
