document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const runReportBtn = document.getElementById('run-report-btn');
    const backBtn = document.getElementById('back-to-main-btn');
    const tableBody = document.getElementById('table-body');
    const resultsTable = document.getElementById('results-table');
    const reportPlaceholder = document.getElementById('report-placeholder');
    const summarySection = document.getElementById('summary-section');
    const overallProgressEl = document.getElementById('overall-progress');
    const progressBarEl = document.getElementById('progress-bar');
    const matchedObjectsEl = document.getElementById('matched-objects');
    const reportTimestampEl = document.getElementById('report-timestamp');
    // NEW: Get elements for filter and sort controls
    const controlsSection = document.getElementById('controls-section');
    const filterInput = document.getElementById('filter-input');
    const tableHeader = resultsTable.querySelector('thead');

    // --- State Management ---
    const state = {
        report: null,
        expandedRows: new Set(),
        // NEW: Add state for filtering and sorting
        filterQuery: '',
        sortKey: 'match_percent', // Default sort
        sortDirection: 'asc',   // 'asc' or 'desc'
    };

    // --- Event Listeners ---
    backBtn.addEventListener('click', () => {
        window.electronAPI.navigate('index');
    });

    runReportBtn.addEventListener('click', handleRunReport);

    tableBody.addEventListener('click', (event) => {
        const row = event.target.closest('tr.expandable');
        if (row) {
            handleRowToggle(row.dataset.unitName);
        }
    });

    // NEW: Listen for input on the filter box
    filterInput.addEventListener('input', (e) => {
        state.filterQuery = e.target.value.toLowerCase();
        renderTable(); // Re-render the table with the filter applied
    });

    // NEW: Listen for clicks on the table header for sorting
    tableHeader.addEventListener('click', (event) => {
        const headerCell = event.target.closest('.sortable');
        if (headerCell) {
            handleSort(headerCell.dataset.sortKey);
        }
    });

    // --- Core Functions ---
    async function handleRunReport() {
        setLoadingState(true);
        try {
            const result = await window.electronAPI.objdiff.runReport();
            if (result.error) throw new Error(result.error);
            if (!result.report) throw new Error('The objdiff command did not return a valid report.');
            
            // Set initial state
            state.report = result.report;
            state.expandedRows.clear();
            state.filterQuery = '';
            filterInput.value = ''; // Clear input field visually
            
            // Apply default sort before rendering
            sortUnits();
            render();

        } catch (error) {
            setErrorState(error.message);
        } finally {
            setLoadingState(false);
        }
    }

    function handleRowToggle(unitName) {
        if (state.expandedRows.has(unitName)) {
            state.expandedRows.delete(unitName);
        } else {
            state.expandedRows.add(unitName);
        }
        renderTable();
    }
    
    // NEW: Handle a click on a sortable header
    function handleSort(newSortKey) {
        if (state.sortKey === newSortKey) {
            // If already sorting by this key, reverse direction
            state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            // If sorting by a new key, set it and default to ascending
            state.sortKey = newSortKey;
            state.sortDirection = 'asc';
        }
        sortUnits(); // Apply the sort to the data
        render();    // Re-render the whole UI
    }

    // NEW: A dedicated function to sort the units array based on the current state
    function sortUnits() {
        if (!state.report || !state.report.units) return;

        state.report.units.sort((a, b) => {
            const valA = a[state.sortKey];
            const valB = b[state.sortKey];

            if (valA < valB) return state.sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return state.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // --- Rendering ---
    function render() {
        if (!state.report) {
            summarySection.classList.add('hidden');
            resultsTable.classList.add('hidden');
            controlsSection.classList.add('hidden'); // NEW: Hide controls
            reportPlaceholder.classList.remove('hidden');
            reportPlaceholder.textContent = 'Click "Run Verification Report" to start.';
            reportPlaceholder.classList.remove('text-red-500');
            return;
        }

        summarySection.classList.remove('hidden');
        resultsTable.classList.remove('hidden');
        controlsSection.classList.remove('hidden'); // NEW: Show controls
        reportPlaceholder.classList.add('hidden');

        renderSummary();
        renderTable();
        renderSortIndicators(); // NEW: Update sort arrows in header
    }
    
    function renderSummary() {
        // ... (this function is unchanged)
        const { total_progress, matched_objects, total_objects, timestamp } = state.report;
        const progress = (total_progress * 100).toFixed(2);

        overallProgressEl.textContent = `${progress}%`;
        progressBarEl.style.width = `${progress}%`;
        matchedObjectsEl.textContent = `${matched_objects} / ${total_objects}`;
        reportTimestampEl.textContent = new Date(timestamp).toLocaleString();
    }

    function renderTable() {
        let html = '';
        // NEW: Filter the units before rendering
        const filteredUnits = state.report.units.filter(unit => 
            unit.name.toLowerCase().includes(state.filterQuery)
        );

        filteredUnits.forEach(unit => {
            const isMismatch = unit.match_percent < 1.0;
            const isExpanded = state.expandedRows.has(unit.name);
            const matchPercent = (unit.match_percent * 100).toFixed(2);
            const rowClass = isMismatch ? 'mismatch-row expandable' : '';

            html += `
                <tr class="${rowClass}" data-unit-name="${unit.name}">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">${unit.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-slate-500">${matchPercent}%</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold ${isMismatch ? 'status-mismatch' : 'status-matched'}">
                        ${isMismatch ? 'Mismatch' : 'Matched'}
                    </td>
                </tr>
            `;

            if (isMismatch && isExpanded) {
                html += renderDetailsRow(unit);
            }
        });
        tableBody.innerHTML = html;
    }

    function renderDetailsRow(unit) {
        // ... (this function is unchanged)
        const mismatchedSymbols = unit.symbols.filter(s => s.match_percent < 1.0);
        let detailsHtml = mismatchedSymbols.map(symbol => {
            const symbolPercent = (symbol.match_percent * 100).toFixed(2);
            return `<li class="font-mono text-xs py-1 px-2 border-b"><strong>${symbol.name}</strong> - ${symbolPercent}% (${symbol.base_size} / ${symbol.target_size} bytes)</li>`;
        }).join('');

        return `
            <tr class="details-row">
                <td colspan="3" class="p-0">
                    <div class="details-content bg-slate-50">
                        <h4 class="text-sm font-bold p-2 bg-slate-200">Mismatched Functions</h4>
                        <ul>${detailsHtml}</ul>
                    </div>
                </td>
            </tr>
        `;
    }

    // NEW: Updates the sort indicators in the table header
    function renderSortIndicators() {
        const allHeaders = tableHeader.querySelectorAll('.sortable');
        allHeaders.forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sortKey === state.sortKey) {
                th.classList.add(state.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // --- UI State Changers ---
    function setLoadingState(isLoading) {
        runReportBtn.disabled = isLoading;
        if (isLoading) {
            runReportBtn.textContent = 'Running...';
            reportPlaceholder.textContent = 'Executing objdiff-cli, this may take a moment...';
            reportPlaceholder.classList.remove('text-red-500');
            reportPlaceholder.classList.remove('hidden');
            resultsTable.classList.add('hidden');
            summarySection.classList.add('hidden');
            controlsSection.classList.add('hidden'); // NEW: Hide controls while loading
        } else {
            runReportBtn.textContent = 'Run Verification Report';
        }
    }

    function setErrorState(message) {
        // ... (this function is unchanged)
        summarySection.classList.add('hidden');
        resultsTable.classList.add('hidden');
        controlsSection.classList.add('hidden');
        reportPlaceholder.classList.remove('hidden');
        reportPlaceholder.textContent = `Error: ${message}`;
        reportPlaceholder.classList.add('text-red-500');
    }

    // --- Initial Render ---
    render(); 
});