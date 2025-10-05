document.addEventListener('DOMContentLoaded', () => {
    const activitySelect = document.getElementById('activity');
    const customActivityInput = document.getElementById('custom-activity');
    const hoursInput = document.getElementById('hours');
    const minutesInput = document.getElementById('minutes');
    const descriptionInput = document.getElementById('description');
    const addButton = document.getElementById('add-entry');
    const chartCtx = document.getElementById('timeChart').getContext('2d');
    const dailyEntriesList = document.getElementById('daily-entries-list');

    let myChart;
    const colors = {};

    // --- IndexedDB Setup ---
    const DB_NAME = 'TimeTrackerDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'entries';
    let db;

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = event => {
                console.error('IndexedDB error:', event.target.errorCode);
                reject('Failed to open database');
            };

            request.onsuccess = event => {
                db = event.target.result;
                console.log('Database opened successfully');
                resolve();
            };

            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    function addEntryToDB(entry) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.add(entry);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = event => {
                reject('Error adding entry:', event.target.error);
            };
        });
    }

    function getAllEntries() {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.getAll();

            request.onsuccess = event => {
                resolve(event.target.result);
            };

            request.onerror = event => {
                reject('Error getting entries:', event.target.error);
            };
        });
    }

    function updateEntryInDB(entry) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.put(entry);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = event => {
                reject('Error updating entry:', event.target.error);
            };
        });
    }

    function deleteEntryFromDB(id) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.delete(id);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = event => {
                reject('Error deleting entry:', event.target.error);
            };
        });
    }

    // --- UI Logic ---
    activitySelect.addEventListener('change', () => {
        const selectedValue = activitySelect.value;
        if (selectedValue === 'Custom') {
            customActivityInput.style.display = 'block';
            descriptionInput.style.display = 'none';
        } else if (selectedValue === 'Work') {
            customActivityInput.style.display = 'none';
            descriptionInput.style.display = 'block';
            descriptionInput.placeholder = 'What did you work on?';
        } else if (selectedValue === 'Study') {
            customActivityInput.style.display = 'none';
            descriptionInput.style.display = 'block';
            descriptionInput.placeholder = 'What did you study?';
        } else {
            customActivityInput.style.display = 'none';
            descriptionInput.style.display = 'none';
        }
    });

    // --- Chart Rendering ---
    function renderChart(rawData) {
        const dailyData = rawData.reduce((acc, entry) => {
            const date = new Date(entry.timestamp).toLocaleDateString('en-US');
            if (!acc[date]) { acc[date] = {}; }
            if (!acc[date][entry.activity]) { acc[date][entry.activity] = 0; }
            acc[date][entry.activity] += entry.hours;
            return acc;
        }, {});

        const dates = Object.keys(dailyData).sort((a, b) => new Date(a) - new Date(b));
        const activities = [...new Set(rawData.map(entry => entry.activity))].sort();

        function assignColors(activities) {
            activities.forEach(activity => {
                if (!colors[activity]) { colors[activity] = getRandomColor(); }
            });
        }
        assignColors(activities);

        const datasets = activities.map(activity => {
            return {
                label: activity,
                data: dates.map(date => dailyData[date][activity] || 0),
                backgroundColor: colors[activity],
            };
        });

        if (myChart) { myChart.destroy(); }

        myChart = new Chart(chartCtx, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        max: 24,
                        title: {
                            display: true,
                            text: 'Hours'
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                    },
                    legend: {
                        position: 'top',
                    }
                }
            }
        });
    }

    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // --- Entry Validation and Addition ---
    addButton.addEventListener('click', async () => {
        const activity = activitySelect.value === 'Custom' ? customActivityInput.value.trim() : activitySelect.value;
        const hours = parseFloat(hoursInput.value) || 0;
        const minutes = parseFloat(minutesInput.value) || 0;
        const description = (activity === 'Work' || activity === 'Study') ? descriptionInput.value.trim() : '';
        const totalHours = hours + (minutes / 60);

        if (!activity || totalHours <= 0) {
            alert('Please enter a valid activity and a time greater than 0.');
            return;
        }

        const data = await getAllEntries();
        const today = new Date().toLocaleDateString('en-US');
        
        const existingEntry = data.find(entry => 
            new Date(entry.timestamp).toLocaleDateString('en-US') === today && entry.activity === activity
        );
        if (existingEntry) {
            alert(`An entry for "${activity}" already exists for today. Please use the edit function to change it.`);
            return;
        }

        const dailyTotal = data
            .filter(entry => new Date(entry.timestamp).toLocaleDateString('en-US') === today)
            .reduce((sum, entry) => sum + entry.hours, 0);

        if (dailyTotal + totalHours > 24) {
            alert('Total time for today cannot exceed 24 hours. Please edit an existing entry instead.');
            return;
        }

        const newEntry = {
            activity: activity,
            hours: totalHours,
            timestamp: new Date().toISOString(),
            description: description
        };

        await addEntryToDB(newEntry);
        const updatedData = await getAllEntries();
        renderChart(updatedData);
        renderEditList(updatedData);

        hoursInput.value = '';
        minutesInput.value = '';
        descriptionInput.value = '';
        if (activitySelect.value === 'Custom') {
            customActivityInput.value = '';
            customActivityInput.style.display = 'none';
        }
        descriptionInput.style.display = 'none';
        activitySelect.value = 'Sleep';
    });

    // --- Edit and Delete Functionality ---
    function renderEditList(rawData) {
        const dailyEntries = rawData.reduce((acc, entry) => {
            const date = new Date(entry.timestamp).toLocaleDateString('en-US');
            if (!acc[date]) { acc[date] = []; }
            acc[date].push(entry);
            return acc;
        }, {});

        dailyEntriesList.innerHTML = '';

        Object.keys(dailyEntries).sort((a, b) => new Date(b) - new Date(a)).forEach(date => {
            const dayContainer = document.createElement('li');
            dayContainer.classList.add('day-entry');
            dayContainer.innerHTML = `<h3>${date}</h3>`;
            
            const list = document.createElement('ul');
            dailyEntries[date].forEach(entry => {
                const listItem = document.createElement('li');
                listItem.classList.add('entry-item');
                const hours = Math.floor(entry.hours);
                const minutes = Math.round((entry.hours - hours) * 60);
                listItem.innerHTML = `
                    <div class="entry-details">
                        <span>${entry.activity}: ${hours}h ${minutes}m</span>
                        <div class="action-buttons">
                            <button class="edit-btn" data-id="${entry.id}">Edit</button>
                            <button class="delete-btn" data-id="${entry.id}">Delete</button>
                        </div>
                    </div>
                    ${entry.description ? `<p class="entry-description">${entry.description}</p>` : ''}
                `;
                list.appendChild(listItem);
            });
            dayContainer.appendChild(list);
            dailyEntriesList.appendChild(dayContainer);
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
                if (confirm('Are you sure you want to delete this entry?')) {
                    deleteEntry(id);
                }
            });
        });
    }

    async function editEntry(id) {
        const data = await getAllEntries();
        const entryToEdit = data.find(entry => entry.id === id);

        if (!entryToEdit) return;
        
        const newHoursStr = prompt(`Editing ${entryToEdit.activity} on ${new Date(entryToEdit.timestamp).toLocaleDateString('en-US')}. Enter new time in hours (e.g., 2.5):`, entryToEdit.hours.toFixed(2));
        
        if (newHoursStr === null) return;
        
        const newHours = parseFloat(newHoursStr);
        if (isNaN(newHours) || newHours < 0) {
            alert('Invalid time entered.');
            return;
        }

        let newDescription = entryToEdit.description;
        if (entryToEdit.activity === 'Work' || entryToEdit.activity === 'Study') {
            const promptText = (entryToEdit.activity === 'Work') ? 'Enter new description for what you worked on:' : 'Enter new description for what you studied:';
            newDescription = prompt(promptText, entryToEdit.description);
            if (newDescription === null) return;
        }

        const totalHoursForDay = data
            .filter(e => e.id !== id && new Date(e.timestamp).toLocaleDateString('en-US') === new Date(entryToEdit.timestamp).toLocaleDateString('en-US'))
            .reduce((sum, e) => sum + e.hours, 0);

        if (totalHoursForDay + newHours > 24) {
            alert('This edit would cause the daily total to exceed 24 hours. Please enter a lower value.');
            return;
        }

        entryToEdit.hours = newHours;
        entryToEdit.description = newDescription;
        await updateEntryInDB(entryToEdit);
        const updatedData = await getAllEntries();
        renderChart(updatedData);
        renderEditList(updatedData);
    }
    
    async function deleteEntry(id) {
        await deleteEntryFromDB(id);
        const updatedData = await getAllEntries();
        renderChart(updatedData);
        renderEditList(updatedData);
    }

    // --- Initial Load ---
    async function initialize() {
        await openDB();
        const data = await getAllEntries();
        renderChart(data);
        renderEditList(data);
    }

    initialize();
});