document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const functionNameEl = document.getElementById('function-name');
    const asmViewEl = document.getElementById('asm-view');
    const cCodeEditorEl = document.getElementById('c-code-editor');
    const suggestBtn = document.getElementById('suggest-btn');
    const recompileBtn = document.getElementById('recompile-btn');
    const backBtn = document.getElementById('back-btn');
    const aiOutputEl = document.getElementById('ai-output');
    const aiActionsEl = document.querySelector('#ai-panel .actions');
    const acceptBtn = document.getElementById('accept-btn');
    const dismissBtn = document.getElementById('dismiss-btn');
    const statusBarEl = document.getElementById('status-bar');

    // --- State ---
    let projectPath, relativePath, functionName, lastSuggestion = null;

    // --- Initialization ---
    function initialize() {
        const context = JSON.parse(sessionStorage.getItem('refactorContext'));
        if (!context) { functionNameEl.textContent = "Error: No context found."; return; }
        
        ({ projectPath, relativePath, functionName } = context);
        functionNameEl.textContent = functionName;
        document.title = `Refactoring ${functionName}`;

        loadInitialData();
        setupEventListeners();
    }

    async function loadInitialData() {
        const asmResult = await window.electronAPI.getFunctionAsm({ projectPath, relativePath, functionName });
        asmViewEl.textContent = asmResult.error ? `Error: ${asmResult.error}` : asmResult.asm;
        
        const cCodeResult = await window.electronAPI.getFunctionCode({ projectPath, relativePath, functionName });
        cCodeEditorEl.value = cCodeResult.error ? `/* Error: ${cCodeResult.error} */` : cCodeResult.code;
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        backBtn.addEventListener('click', () => window.electronAPI.navigate('objdiff'));
        suggestBtn.addEventListener('click', handleSuggestClick);
        acceptBtn.addEventListener('click', handleAcceptClick);
        dismissBtn.addEventListener('click', handleDismissClick);
        recompileBtn.addEventListener('click', handleRecompileClick);
    }
    
    function setStatus(message, { isError = false, isSuccess = false, duration = 4000 } = {}) {
        statusBarEl.textContent = message;
        if (isError) statusBarEl.style.backgroundColor = '#d13438';
        else if (isSuccess) statusBarEl.style.backgroundColor = '#107c10';
        else statusBarEl.style.backgroundColor = '#007acc';

        if (duration > 0) {
            setTimeout(() => {
                statusBarEl.textContent = 'Ready';
                statusBarEl.style.backgroundColor = '#007acc';
            }, duration);
        }
    }

    function toggleButtons(enabled) {
        suggestBtn.disabled = !enabled;
        recompileBtn.disabled = !enabled;
    }

    // --- Core AI Logic & Actions ---
    async function handleSuggestClick() {
        toggleButtons(false);
        suggestBtn.textContent = 'Thinking...';
        aiOutputEl.innerHTML = '<p class="placeholder">Contacting Gemini Assistant...</p>';
        aiActionsEl.style.display = 'none';
        lastSuggestion = null;

        const result = await window.electronAPI.ai.getSuggestion({ 
            targetAssembly: asmViewEl.textContent, 
            currentCCode: cCodeEditorEl.value 
        });

        if (result.error) {
            aiOutputEl.innerHTML = `<p style="color: #ff8888;">Error: ${result.error}</p>`;
        } else {
            lastSuggestion = result.suggestion;
            aiOutputEl.innerHTML = `
                <div class="reasoning"><strong>AI Reasoning:</strong><p>${result.suggestion.reasoning.replace(/\n/g, '<br>')}</p></div>
                <div class="diff-view"><strong>Suggested Code:</strong><pre class="code-view">${result.suggestion.code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></div>`;
            aiActionsEl.style.display = 'flex';
        }
        suggestBtn.textContent = '✨ Suggest Refactoring';
        toggleButtons(true);
    }

    function handleAcceptClick() {
        if (!lastSuggestion) return;
        cCodeEditorEl.value = lastSuggestion.code;
        setStatus('Suggestion accepted and applied to editor.', { duration: 2000 });
        handleDismissClick();
    }

    function handleDismissClick() {
        aiOutputEl.innerHTML = '<p class="placeholder">Suggestion dismissed.</p>';
        aiActionsEl.style.display = 'none';
        lastSuggestion = null;
    }

    async function handleRecompileClick() {
        toggleButtons(false);
        recompileBtn.textContent = 'Working...';
        setStatus('Saving code...', { duration: 0 });

        const result = await window.electronAPI.refactor.verify({
            projectPath,
            relativePath,
            functionName,
            newCCode: cCodeEditorEl.value
        });

        if (!result.success) {
            setStatus(`Error during ${result.step}: ${result.error}`, { isError: true });
        } else {
            if (result.matchStatus === 'OK') {
                setStatus('Verification Complete: MATCH OK!', { isSuccess: true });
            } else {
                setStatus(`Verification Complete: ${result.matchStatus}.`, { isError: true });
            }
        }
        
        recompileBtn.textContent = 'Recompile & Verify';
        toggleButtons(true);
    }

    initialize();
});