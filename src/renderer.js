document.addEventListener('DOMContentLoaded', () => {

    // --- State Management ---
    const state = {
        projectPath: '',
        dolPath: '',
        sessionEnv: {},
        isSetupComplete: false,
        // Dashboard-specific state
        dashboardReport: null,
        dashboardExpandedRows: new Set(),
        dashboardFilterQuery: '',
        dashboardSortKey: 'match_percent',
        dashboardSortDirection: 'asc',
        // Refactor-specific state
        refactorContext: {
            relativePath: null,
            functionName: null,
        },
        refactorLastSuggestion: null,
    };

    // --- Element Cache ---
    const elements = {
        // Views
        views: document.querySelectorAll('.content-scroll-area > div'),
        viewTitle: document.getElementById('view-title'),

        // Navigation
        nav: {
            setup: document.getElementById('nav-setup'),
            decomp: document.getElementById('nav-decomp'),
            build: document.getElementById('nav-build'),
            dashboard: document.getElementById('nav-dashboard'),
            refactor: document.getElementById('nav-refactor'),
            settings: document.getElementById('nav-settings'),
        },
        
        // Global
        consoleLog: document.getElementById('output-console'),
        consoleContainer: document.getElementById('output-console-container'),
        githubLinkBtn: document.getElementById('github-link-btn'),
        decompMeLinkBtn: document.getElementById('decomp-me-link-btn'),

        // Setup View
        projectFolderInput: document.getElementById('project-folder'),
        mainDolInput: document.getElementById('main-dol-path'),
        selectFolderBtn: document.getElementById('select-folder-btn'),
        selectFileBtn: document.getElementById('select-file-btn'),
        runSetupBtn: document.getElementById('run-setup-btn'),

        // Settings View
        settings: {
            pythonPath: document.getElementById('settings-python-path'),
            gitPath: document.getElementById('settings-git-path'),
            ninjaPath: document.getElementById('settings-ninja-path'),
            objdiffPath: document.getElementById('settings-objdiff-path'),
            saveBtn: document.getElementById('save-settings-btn'),
            browseBtns: document.querySelectorAll('.browse-exe-btn'),
        },

        // Decompilation View
        decomp: {
            asmFileSelect: document.getElementById('asm-file-select'),
            asmSelectValue: document.querySelector('#asm-file-select .custom-select-value'),
            asmSelectOptions: document.querySelector('#asm-file-select .custom-select-options'),
            hideCompletedCheckbox: document.getElementById('hide-completed-checkbox'),
            vacantFunctionsList: document.getElementById('vacant-functions'),
            claimedFunctionsList: document.getElementById('claimed-functions'),
            selectedTarget: document.getElementById('selected-target'),
            checkDecompMeBtn: document.getElementById('check-decomp-me-btn'),
            refactorWithAIBtn: document.getElementById('refactor-with-ai-btn'),
            targetAssemblyBox: document.getElementById('target-assembly-box'),
            structInspectorBox: document.getElementById('struct-inspector-box'),
            copyAssemblyBtn: document.getElementById('copy-assembly-btn'),
            copyContextBtn: document.getElementById('copy-context-btn'),
            contextBox: document.getElementById('context-box'),
        },

        // Build & Verify View
        build: {
            matchedCode: document.getElementById('matched-code'),
            injectCodeBtn: document.getElementById('inject-code-btn'),
            revertChangesBtn: document.getElementById('revert-changes-btn'),
            runNinjaBtn: document.getElementById('run-ninja-btn'),
            decompMeLink: document.getElementById('decomp-me-link'),
            submitGithubBtn: document.getElementById('submit-github-btn'),
        },
        
        // Verification Dashboard View
        dashboard: {
            runReportBtn: document.getElementById('dashboard-run-report-btn'),
            summarySection: document.getElementById('dashboard-summary-section'),
            overallProgress: document.getElementById('dashboard-overall-progress'),
            progressBar: document.getElementById('dashboard-progress-bar'),
            matchedObjects: document.getElementById('dashboard-matched-objects'),
            reportTimestamp: document.getElementById('dashboard-report-timestamp'),
            controlsSection: document.getElementById('dashboard-controls-section'),
            filterInput: document.getElementById('dashboard-filter-input'),
            resultsContainer: document.getElementById('dashboard-results-container'),
            resultsTable: document.getElementById('dashboard-results-table'),
            tableHeader: document.querySelector('#dashboard-results-table thead'),
            tableBody: document.getElementById('dashboard-table-body'),
            reportPlaceholder: document.getElementById('dashboard-report-placeholder'),
        },

        // AI Refactor View
        refactor: {
            container: document.getElementById('view-refactor'),
            asmView: document.getElementById('refactor-asm-view'),
            cCodeEditor: document.getElementById('refactor-c-code-editor'),
            suggestBtn: document.getElementById('refactor-suggest-btn'),
            recompileBtn: document.getElementById('refactor-recompile-btn'),
            aiOutput: document.getElementById('refactor-ai-output'),
            aiActions: document.querySelector('#refactor-ai-panel .actions'),
            acceptBtn: document.getElementById('refactor-accept-btn'),
            dismissBtn: document.getElementById('refactor-dismiss-btn'),
            statusBar: document.getElementById('refactor-status-bar'),
        },
    };

    // --- Logger ---
    function logMessage(message, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        const textNode = document.createTextNode(message);
        const messageSpan = document.createElement('span');
        messageSpan.className = `log-${type}`;
        messageSpan.appendChild(textNode);
        logEntry.innerHTML = `<span class="log-time">[${time}] </span>`;
        logEntry.appendChild(messageSpan);
        elements.consoleLog.appendChild(logEntry);
        elements.consoleLog.scrollTop = elements.consoleLog.scrollHeight;
    }

    // --- Navigation ---
    function showView(viewId, title) {
        elements.views.forEach(view => view.classList.add('hidden'));
        document.getElementById(viewId).classList.remove('hidden');

        elements.viewTitle.textContent = title;
        
        // Hide/Show console based on view
        elements.consoleContainer.style.display = (viewId === 'view-refactor') ? 'none' : 'block';

        // Update active nav item
        Object.values(elements.nav).forEach(navItem => navItem.classList.remove('active'));
        const activeNav = elements.nav[viewId.split('-')[1]];
        if (activeNav) activeNav.classList.add('active');
    }

    function updateNavState() {
        ['decomp', 'build', 'dashboard', 'refactor'].forEach(navId => {
            const navItem = elements.nav[navId];
            if (state.isSetupComplete) {
                navItem.classList.remove('disabled');
            } else {
                navItem.classList.add('disabled');
            }
        });
    }

    // --- Core Setup & Settings Logic ---
    async function loadUserPaths() {
        const paths = await window.electronAPI.getPaths();
        if (paths.projectPath) {
            state.projectPath = paths.projectPath;
            elements.projectFolderInput.value = state.projectPath;
            logMessage(`Loaded saved project folder: ${state.projectPath}`);
            // If project path exists, assume setup might be complete.
            // A more robust check could verify the existence of './melee/build.ninja'
            state.isSetupComplete = true; 
            updateNavState();
            await populateAsmFiles();
        }
        if (paths.dolPath) {
            state.dolPath = paths.dolPath;
            elements.mainDolInput.value = state.dolPath;
            logMessage(`Loaded saved main.dol path: ${state.dolPath}`);
        }
    }

    async function loadSettings() {
        logMessage('Loading settings...');
        const settings = await window.electronAPI.getSettings();
        elements.settings.pythonPath.value = settings.python || '';
        elements.settings.gitPath.value = settings.git || '';
        elements.settings.ninjaPath.value = settings.ninja || '';
        elements.settings.objdiffPath.value = settings.objdiff || '';
        logMessage('Settings loaded.');
    }

    async function saveSettings() {
        const settings = {
            python: elements.settings.pythonPath.value,
            git: elements.settings.gitPath.value,
            ninja: elements.settings.ninjaPath.value,
            objdiff: elements.settings.objdiffPath.value
        };
        await window.electronAPI.setSettings(settings);
        logMessage('Settings saved successfully. They will be used on the next run.', 'success');
        showView('view-setup', 'Project Setup');
    }

    async function selectProjectFolder() {
        const selectedPath = await window.electronAPI.selectDirectory();
        if (selectedPath) {
            state.projectPath = selectedPath;
            elements.projectFolderInput.value = state.projectPath;
            logMessage(`Project folder set to: ${state.projectPath}`, 'success');
            await window.electronAPI.setPaths({ projectPath: state.projectPath });
        }
    }

    async function selectMainDolFile() {
        const filePath = await window.electronAPI.selectFile({ filters: [{ name: 'DOL Files', extensions: ['dol'] }] });
        if (filePath) {
            state.dolPath = filePath;
            elements.mainDolInput.value = state.dolPath;
            logMessage(`Selected main.dol: ${filePath}`, 'success');
            await window.electronAPI.setPaths({ dolPath: filePath });
        }
    }

    async function runInitialSetup() {
        if (!state.projectPath || !state.dolPath) {
            logMessage("Please select a project folder and main.dol path first.", "error");
            return;
        }
        elements.runSetupBtn.disabled = true;
        elements.runSetupBtn.textContent = 'Setting up... Please wait.';

        try {
            logMessage("--- Starting Automated Setup ---", "info");
            const result = await window.electronAPI.runProjectSetup({ projectPath: state.projectPath, dolPath: state.dolPath });

            if (result.success) {
                logMessage("--- Project Setup Finished Successfully! ---", "success");
                state.sessionEnv = result.env;
                state.isSetupComplete = true;
                logMessage("Pre-loading project headers for Struct Inspector...", "info");
                await window.electronAPI.structs.load(state.projectPath);
                logMessage("Header cache built.", "success");
                await populateAsmFiles();
                updateNavState();
                showView('view-decomp', 'Decompilation');
            } else {
                logMessage(`--- Setup failed. ${result.error} ---`, "error");
                const settingsNav = elements.nav.settings.querySelector('svg');
                settingsNav.classList.add('attention');
                setTimeout(() => settingsNav.classList.remove('attention'), 1000);
            }
        } catch (error) {
            logMessage(`A critical error occurred: ${error.message}`, "error");
        } finally {
            elements.runSetupBtn.disabled = false;
            elements.runSetupBtn.textContent = '2. Configure Environment & Run Setup';
        }
    }

    // --- Decompilation View Logic ---
    async function populateAsmFiles() {
        if (!state.projectPath) return;
        const hideCompleted = elements.decomp.hideCompletedCheckbox.checked;
        logMessage('Fetching assembly file list...');
        const result = await window.electronAPI.getAsmFiles({ projectPath: state.projectPath, hideCompleted });
        
        const { asmSelectValue, asmSelectOptions } = elements.decomp;
        asmSelectOptions.innerHTML = '';
        asmSelectValue.dataset.value = '';
        asmSelectValue.querySelector('span').textContent = '-- Select a file to analyze --';

        if (result.error) {
            logMessage(`Error fetching files: ${result.error}`, 'error');
            asmSelectValue.querySelector('span').textContent = '-- Error loading files --';
        } else if (result.files) {
            result.files.forEach(fileData => {
                const option = document.createElement('div');
                option.className = 'custom-select-option';
                option.dataset.value = fileData.path;
                const vacantClass = fileData.vacant === 0 ? 'claimed-count' : 'vacant-count';
                option.innerHTML = `${fileData.path} (<span class="${vacantClass}">${fileData.vacant}</span>/<span class="claimed-count">${fileData.claimed}</span>)`;
                option.addEventListener('click', () => {
                    asmSelectValue.querySelector('span').innerHTML = option.innerHTML;
                    asmSelectValue.dataset.value = fileData.path;
                    asmSelectOptions.classList.add('hidden');
                    findVacantFunctions();
                });
                asmSelectOptions.appendChild(option);
            });
            logMessage(`Found ${result.files.length} files.`, 'success');
        }
    }

    async function findVacantFunctions() {
        const selectedFile = elements.decomp.asmSelectValue.dataset.value;
        if (!selectedFile) return;

        logMessage(`Analyzing ${selectedFile}...`);
        const { vacantFunctionsList, claimedFunctionsList, contextBox, targetAssemblyBox, selectedTarget, checkDecompMeBtn, refactorWithAIBtn } = elements.decomp;
        vacantFunctionsList.innerHTML = '<li class="text-slate-400 italic">Loading...</li>';
        claimedFunctionsList.innerHTML = '';
        contextBox.value = '';
        targetAssemblyBox.innerHTML = '';
        selectedTarget.textContent = 'None';
        checkDecompMeBtn.disabled = true;
        refactorWithAIBtn.disabled = true;

        try {
            const result = await window.electronAPI.analyzeFiles({ projectPath: state.projectPath, relativePath: selectedFile });
            vacantFunctionsList.innerHTML = '';
            if (result.error) throw new Error(result.error);
            
            result.vacant.forEach(func => {
                const li = document.createElement('li');
                li.textContent = `${func.name} (${func.size} lines)`;
                li.className = 'p-1 hover:bg-indigo-100 rounded cursor-pointer font-mono text-sm';
                li.onclick = () => selectTarget(func.name, selectedFile);
                vacantFunctionsList.appendChild(li);
            });
            if (result.vacant.length === 0) vacantFunctionsList.innerHTML = '<li class="text-slate-400 italic">No vacant functions found.</li>';
            
            result.claimed.forEach(funcName => {
                const li = document.createElement('li');
                li.textContent = funcName;
                li.className = 'p-1 bg-green-50 rounded font-mono text-sm text-slate-500';
                claimedFunctionsList.appendChild(li);
            });
             if (result.claimed.length === 0) claimedFunctionsList.innerHTML = '<li class="text-slate-400 italic">No claimed functions found.</li>';

            contextBox.value = result.includes;
            logMessage(`Analysis complete. Found ${result.vacant.length} vacant functions.`, 'success');
        } catch (error) {
            logMessage(`Error analyzing file: ${error.message}`, 'error');
            vacantFunctionsList.innerHTML = `<li class="text-red-500 italic">Error loading functions.</li>`;
        }
    }
    
    async function selectTarget(funcName, relativePath) {
        logMessage(`Selected target: ${funcName}`);
        state.refactorContext = { functionName: funcName, relativePath };
        const { selectedTarget, checkDecompMeBtn, refactorWithAIBtn, targetAssemblyBox } = elements.decomp;
        selectedTarget.textContent = funcName;
        checkDecompMeBtn.disabled = false;
        refactorWithAIBtn.disabled = false;
        
        const result = await window.electronAPI.getFunctionAsm({ projectPath: state.projectPath, relativePath, functionName: funcName });
        targetAssemblyBox.innerHTML = '';
        if (result.error) {
            logMessage(`Error fetching assembly for ${funcName}: ${result.error}`, 'error');
            targetAssemblyBox.textContent = `Error: ${result.error}`;
        } else {
            result.asm.split('\n').forEach(line => {
                const lineDiv = document.createElement('div');
                lineDiv.textContent = line;
                lineDiv.onclick = () => inspectAssemblyLine(line);
                targetAssemblyBox.appendChild(lineDiv);
            });
            logMessage(`Successfully loaded assembly for ${funcName}.`, 'success');
        }
    }

    async function inspectAssemblyLine(lineText) {
        const inspectorBox = elements.decomp.structInspectorBox;
        const match = lineText.match(/0x[a-fA-F0-9]+\((r\d{1,2})\)/);
        if (!match) {
            inspectorBox.innerHTML = '<p class="text-slate-400 italic">Not a valid memory access line.</p>';
            return;
        }
        
        const offsetHex = match[0].split('(')[0];
        const offset = parseInt(offsetHex, 16);
        inspectorBox.innerHTML = '<p class="text-slate-400 italic">Searching...</p>';
        
        const results = await window.electronAPI.structs.lookup(offset);
        if (results && results.length > 0) {
            inspectorBox.innerHTML = results.map(res => `
                <div class="p-1 border-b">
                    <p><strong>Struct:</strong> ${res.structName}</p>
                    <p><strong>Member:</strong> ${res.member.type} ${res.member.name}</p>
                    <p><strong>Syntax:</strong> <code class="bg-indigo-100 text-indigo-800 rounded px-1">gobj->${res.member.name}</code></p>
                </div>`).join('');
            logMessage(`Found ${results.length} matches for offset ${offsetHex}.`, 'success');
        } else {
            inspectorBox.innerHTML = '<p class="text-slate-400 italic">No matching struct members found.</p>';
        }
    }

    // --- Build View Logic ---
    async function injectCode() {
        const code = elements.build.matchedCode.value;
        const file = elements.decomp.asmSelectValue.dataset.value;
        if (!code || !file || !state.projectPath) { logMessage("Missing code, file, or project path.", "error"); return; }
        logMessage(`Injecting code into C/H files for ${file}...`);
        const result = await window.electronAPI.injectCode({ projectPath: state.projectPath, relativePath: file, code });
        if (result.success) logMessage("Code injected successfully.", "success");
        else logMessage(`Error injecting code: ${result.error}`, "error");
    }

    async function revertChanges() {
        const file = elements.decomp.asmSelectValue.dataset.value;
        if (!file || !state.projectPath) { logMessage("Missing file or project path.", "error"); return; }
        logMessage(`Reverting changes for ${file}...`);
        const result = await window.electronAPI.revertChanges({ projectPath: state.projectPath, relativePath: file });
        if (result.success) logMessage("File changes reverted successfully.", "success");
        else logMessage(`Error reverting changes: ${result.error}`, "error");
    }

    async function runNinjaVerification() {
        if (!state.projectPath) { logMessage("Project path not set.", "error"); return; }
        logMessage("--- Running local verification build ---", "info");
        await window.electronAPI.execCommand('ninja', state.projectPath + '\\melee', state.sessionEnv);
    }

    function submitToGithub() {
        const link = elements.build.decompMeLink.value;
        const target = elements.decomp.selectedTarget.textContent;
        if (!link) { logMessage("Please enter the link to your decomp.me scratch.", "error"); return; }
        const file = elements.decomp.asmSelectValue.dataset.value;
        const title = `Match: ${target || 'un_function_name'} in ${file.replace('.s', '.c')}`;
        const body = `Link to matching scratch: ${link}`;
        window.electronAPI.openExternal(`https://github.com/doldecomp/melee/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`);
    }

    // --- Verification Dashboard Logic ---
    async function handleDashboardRunReport() {
        setDashboardLoadingState(true);
        try {
            const result = await window.electronAPI.objdiff.runReport();
            if (result.error) throw new Error(result.error);
            state.dashboardReport = result.report;
            state.dashboardExpandedRows.clear();
            state.dashboardFilterQuery = '';
            elements.dashboard.filterInput.value = '';
            sortDashboardUnits();
            renderDashboard();
        } catch (error) {
            setDashboardErrorState(error.message);
        } finally {
            setDashboardLoadingState(false);
        }
    }
    
    function handleDashboardSort(newSortKey) {
        if (state.dashboardSortKey === newSortKey) {
            state.dashboardSortDirection = state.dashboardSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            state.dashboardSortKey = newSortKey;
            state.dashboardSortDirection = 'asc';
        }
        sortDashboardUnits();
        renderDashboard();
    }

    function sortDashboardUnits() {
        if (!state.dashboardReport || !state.dashboardReport.units) return;
        state.dashboardReport.units.sort((a, b) => {
            const valA = a[state.dashboardSortKey];
            const valB = b[state.dashboardSortKey];
            if (valA < valB) return state.dashboardSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return state.dashboardSortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function renderDashboard() {
        const { summarySection, resultsTable, controlsSection, reportPlaceholder } = elements.dashboard;
        if (!state.dashboardReport) {
            summarySection.classList.add('hidden');
            resultsTable.classList.add('hidden');
            controlsSection.classList.add('hidden');
            reportPlaceholder.classList.remove('hidden');
            return;
        }
        summarySection.classList.remove('hidden');
        resultsTable.classList.remove('hidden');
        controlsSection.classList.remove('hidden');
        reportPlaceholder.classList.add('hidden');
        renderDashboardSummary();
        renderDashboardTable();
        renderDashboardSortIndicators();
    }

    function renderDashboardSummary() {
        const { total_progress, matched_objects, total_objects, timestamp } = state.dashboardReport;
        const progress = (total_progress * 100).toFixed(2);
        elements.dashboard.overallProgress.textContent = `${progress}%`;
        elements.dashboard.progressBar.style.width = `${progress}%`;
        elements.dashboard.matchedObjects.textContent = `${matched_objects} / ${total_objects}`;
        elements.dashboard.reportTimestamp.textContent = new Date(timestamp).toLocaleString();
    }

    function renderDashboardTable() {
        const filteredUnits = state.dashboardReport.units.filter(unit => unit.name.toLowerCase().includes(state.dashboardFilterQuery));
        elements.dashboard.tableBody.innerHTML = filteredUnits.map(unit => {
            const isMismatch = unit.match_percent < 1.0;
            const isExpanded = state.dashboardExpandedRows.has(unit.name);
            const matchPercent = (unit.match_percent * 100).toFixed(2);
            let rowHtml = `<tr class="${isMismatch ? 'mismatch-row expandable' : ''}" data-unit-name="${unit.name}">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">${unit.name}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-500">${matchPercent}%</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold ${isMismatch ? 'status-mismatch' : 'status-matched'}">${isMismatch ? 'Mismatch' : 'Matched'}</td>
            </tr>`;
            if (isMismatch && isExpanded) {
                 const mismatchedSymbols = unit.symbols.filter(s => s.match_percent < 1.0);
                 let detailsHtml = mismatchedSymbols.map(s => `<li class="font-mono text-xs py-1 px-2 border-b"><strong>${s.name}</strong> - ${(s.match_percent * 100).toFixed(2)}%</li>`).join('');
                 rowHtml += `<tr class="details-row"><td colspan="3"><div class="details-content bg-slate-50"><h4 class="text-sm font-bold p-2 bg-slate-200">Mismatched Functions</h4><ul>${detailsHtml}</ul></div></td></tr>`;
            }
            return rowHtml;
        }).join('');
    }
    
    function renderDashboardSortIndicators() {
        elements.dashboard.tableHeader.querySelectorAll('.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sortKey === state.dashboardSortKey) {
                th.classList.add(state.dashboardSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    function setDashboardLoadingState(isLoading) {
        elements.dashboard.runReportBtn.disabled = isLoading;
        if (isLoading) {
            elements.dashboard.runReportBtn.textContent = 'Running...';
            elements.dashboard.reportPlaceholder.textContent = 'Executing objdiff-cli...';
            elements.dashboard.reportPlaceholder.classList.remove('hidden');
            elements.dashboard.resultsTable.classList.add('hidden');
            elements.dashboard.summarySection.classList.add('hidden');
        } else {
            elements.dashboard.runReportBtn.textContent = 'Run Verification Report';
        }
    }

    function setDashboardErrorState(message) {
        elements.dashboard.reportPlaceholder.textContent = `Error: ${message}`;
        elements.dashboard.reportPlaceholder.classList.add('text-red-500');
    }

    // --- AI Refactor View Logic ---
    async function loadRefactorView() {
        showView('view-refactor', `AI Refactor: ${state.refactorContext.functionName}`);
        
        const { asmView, cCodeEditor } = elements.refactor;
        asmView.textContent = 'Loading...';
        cCodeEditor.value = 'Loading...';

        const { projectPath } = state;
        const { relativePath, functionName } = state.refactorContext;
        
        const asmResult = await window.electronAPI.getFunctionAsm({ projectPath, relativePath, functionName });
        asmView.textContent = asmResult.error ? `Error: ${asmResult.error}` : asmResult.asm;
        
        const cCodeResult = await window.electronAPI.getFunctionCode({ projectPath, relativePath, functionName });
        cCodeEditor.value = cCodeResult.error ? `/* Error: ${cCodeResult.error} */` : cCodeResult.code;
    }

    function setRefactorStatus(message, { isError = false, isSuccess = false, duration = 4000 } = {}) {
        const { statusBar } = elements.refactor;
        statusBar.textContent = message;
        if (isError) statusBar.style.backgroundColor = '#d13438';
        else if (isSuccess) statusBar.style.backgroundColor = '#107c10';
        else statusBar.style.backgroundColor = '#007acc';

        if (duration > 0) {
            setTimeout(() => {
                statusBar.textContent = 'Ready';
                statusBar.style.backgroundColor = '#007acc';
            }, duration);
        }
    }

    async function handleAISuggestClick() {
        const { suggestBtn, aiOutput, aiActions, asmView, cCodeEditor } = elements.refactor;
        suggestBtn.disabled = true;
        suggestBtn.textContent = 'Thinking...';
        aiOutput.innerHTML = '<p class="placeholder">Contacting Gemini Assistant...</p>';
        aiActions.style.display = 'none';
        state.refactorLastSuggestion = null;

        const result = await window.electronAPI.ai.getSuggestion({ 
            targetAssembly: asmView.textContent, 
            currentCCode: cCodeEditor.value 
        });

        if (result.error) {
            aiOutput.innerHTML = `<p style="color: #ff8888;">Error: ${result.error}</p>`;
        } else {
            state.refactorLastSuggestion = result.suggestion;
            aiOutput.innerHTML = `<div class="reasoning"><strong>AI Reasoning:</strong><p>${result.suggestion.reasoning.replace(/\n/g, '<br>')}</p></div><div class="diff-view"><strong>Suggested Code:</strong><pre class="refactor-code-view">${result.suggestion.code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></div>`;
            aiActions.style.display = 'flex';
        }
        suggestBtn.textContent = '✨ Suggest Refactoring';
        suggestBtn.disabled = false;
    }

    function handleAIAcceptClick() {
        if (!state.refactorLastSuggestion) return;
        elements.refactor.cCodeEditor.value = state.refactorLastSuggestion.code;
        setRefactorStatus('Suggestion applied to editor.', { duration: 2000 });
        handleAIDismissClick();
    }

    function handleAIDismissClick() {
        elements.refactor.aiOutput.innerHTML = '<p class="placeholder">Suggestion dismissed.</p>';
        elements.refactor.aiActions.style.display = 'none';
        state.refactorLastSuggestion = null;
    }

    async function handleAIRecompileClick() {
        const { recompileBtn, cCodeEditor } = elements.refactor;
        recompileBtn.disabled = true;
        setRefactorStatus('Saving and verifying...', { duration: 0 });

        const { projectPath } = state;
        const { relativePath, functionName } = state.refactorContext;

        const result = await window.electronAPI.refactor.verify({
            projectPath, relativePath, functionName,
            newCCode: cCodeEditor.value
        });

        if (!result.success) {
            setRefactorStatus(`Error during ${result.step}: ${result.error}`, { isError: true });
        } else {
            if (result.matchStatus === 'OK') {
                setRefactorStatus('Verification Complete: MATCH OK!', { isSuccess: true });
            } else {
                setRefactorStatus(`Verification Complete: ${result.matchStatus}.`, { isError: true });
            }
        }
        recompileBtn.disabled = false;
    }

    // --- Initialization & Event Listeners ---
    function init() {
        // Global Listeners
        window.electronAPI.onLogMessage(data => logMessage(data.trim(), data.startsWith('Executing:') ? 'command' : 'stdout'));
        window.electronAPI.onLogError(data => logMessage(data.trim(), 'error'));
        elements.githubLinkBtn.addEventListener('click', () => window.electronAPI.openExternal('https://github.com/doldecomp/melee'));
        elements.decompMeLinkBtn.addEventListener('click', () => window.electronAPI.openExternal('https://decomp.me/preset/63'));

        // Navigation
        elements.nav.setup.addEventListener('click', () => showView('view-setup', 'Project Setup'));
        elements.nav.decomp.addEventListener('click', () => state.isSetupComplete && showView('view-decomp', 'Decompilation'));
        elements.nav.build.addEventListener('click', () => state.isSetupComplete && showView('view-build', 'Build & Verify'));
        elements.nav.dashboard.addEventListener('click', () => state.isSetupComplete && showView('view-dashboard', 'Verification Dashboard'));
        elements.nav.settings.addEventListener('click', async () => { await loadSettings(); showView('view-settings', 'Toolchain Configuration'); });

        // Setup View
        elements.selectFolderBtn.addEventListener('click', selectProjectFolder);
        elements.selectFileBtn.addEventListener('click', selectMainDolFile);
        elements.runSetupBtn.addEventListener('click', runInitialSetup);
        
        // Settings View
        elements.settings.saveBtn.addEventListener('click', saveSettings);
        elements.settings.browseBtns.forEach(btn => btn.addEventListener('click', async (event) => {
            const filePath = await window.electronAPI.selectFile({ filters: [{ name: event.currentTarget.dataset.filterName, extensions: [event.currentTarget.dataset.filterExt] }] });
            if (filePath) document.getElementById(event.currentTarget.dataset.targetInput).value = filePath;
        }));

        // Decompilation View
        elements.decomp.hideCompletedCheckbox.addEventListener('change', populateAsmFiles);
        elements.decomp.asmSelectValue.addEventListener('click', () => elements.decomp.asmSelectOptions.classList.toggle('hidden'));
        document.addEventListener('click', (e) => { if (!elements.decomp.asmFileSelect.contains(e.target)) elements.decomp.asmSelectOptions.classList.add('hidden'); });
        elements.decomp.checkDecompMeBtn.addEventListener('click', () => window.electronAPI.openExternal(`https://decomp.me/?q=${elements.decomp.selectedTarget.textContent}`));
        elements.decomp.copyAssemblyBtn.addEventListener('click', () => navigator.clipboard.writeText(elements.decomp.targetAssemblyBox.innerText));
        elements.decomp.copyContextBtn.addEventListener('click', () => navigator.clipboard.writeText(elements.decomp.contextBox.value));
        elements.decomp.refactorWithAIBtn.addEventListener('click', loadRefactorView);

        // Build View
        elements.build.injectCodeBtn.addEventListener('click', injectCode);
        elements.build.revertChangesBtn.addEventListener('click', revertChanges);
        elements.build.runNinjaBtn.addEventListener('click', runNinjaVerification);
        elements.build.submitGithubBtn.addEventListener('click', submitToGithub);

        // Dashboard View
        elements.dashboard.runReportBtn.addEventListener('click', handleDashboardRunReport);
        elements.dashboard.filterInput.addEventListener('input', (e) => { state.dashboardFilterQuery = e.target.value.toLowerCase(); renderDashboardTable(); });
        elements.dashboard.tableHeader.addEventListener('click', (e) => e.target.closest('.sortable') && handleDashboardSort(e.target.closest('.sortable').dataset.sortKey));
        elements.dashboard.tableBody.addEventListener('click', (e) => {
            const row = e.target.closest('tr.expandable');
            if(row) {
                if (state.dashboardExpandedRows.has(row.dataset.unitName)) state.dashboardExpandedRows.delete(row.dataset.unitName);
                else state.dashboardExpandedRows.add(row.dataset.unitName);
                renderDashboardTable();
            }
        });

        // Refactor View
        elements.refactor.suggestBtn.addEventListener('click', handleAISuggestClick);
        elements.refactor.acceptBtn.addEventListener('click', handleAIAcceptClick);
        elements.refactor.dismissBtn.addEventListener('click', handleAIDismissClick);
        elements.refactor.recompileBtn.addEventListener('click', handleAIRecompileClick);

        // --- Initial Load ---
        logMessage("Application initialized.");
        loadUserPaths();
        showView('view-setup', 'Project Setup');
    }

    init();
});