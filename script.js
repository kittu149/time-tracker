// --- IndexedDB Setup ---
const DB_NAME = 'SoloLevelingTimeDB';
const DB_VERSION = 1;
const STORE_NAME = 'timeEntries';
let db;

// --- Global Variables ---
let myChart = null; // Initialize chart to null
let dragSourceEl = null; // Initialize drag element to null
const colors = {}; // Colors map for activity visualization

// Colors matching the Solo Leveling theme for standard activities
const baseColors = {
    'Sleep': '#4299e1',    // Blue - Healing/Rest
    'Exercise': '#00ffff', // Cyan/Aqua - Physical Stat Increase
    'Study': '#63b3ed',    // Light Blue - Mana/Knowledge
    'Work': '#e53e3e',     // Red - High effort/Danger
    'Custom': '#a020f0'    // Magenta/Violet - Unique Skills
};

// Utility to display in-page messages instead of alert()
function showMessage(message, type = 'error') {
    const alertBox = document.getElementById('alert-box');
    
    // Access CSS variable outside DOMContentLoaded scope
    const deleteColor = getComputedStyle(document.documentElement).getPropertyValue('--delete-color').trim();

    alertBox.textContent = message;
    
    if (type === 'error') {
        alertBox.style.backgroundColor = deleteColor;
        alertBox.style.boxShadow = '0 0 10px ' + deleteColor;
    } else {
        alertBox.style.backgroundColor = '#38a169'; // Success color
        alertBox.style.boxShadow = '0 0 10px #38a169';
    }

    alertBox.style.display = 'block';
    setTimeout(() => {
        alertBox.style.display = 'none';
    }, 3000);
}

/**
 * Initializes and opens the IndexedDB database.
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = event => {
            console.error('IndexedDB error:', event.target.errorCode);
            showMessage('DATABASE ERROR: FAILED TO OPEN LOG.', 'error');
            reject('Failed to open database');
        };

        request.onsuccess = event => {
            db = event.target.result;
            resolve();
        };

        request.onupgradeneeded = event => {
            const tempDb = event.target.result;
            if (!tempDb.objectStoreNames.contains(STORE_NAME)) {
                // KeyPath is 'id', autoIncrement is true.
                tempDb.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

/**
 * Retrieves all entries from IndexedDB.
 */
async function getAllEntries() {
    return new Promise(resolve => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = event => {
            let data = event.target.result || [];

            // Separate today's entries for specific ordering
            const today = new Date().toLocaleDateString('en-CA');
            let historyEntries = [];
            let todayEntries = [];

            data.forEach(entry => {
                if (new Date(entry.timestamp).toLocaleDateString('en-CA') === today) {
                    todayEntries.push(entry);
                } else {
                    historyEntries.push(entry);
                }
            });

            // Today's entries are sorted by `sortOrder` for drag-and-drop
            todayEntries.sort((a, b) => (a.sortOrder || a.id) - (b.sortOrder || b.id));
            
            // History entries are sorted by timestamp for chronological chart display
            historyEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            // Combine them for chart rendering
            resolve(historyEntries.concat(todayEntries));
        };
        request.onerror = () => resolve([]);
    });
}

/**
 * Adds a new entry to IndexedDB.
 */
async function addEntryToDB(entry) {
    return new Promise(resolve => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(entry);

        request.onsuccess = event => {
            resolve(event.target.result);
        };
        request.onerror = () => {
            showMessage('DATABASE WRITE FAILED: COULD NOT ADD ENTRY.', 'error');
            resolve(null);
        };
    });
}

/**
 * Updates an entry in IndexedDB.
 */
async function updateEntryInDB(entry) {
    return new Promise(resolve => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = () => resolve(true);
        request.onerror = () => {
            showMessage('DATABASE WRITE FAILED: COULD NOT UPDATE ENTRY.', 'error');
            resolve(false);
        };
    });
}

/**
 * Deletes an entry from IndexedDB.
 */
async function deleteEntryFromDB(id) {
    return new Promise(resolve => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve(true);
        request.onerror = () => {
            showMessage('DATABASE WRITE FAILED: COULD NOT DELETE ENTRY.', 'error');
            resolve(false);
        };
    });
}


// --- Main Application Logic ---

document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements Initialization (MOVED HERE) ---
    const activitySelect = document.getElementById('activity');
    const customActivityInput = document.getElementById('custom-activity');
    const customActivityGroup = document.getElementById('custom-activity-group');
    const hoursInput = document.getElementById('hours');
    const minutesInput = document.getElementById('minutes');
    const descriptionInput = document.getElementById('description');
    const addButton = document.getElementById('add-entry');
    
    // Get the context *before* calling initialize/saveAndRender
    const chartCtx = document.getElementById('timeChart').getContext('2d'); 
    const dailyEntriesList = document.getElementById('daily-entries-list');
    
    await initialize();

    
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    function assignColors(activities) {
        activities.forEach(activity => {
            if (!colors[activity]) {
                colors[activity] = baseColors[activity] || getRandomColor(); 
            }
        });
    }


    // --- UI State & Logic ---
    activitySelect.addEventListener('change', () => {
        const selectedValue = activitySelect.value;
        customActivityGroup.style.display = 'none';
        descriptionInput.style.display = 'none';
        descriptionInput.placeholder = 'ENTER DETAILS';

        if (selectedValue === 'Custom') {
            customActivityGroup.style.display = 'flex';
            descriptionInput.style.display = 'block';
        } else if (selectedValue === 'Work' || selectedValue === 'Study') {
            descriptionInput.style.display = 'block';
        }
    });

    // --- Chart Rendering ---
    function renderChart(rawData) {
        const dailyData = rawData.reduce((acc, entry) => {
            const date = new Date(entry.timestamp).toLocaleDateString('en-CA'); 
            if (!acc[date]) { acc[date] = {}; }
            if (!acc[date][entry.activity]) { acc[date][entry.activity] = 0; }
            acc[date][entry.activity] += entry.hours;
            return acc;
        }, {});

        const dates = Object.keys(dailyData).sort();
        
        // Use all unique activities for the dataset labels
        const activities = [...new Set(rawData.map(entry => entry.activity))];
        
        assignColors(activities);

        const datasets = activities.map(activity => {
            return {
                label: activity,
                data: dates.map(date => dailyData[date][activity] || 0),
                backgroundColor: colors[activity],
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 1
            };
        });

        if (myChart) { myChart.destroy(); }
        
        Chart.defaults.font.family = 'Rajdhani, sans-serif';
        Chart.defaults.color = 'var(--text-light)';

        myChart = new Chart(chartCtx, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, color: 'var(--text-light)' }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(26, 32, 44, 0.9)',
                        titleColor: 'var(--primary-color)',
                        bodyColor: 'var(--text-light)',
                        borderColor: 'var(--primary-color)',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: 'rgba(160, 32, 240, 0.15)' },
                        ticks: { color: '#63b3ed' },
                        title: { display: true, text: 'DATE', color: 'var(--primary-color)' }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        max: 24,
                        grid: { color: 'rgba(160, 32, 240, 0.15)' },
                        ticks: { color: 'var(--text-data)' },
                        title: { display: true, text: 'HOURS ALLOCATED', color: 'var(--primary-color)' }
                    }
                }
            }
        });
    }


    // --- Entry Validation and Addition ---
    addButton.addEventListener('click', async () => {
        const activityType = activitySelect.value;
        const activity = activityType === 'Custom' ? customActivityInput.value.trim() : activitySelect.value;
        const hours = parseFloat(hoursInput.value) || 0;
        const minutes = parseFloat(minutesInput.value) || 0;
        const description = (activityType === 'Work' || activityType === 'Study' || activityType === 'Custom') ? descriptionInput.value.trim() : '';
        const totalHours = hours + (minutes / 60);

        if (!activity || totalHours <= 0) {
            showMessage('ERROR: INVALID ACTIVITY OR TIME. TIME MUST BE > 0.', 'error');
            return;
        }

        const rawData = await getAllEntries();
        const today = new Date().toLocaleDateString('en-CA');
        
        // Check for duplicate activity on the same day
        const isDuplicate = rawData.some(entry => {
            const entryDate = new Date(entry.timestamp).toLocaleDateString('en-CA');
            return entryDate === today && entry.activity === activity;
        });
        
        if (isDuplicate) {
            showMessage('WARNING: ACTIVITY ALREADY LOGGED. USE EDIT TO UPDATE.', 'error');
            return;
        }

        const dailyTotal = rawData
            .filter(entry => new Date(entry.timestamp).toLocaleDateString('en-CA') === today)
            // We sum up the time for all today's entries
            .reduce((sum, entry) => sum + entry.hours, 0);

        if (dailyTotal + totalHours > 24.01) { 
            showMessage('WARNING: DAILY LIMIT (24H) EXCEEDED. ADJUST STATS.', 'error');
            return;
        }

        const newEntry = {
            activity: activity,
            hours: totalHours,
            timestamp: new Date().toISOString(),
            description: description,
            sortOrder: Date.now() // Used for today's display order
        };

        const newId = await addEntryToDB(newEntry);
        
        if (newId) {
            // Clear inputs
            hoursInput.value = '';
            minutesInput.value = '';
            descriptionInput.value = '';
            if (activitySelect.value === 'Custom') {
                customActivityInput.value = '';
                customActivityGroup.style.display = 'none';
            }
            descriptionInput.style.display = 'none';
            activitySelect.value = 'Sleep';
            showMessage('STAT RECORDED: ENTRY ADDED SUCCESSFULLY.', 'success');
            await saveAndRender();
        }
    });

    // --- Drag-and-Drop Handlers ---
    function handleDragStart(e) {
        dragSourceEl = this;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.id);
        this.classList.add('dragging');
    }

    function handleDragOver(e) {
        e.preventDefault(); 
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDragEnter(e) {
        this.classList.add('border-b-2', 'border-solid', 'border-cyan-500');
    }

    function handleDragLeave(e) {
        this.classList.remove('border-b-2', 'border-solid', 'border-cyan-500');
    }

    async function handleDrop(e) {
        e.stopPropagation();
        
        if (dragSourceEl !== this) {
            const sourceId = parseInt(dragSourceEl.dataset.id);
            const targetId = parseInt(this.dataset.id);

            const rawData = await getAllEntries();
            const sourceEntry = rawData.find(e => e.id === sourceId);
            const targetEntry = rawData.find(e => e.id === targetId);

            if (sourceEntry && targetEntry) {
                const today = new Date().toLocaleDateString('en-CA');
                const isSourceToday = new Date(sourceEntry.timestamp).toLocaleDateString('en-CA') === today;
                const isTargetToday = new Date(targetEntry.timestamp).toLocaleDateString('en-CA') === today;

                if (isSourceToday && isTargetToday) {
                    // Swap the sort orders of the source and target entries
                    const sourceSortOrder = sourceEntry.sortOrder;
                    targetEntry.sortOrder = sourceSortOrder;
                    sourceEntry.sortOrder = targetEntry.sortOrder; // This line should be assigned the original target sort order
                    
                    // Re-fetch data to get accurate sort order before swapping values again.
                    // The easiest, most robust way is to re-assign sort order based on position in the list, 
                    // but since IndexedDB is async, swapping the property values and saving is cleaner.
                    // Let's ensure the swap is correct:
                    // We need to keep the original target sort order for the source entry, and assign the original source sort order to the target entry.

                    // Let's use temporary storage for the swap:
                    const tempSortOrder = sourceEntry.sortOrder;
                    sourceEntry.sortOrder = targetEntry.sortOrder;
                    targetEntry.sortOrder = tempSortOrder;
                    
                    // Save both changes to the database
                    await updateEntryInDB(sourceEntry);
                    await updateEntryInDB(targetEntry);
                    
                    await saveAndRender(); 
                } else {
                    showMessage('WARNING: CAN ONLY REORDER TODAY\'S ENTRIES.', 'error');
                }
            } else {
                 showMessage('ERROR: FAILED TO LOCATE ENTRY FOR REORDER.', 'error');
            }
        }
        
        this.classList.remove('border-b-2', 'border-solid', 'border-cyan-500');
        return false;
    }

    function handleDragEnd(e) {
        this.classList.remove('dragging');
        document.querySelectorAll('.entry-item').forEach(item => {
            item.classList.remove('border-b-2', 'border-solid', 'border-cyan-500');
        });
    }

    // --- Edit and Delete Functionality ---
    function renderEditList(rawData) {
        dailyEntriesList.innerHTML = '';
        
        const today = new Date().toLocaleDateString('en-CA');
        
        // 1. Filter: Only show today's entries
        const todayEntries = rawData.filter(entry => 
            new Date(entry.timestamp).toLocaleDateString('en-CA') === today
        );
        
        if (todayEntries.length === 0) {
            dailyEntriesList.innerHTML = `<li class="text-center text-gray-500">[MISSION LOG EMPTY] No entries for today.</li>`;
            return;
        }

        const maxTime = todayEntries.reduce((max, entry) => Math.max(max, entry.hours), 0) || 1;

        todayEntries.forEach(entry => {
            const listItem = document.createElement('li');
            
            // Attach drag events
            listItem.setAttribute('draggable', true);
            listItem.dataset.id = entry.id;
            listItem.addEventListener('dragstart', handleDragStart, false);
            listItem.addEventListener('dragenter', handleDragEnter, false);
            listItem.addEventListener('dragleave', handleDragLeave, false);
            listItem.addEventListener('dragover', handleDragOver, false);
            listItem.addEventListener('drop', handleDrop, false);
            listItem.addEventListener('dragend', handleDragEnd, false);
            listItem.title = "Drag to reorder today's stats";
            
            const hours = Math.floor(entry.hours);
            const minutes = Math.round((entry.hours - hours) * 60);
            const percent = (entry.hours / maxTime) * 100;
            const activityColor = baseColors[entry.activity] || colors[entry.activity] || 'gray';
            
            listItem.classList.add('entry-item', 'py-2', 'px-3', 'border-l-4', 'border-indigo-500', 'bg-gray-800', 'transition');
            
            listItem.innerHTML = `
                <div class="entry-details w-full flex justify-between items-start text-sm">
                    <span class="text-gray-200 uppercase">${entry.activity}</span>
                    <div class="text-right">
                        <span class="font-bold entry-time text-lg block leading-none">${hours}h ${minutes}m</span>
                        <div class="action-buttons flex gap-2 mt-1">
                            <button class="edit-btn rounded-full hover:shadow-lg" data-id="${entry.id}">[EDIT]</button>
                            <button class="delete-btn rounded-full hover:shadow-lg" data-id="${entry.id}">[DELETE]</button>
                        </div>
                    </div>
                </div>
                <div class="stat-bar-container mt-2">
                    <div class="stat-bar" style="width: ${percent}%; background-color: ${activityColor}; box-shadow: 0 0 4px ${activityColor};"></div>
                </div>
                ${(entry.description && entry.description.length > 0) ? `<p class="text-xs text-gray-500 mt-2 ml-1 italic border-l pl-2 border-gray-600">MISSION LOG: ${entry.description}</p>` : ''}
            `;
            dailyEntriesList.appendChild(listItem);
        });

        document.querySelectorAll('.edit-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                editEntry(id);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                // Using browser's built-in confirm() as a temporary solution as custom modal creation is outside this scope
                if (confirm('WARNING: DELETE THIS LOG ENTRY? CONFIRM EXECUTION.')) { 
                    deleteEntry(id);
                }
            });
        });
    }

    async function editEntry(id) {
        const rawData = await getAllEntries();
        const entryToEdit = rawData.find(entry => entry.id === id);

        if (!entryToEdit) return;
        
        // Using browser's built-in prompt() as a temporary solution
        const newHoursStr = prompt(`[EDIT STAT]: CURRENT TIME FOR ${entryToEdit.activity} is ${entryToEdit.hours.toFixed(2)} hours. ENTER NEW TIME (e.g., 2.5):`, entryToEdit.hours.toFixed(2));
        
        if (newHoursStr === null) return;
        
        const newHours = parseFloat(newHoursStr);
        if (isNaN(newHours) || newHours < 0) {
            showMessage('ERROR: INVALID TIME ENTERED.', 'error');
            return;
        }

        let newDescription = entryToEdit.description;
        if (entryToEdit.activity === 'Work' || entryToEdit.activity === 'Study' || entryToEdit.activity === 'Custom') {
            const promptText = `[EDIT OBJECTIVE]: UPDATE DESCRIPTION FOR ${entryToEdit.activity}:`;
             // Using browser's built-in prompt() as a temporary solution
            newDescription = prompt(promptText, entryToEdit.description);
            if (newDescription === null) return;
        }

        const totalHoursForDay = rawData
            .filter(e => e.id !== id && new Date(e.timestamp).toLocaleDateString('en-CA') === new Date(entryToEdit.timestamp).toLocaleDateString('en-CA'))
            .reduce((sum, e) => sum + e.hours, 0);

        if (totalHoursForDay + newHours > 24.01) {
            showMessage('ERROR: DAILY TIME LIMIT EXCEEDED. CHECK LOG.', 'error');
            return;
        }

        entryToEdit.hours = newHours;
        entryToEdit.description = newDescription || '';
        
        const success = await updateEntryInDB(entryToEdit);
        if (success) {
            showMessage(`STAT UPDATED: ${entryToEdit.activity} MODIFIED.`, 'success');
            await saveAndRender();
        }
    }
    
    async function deleteEntry(id) {
        const success = await deleteEntryFromDB(id);
        if (success) {
            showMessage('LOG DELETED: ENTRY PURGED.', 'success');
            await saveAndRender();
        }
    }

    // --- Core Render Function ---
    async function saveAndRender() {
        const data = await getAllEntries();
        renderChart(data); 
        renderEditList(data); 
    }

    // --- Initialization ---
    async function initialize() {
        await openDB();
        
        // Check data and start rendering immediately (no dummy data)
        await saveAndRender();
    }
});