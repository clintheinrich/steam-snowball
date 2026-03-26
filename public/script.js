document.addEventListener('DOMContentLoaded', () => {
    const HLTB_CACHE_KEY = 'hltbCache:v1';
    const HLTB_CACHE_LIMIT = 2000;
    const loadBtn = document.getElementById('loadBtn');
    const apiKeyInput = document.getElementById('apiKey');
    const steamIdInput = document.getElementById('steamId');
    const statusMsg = document.getElementById('statusMsg');
    const resultsPanel = document.getElementById('resultsPanel');
    const gamesBody = document.getElementById('gamesBody');
    const statsDisplay = document.getElementById('statsDisplay');
    const searchFilter = document.getElementById('searchFilter');
    const unplayedOnlyFilter = document.getElementById('unplayedOnly');
    const maxHoursEnabledFilter = document.getElementById('maxHoursEnabled');
    const maxHoursFilter = document.getElementById('maxHoursFilter');

    let gamesData = [];
    let processingQueue = [];
    let abortController = null;
    let currentSortKey = 'playtime';
    let currentSortDir = 'desc';
    let hltbCache = loadHltbCache();

    if (localStorage.getItem('steamApiKey')) apiKeyInput.value = localStorage.getItem('steamApiKey');
    if (localStorage.getItem('steamId')) steamIdInput.value = localStorage.getItem('steamId');
    if (localStorage.getItem('searchFilter')) searchFilter.value = localStorage.getItem('searchFilter');
    if (localStorage.getItem('unplayedOnly') === 'true') unplayedOnlyFilter.checked = true;
    if (localStorage.getItem('maxHoursEnabled') === 'true') maxHoursEnabledFilter.checked = true;
    if (localStorage.getItem('maxHoursFilter')) maxHoursFilter.value = localStorage.getItem('maxHoursFilter');
    maxHoursFilter.disabled = !maxHoursEnabledFilter.checked;

    const toggleApiKeyBtn = document.getElementById('toggleApiKey');
    if (toggleApiKeyBtn) {
        toggleApiKeyBtn.addEventListener('click', () => {
            const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
            const isVisible = type === 'text';

            apiKeyInput.setAttribute('type', type);
            toggleApiKeyBtn.style.color = isVisible ? '#38bdf8' : '';
            toggleApiKeyBtn.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
            toggleApiKeyBtn.setAttribute('aria-label', isVisible ? 'Hide API key' : 'Show API key');
        });
    }

    loadBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        const steamId = steamIdInput.value.trim();

        if (!steamId) {
            showStatus('Please enter a Steam ID.', 'error');
            return;
        }

        localStorage.setItem('steamApiKey', apiKey);
        localStorage.setItem('steamId', steamId);

        if (abortController) abortController.abort();
        abortController = new AbortController();
        gamesData = [];
        processingQueue = [];
        gamesBody.innerHTML = '';
        resultsPanel.classList.add('hidden');
        showStatus('Fetching Steam library...', 'info');

        try {
            const response = await fetch('/api/fetch_library', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, steam_id: steamId }),
                signal: abortController.signal
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to fetch library.');
            }

            const data = await response.json();
            gamesData = data.games.map(game => ({
                appid: game.appid,
                name: game.name,
                playtime_forever: game.playtime_forever || 0,
                img_icon_url: game.img_icon_url,
                hltb: game.hltb || null,
                source: game.source
            }));

            hydrateGamesFromLocalCache(gamesData);
            persistServerCache(gamesData);

            if (data.errors && data.errors.length > 0) {
                const errorMsg = data.errors.join(' | ');

                if (gamesData.length > 0) {
                    showStatus(`Loaded ${gamesData.length} games. Warning: ${errorMsg}`, 'error');
                } else {
                    showStatus(`Failed: ${errorMsg}`, 'error');
                    return;
                }
            } else {
                showStatus(`Found ${gamesData.length} games. Fetching completion times...`, 'success');
            }

            applyCurrentView();
            resultsPanel.classList.remove('hidden');

            processingQueue = gamesData.filter(game => !game.hltb);

            if (processingQueue.length > 0) {
                showStatus(`Found ${gamesData.length} games. Fetching data for ${processingQueue.length} items...`, 'info');
                processQueue();
            } else {
                showStatus(`Loaded ${gamesData.length} games from cache!`, 'success');
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
            showStatus(error.message, 'error');
        }
    });

    async function processQueue() {
        if (processingQueue.length === 0) {
            showStatus('Finished fetching data.', 'success');
            return;
        }

        const batchSize = 50;
        const batch = processingQueue.splice(0, batchSize);

        const promises = batch.map(async (game) => {
            try {
                const response = await fetch('/api/get_game_time', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ game_name: game.name })
                });

                const targetGame = gamesData.find(g => g.appid === game.appid);
                if (!targetGame) {
                    return;
                }

                if (response.ok) {
                    targetGame.hltb = await response.json();
                } else {
                    targetGame.hltb = { not_found: true };
                }

                saveGameTimeToLocalCache(targetGame.name, targetGame.hltb);

                applyCurrentView();
            } catch (e) {
                console.error(`Error fetching for ${game.name}`, e);
            }
        });

        await Promise.all(promises);

        const remaining = processingQueue.length;
        const total = gamesData.length;
        showStatus(`Fetching completion times... (${total - remaining}/${total})`, 'info');

        if (processingQueue.length > 0) {
            setTimeout(processQueue, 10);
        } else {
            showStatus(`Done! Loaded ${total} games.`, 'success');
        }
    }

    function renderTable(games) {
        gamesBody.innerHTML = '';
        games.forEach(game => {
            const tr = document.createElement('tr');
            tr.id = `row-${game.appid}`;
            tr.innerHTML = getRowHTML(game);
            gamesBody.appendChild(tr);
        });
    }

    function getRowHTML(game) {
        const iconUrl = game.img_icon_url
            ? `http://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
            : 'https://via.placeholder.com/32';

        const playtimeHours = ((game.playtime_forever || 0) / 60).toFixed(1);

        let main = '<div class="loading-pulse"></div>';
        let extra = '<div class="loading-pulse"></div>';
        let compl = '<div class="loading-pulse"></div>';

        if (game.hltb) {
            if (game.hltb.not_found) {
                main = '-';
                extra = '-';
                compl = '-';
            } else {
                main = formatTime(game.hltb.main_story);
                extra = formatTime(game.hltb.main_extra);
                compl = formatTime(game.hltb.completionist);
            }
        }

        return `
            <td class="game-cell">
                <img src="${iconUrl}" class="game-icon" alt="">
                <div class="game-info">
                    <span>${escapeHtml(game.name)}</span>
                </div>
            </td>
            <td>${playtimeHours}h</td>
            <td>${main}</td>
            <td>${extra}</td>
            <td>${compl}</td>
        `;
    }

    function formatTime(val) {
        if (!val) return '-';
        return `${val}h`;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showStatus(msg, type) {
        statusMsg.setAttribute('role', type === 'error' ? 'alert' : 'status');
        statusMsg.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        statusMsg.textContent = msg;
        statusMsg.style.color = type === 'error' ? '#ef4444' : '#38bdf8';
    }

    function getFilteredGames() {
        const term = searchFilter.value.trim().toLowerCase();
        const unplayedOnly = unplayedOnlyFilter.checked;
        const maxHoursEnabled = maxHoursEnabledFilter.checked;
        const maxHours = Number(maxHoursFilter.value);

        return gamesData.filter(game => {
            const playtimeHours = (game.playtime_forever || 0) / 60;

            if (term && !game.name.toLowerCase().includes(term)) {
                return false;
            }

            if (unplayedOnly && playtimeHours > 0) {
                return false;
            }

            if (maxHoursEnabled) {
                if (!Number.isFinite(maxHours) || maxHours < 0) {
                    return false;
                }

                if (playtimeHours >= maxHours) {
                    return false;
                }
            }

            return true;
        });
    }

    function updateStats() {
        const visibleCount = getFilteredGames().length;
        statsDisplay.textContent = `Showing ${visibleCount} of ${gamesData.length} games`;
    }

    function applyCurrentView() {
        sortData(currentSortKey, currentSortDir, false);
        renderTable(getFilteredGames());
        updateStats();
    }

    searchFilter.addEventListener('input', () => {
        localStorage.setItem('searchFilter', searchFilter.value);
        applyCurrentView();
    });

    unplayedOnlyFilter.addEventListener('change', () => {
        localStorage.setItem('unplayedOnly', String(unplayedOnlyFilter.checked));
        applyCurrentView();
    });

    maxHoursEnabledFilter.addEventListener('change', () => {
        localStorage.setItem('maxHoursEnabled', String(maxHoursEnabledFilter.checked));
        maxHoursFilter.disabled = !maxHoursEnabledFilter.checked;
        applyCurrentView();
    });

    maxHoursFilter.addEventListener('input', () => {
        localStorage.setItem('maxHoursFilter', maxHoursFilter.value);
        applyCurrentView();
    });

    document.querySelectorAll('.sort-btn').forEach(button => {
        button.addEventListener('click', () => {
            const sortKey = button.dataset.sort;
            const header = button.closest('th');
            const currentDir = header.dataset.dir === 'asc' ? 'desc' : 'asc';

            document.querySelectorAll('th.sortable').forEach(h => {
                h.dataset.dir = '';
                h.setAttribute('aria-sort', 'none');
                h.querySelector('.arrow').textContent = '';
            });

            header.dataset.dir = currentDir;
            header.setAttribute('aria-sort', currentDir === 'asc' ? 'ascending' : 'descending');
            header.querySelector('.arrow').innerHTML = currentDir === 'asc' ? '&#9650;' : '&#9660;';

            sortData(sortKey, currentDir);
        });
    });

    const defaultSortButton = document.querySelector('.sort-btn[data-sort="playtime"]');
    const defaultSortHeader = defaultSortButton ? defaultSortButton.closest('th') : null;
    if (defaultSortHeader) {
        defaultSortHeader.dataset.dir = currentSortDir;
        defaultSortHeader.setAttribute('aria-sort', 'descending');
        defaultSortHeader.querySelector('.arrow').innerHTML = '&#9660;';
    }

    function sortData(key, dir, rerender = true) {
        currentSortKey = key;
        currentSortDir = dir;

        gamesData.sort((a, b) => {
            let valA;
            let valB;

            if (key === 'playtime') {
                valA = a.playtime_forever;
                valB = b.playtime_forever;
            } else {
                const mapKey = key === 'main' ? 'main_story' : (key === 'extra' ? 'main_extra' : 'completionist');

                valA = a.hltb && !a.hltb.not_found ? parseTime(a.hltb[mapKey]) : -1;
                valB = b.hltb && !b.hltb.not_found ? parseTime(b.hltb[mapKey]) : -1;
            }

            if (valA < valB) return dir === 'asc' ? -1 : 1;
            if (valA > valB) return dir === 'asc' ? 1 : -1;
            return 0;
        });

        if (rerender) {
            renderTable(getFilteredGames());
            updateStats();
        }
    }

    function parseTime(val) {
        return Number(val) || 0;
    }

    function loadHltbCache() {
        try {
            const raw = localStorage.getItem(HLTB_CACHE_KEY);
            if (!raw) {
                return {};
            }

            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            console.warn('Failed to load HLTB cache from localStorage', error);
            return {};
        }
    }

    function saveHltbCache() {
        try {
            hltbCache = pruneHltbCache(hltbCache);
            localStorage.setItem(HLTB_CACHE_KEY, JSON.stringify(hltbCache));
        } catch (error) {
            console.warn('Failed to save HLTB cache to localStorage', error);
        }
    }

    function pruneHltbCache(cache) {
        const entries = Object.entries(cache);
        if (entries.length <= HLTB_CACHE_LIMIT) {
            return cache;
        }

        entries.sort((a, b) => (a[1].cachedAt || 0) - (b[1].cachedAt || 0));
        const trimmedEntries = entries.slice(entries.length - HLTB_CACHE_LIMIT);
        return Object.fromEntries(trimmedEntries);
    }

    function getCachedGameTime(gameName) {
        if (!gameName) {
            return null;
        }

        const entry = hltbCache[gameName];
        return entry ? entry.data : null;
    }

    function saveGameTimeToLocalCache(gameName, gameTimeData) {
        if (!gameName || !gameTimeData) {
            return;
        }

        hltbCache[gameName] = {
            cachedAt: Date.now(),
            data: gameTimeData
        };
        saveHltbCache();
    }

    function hydrateGamesFromLocalCache(games) {
        games.forEach(game => {
            if (game.hltb) {
                return;
            }

            const cachedGameTime = getCachedGameTime(game.name);
            if (cachedGameTime) {
                game.hltb = cachedGameTime;
            }
        });
    }

    function persistServerCache(games) {
        let hasUpdates = false;

        games.forEach(game => {
            if (!game.hltb) {
                return;
            }

            hltbCache[game.name] = {
                cachedAt: Date.now(),
                data: game.hltb
            };
            hasUpdates = true;
        });

        if (hasUpdates) {
            saveHltbCache();
        }
    }
});
