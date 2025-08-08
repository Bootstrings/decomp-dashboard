const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

// --- Helper Functions (No Changes) ---

async function downloadFile(event, url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const request = https.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                event.sender.send('log:message', `Redirected to ${response.headers.location}`);
                downloadFile(event, response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Download failed: Server responded with status code ${response.statusCode}`));
                return;
            }
            const totalBytes = parseInt(response.headers['content-length'], 10);
            let downloadedBytes = 0;
            let lastReportedProgress = -1;
            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes) {
                    const progress = Math.floor((downloadedBytes / totalBytes) * 100);
                    if (progress > lastReportedProgress) {
                        event.sender.send('log:message', `Downloading objdiff-cli... ${progress}%`);
                        lastReportedProgress = progress;
                    }
                }
            });
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        });
        request.on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

function findExecutable(command) {
    try {
        // Use 'where' on Windows, 'which' on other platforms
        const whereCmd = process.platform === 'win32' ? 'where' : 'which';
        const result = execSync(`${whereCmd} ${command}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return result.split(/\r?\n/)[0].trim();
    } catch (error) {
        return null;
    }
}

async function resolveToolchainPaths(event, store) {
    event.sender.send('log:message', 'Resolving toolchain paths...');
    const customPaths = store.get('toolchainPaths', {});
    const userPaths = store.get('userPaths', {});

    let objdiffInProjectFolder = null;
    if (userPaths.projectPath) {
        const potentialPath = path.join(userPaths.projectPath, 'objdiff-cli.exe');
        if (fs.existsSync(potentialPath)) {
            objdiffInProjectFolder = potentialPath;
        }
    }

    const resolved = {
        git: customPaths.git || findExecutable('git'),
        python: customPaths.python || findExecutable('py') || findExecutable('python'),
        ninja: customPaths.ninja || findExecutable('ninja'),
        objdiff: customPaths.objdiff || objdiffInProjectFolder || findExecutable('objdiff-cli.exe'),
    };
    
    return resolved;
}

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
    addToPath(resolvedPaths.objdiff);
    return { ...process.env, PATH: [...pathSet].join(path.delimiter) };
}

// --- Resilient Toolchain Verification and Healing ---
async function verifyAndHealToolchain(event, store, executeAndLog) {
    event.sender.send('log:message', '--- Verifying Toolchain ---');
    let resolvedPaths = await resolveToolchainPaths(event, store);

    // 1. Check for critical tools: git and python
    if (!resolvedPaths.git) return { success: false, error: 'Git not found. Please install it or set its path in Settings.' };
    if (!resolvedPaths.python) return { success: false, error: 'Python not found. Please install it or set its path in Settings.' };
    event.sender.send('log:message', `[OK] Found Git: ${resolvedPaths.git}`);
    event.sender.send('log:message', `[OK] Found Python: ${resolvedPaths.python}`);

    // 2. Check for Ninja, and install it if missing
    if (!resolvedPaths.ninja) {
        event.sender.send('log:message', `[WARN] Ninja not found. Attempting to install with pip...`);
        // **FIXED**: Added '&' call operator for PowerShell
        const installResult = await executeAndLog(event, `& "${resolvedPaths.python}" -m pip install ninja`, {});
        if (installResult.code !== 0) {
            return { success: false, error: 'Failed to install Ninja via pip. Please check your Python installation.' };
        }
        event.sender.send('log:message', 'Ninja installation successful. Re-checking for executable...');
        resolvedPaths.ninja = findExecutable('ninja'); // Check again
        if (!resolvedPaths.ninja) {
            return { success: false, error: 'Could not find Ninja executable after installation. You may need to restart the application or your terminal.' };
        }
    }
    event.sender.send('log:message', `[OK] Found Ninja: ${resolvedPaths.ninja}`);

    // 3. Check for objdiff-cli, and download it if missing
    if (!resolvedPaths.objdiff) {
        const projectPath = store.get('userPaths.projectPath');
        if (!projectPath) return { success: false, error: 'Project path not set. Cannot download objdiff-cli.' };
        
        event.sender.send('log:message', '[WARN] objdiff-cli not found. Attempting to download...');
        const downloadUrl = 'https://github.com/encounter/objdiff/releases/download/v2.7.1/objdiff-cli-windows-x86_64.exe';
        const destPath = path.join(projectPath, 'objdiff-cli.exe');
        try {
            await downloadFile(event, downloadUrl, destPath);
            resolvedPaths.objdiff = destPath;
        } catch (downloadError) {
            event.sender.send('log:error', `Failed to download objdiff-cli: ${downloadError.message}. Verification Dashboard will not work.`);
        }
    }
    if(resolvedPaths.objdiff) event.sender.send('log:message', `[OK] Found objdiff-cli: ${resolvedPaths.objdiff}`);
    
    event.sender.send('log:message', '--- Toolchain Verification Complete ---', 'success');
    return { success: true, paths: resolvedPaths };
}


// --- Main Setup Handler ---
async function handleProjectSetup(event, { projectPath, dolPath }, store, executeAndLog) {
    const verificationResult = await verifyAndHealToolchain(event, store, executeAndLog);
    if (!verificationResult.success) {
        event.sender.send('log:error', verificationResult.error);
        return { success: false, error: verificationResult.error };
    }
    
    const resolvedPaths = verificationResult.paths;
    const sessionEnv = buildEnvFromPaths(resolvedPaths);

    event.sender.send('log:message', '--- Starting Project Configuration ---');
    const meleePath = path.join(projectPath, 'melee');
    
    if (!fs.existsSync(meleePath)) {
        const cloneResult = await executeAndLog(event, `git clone https://github.com/doldecomp/melee.git "${meleePath}"`, { cwd: projectPath, env: sessionEnv });
        if (cloneResult.code !== 0) return { success: false, error: "Failed to clone 'melee' repository." };
    } else {
        event.sender.send('log:message', `'melee' directory already exists. Skipping clone.`);
    }

    const origDolDir = path.join(meleePath, 'orig', 'GALE01', 'sys');
    if (!fs.existsSync(origDolDir)) fs.mkdirSync(origDolDir, { recursive: true });
    fs.copyFileSync(dolPath, path.join(origDolDir, 'main.dol'));
    event.sender.send('log:message', 'Copied main.dol to project directory.');

    // **FIXED**: Added '&' call operator for PowerShell
    const configureResult = await executeAndLog(event, `& "${resolvedPaths.python}" configure.py`, { cwd: meleePath, env: sessionEnv });
    if (configureResult.code !== 0) return { success: false, error: 'Failed to run configure.py' };

    const ninjaResult = await executeAndLog(event, 'ninja', { cwd: meleePath, env: sessionEnv });
    if (ninjaResult.code !== 0) return { success: false, error: 'Initial ninja build failed' };

    store.set('toolchainPaths', resolvedPaths);
    event.sender.send('log:message', 'Project setup successful! Toolchain paths saved.');
    return { success: true, env: sessionEnv };
}

module.exports = {
    handleProjectSetup,
    resolveToolchainPaths,
    buildEnvFromPaths,
};