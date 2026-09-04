// conflict.js - 要確認（Supabase）

const auth = requireAuth({ requireAdmin: true });
if (!auth) throw new Error('auth');
const { projectId } = auth;

let project = null;
let answerPages = [];
let modelAnswers = {};
let scoreVotes = [];
let finalResults = [];
let questionScorers = [];
let serverConflictRows = null;
let currentConflicts = [];
let selectedIndex = 0;
let cellUrlCache = {};
let cellUrlPreloadKey = '';
let conflictImageObserver = null;
let conflictImageFlushTimer = null;
const conflictImageQueue = new Map();
const CONFLICT_IMAGE_CROP_CONCURRENCY = 12;
const BACKGROUND_CONFLICT_IMAGE_BATCH = 24;
let conflictBackgroundPreloadToken = 0;
let lastConflictRenderSignature = '';
let scoreConflictRpcAvailable = true;
let conflictRefreshTimer = null;
let conflictRefreshPromise = null;
let shouldResetConflictSelection = true;

async function runLimited(items, limit, task) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        results.push(...await Promise.all(batch.map(task)));
    }
    return results;
}

function logPerf(label, details = {}) {
    console.info('[CIQ perf]', label, details);
}

function runWhenIdle(task, timeout = 2500) {
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(task, { timeout });
    } else {
        setTimeout(task, 250);
    }
}

function preloadImageUrl(url) {
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
            if (image.decode) {
                image.decode().then(resolve).catch(resolve);
                return;
            }
            resolve();
        };
        image.onerror = resolve;
        image.src = url;
    });
}

async function preloadImageUrls(urls, limit = CONFLICT_IMAGE_CROP_CONCURRENCY) {
    const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
    if (!uniqueUrls.length) return;
    await runLimited(uniqueUrls, limit, preloadImageUrl);
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function getConflictGridColumnCount(grid) {
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, columns || 1);
}

function getMedianConflictAspect(conflicts) {
    const aspects = conflicts
        .map(conflict => {
            const region = conflict.cellRegion || conflict.cellRegions?.[`q${conflict.q}`] || null;
            const width = Number(region?.w || 0);
            const height = Number(region?.h || 0);
            return width > 0 && height > 0 ? height / width : 0;
        })
        .filter(Boolean)
        .sort((a, b) => a - b);
    if (!aspects.length) return 0.62;
    return aspects[Math.floor(aspects.length / 2)];
}

function getInitialConflictImageLimit(conflicts) {
    const grid = document.getElementById('conflict-grid');
    const style = getComputedStyle(grid);
    const columns = getConflictGridColumnCount(grid);
    const columnGap = Number.parseFloat(style.columnGap || style.gap || '0') || 0;
    const inlinePadding = (Number.parseFloat(style.paddingLeft || '0') || 0) + (Number.parseFloat(style.paddingRight || '0') || 0);
    const gridWidth = Math.max(1, grid.clientWidth || window.innerWidth);
    const cardWidth = Math.max(1, (gridWidth - inlinePadding - columnGap * (columns - 1)) / columns);
    const estimatedRowHeight = Math.max(96, cardWidth * getMedianConflictAspect(conflicts) + 76);
    const gridTop = Math.max(0, grid.getBoundingClientRect().top);
    const visibleHeight = Math.max(estimatedRowHeight, window.innerHeight - gridTop);
    const rows = Math.max(1, Math.ceil(visibleHeight / estimatedRowHeight) + 1);
    return Math.min(conflicts.length, columns * rows);
}

function setConflictGridMessage(message, options = {}) {
    const grid = document.getElementById('conflict-grid');
    grid.textContent = '';
    const messageEl = document.createElement('div');
    messageEl.className = `${options.className || 'loading-state'} grid-message`;
    if (options.icon) {
        const icon = createIcon(options.icon);
        if (options.iconSize) {
            icon.classList.add('message-icon-large');
        }
        if (options.iconColor === 'var(--success)') icon.classList.add('message-icon-success');
        messageEl.append(icon, ' ');
    }
    messageEl.appendChild(document.createTextNode(message));
    grid.appendChild(messageEl);
}

function setConflictActionsDisabled(disabled) {
    document.getElementById('conflict-action-bar')?.classList.toggle('u-hidden', disabled);
    document.getElementById('conflict-correct-btn')?.toggleAttribute('disabled', disabled);
    document.getElementById('conflict-wrong-btn')?.toggleAttribute('disabled', disabled);
}

async function init() {
    try {
        selectedIndex = 0;
        shouldResetConflictSelection = true;
        await refreshData();
        startConflictRefreshTimer();
    } catch (e) {
        setConflictGridMessage(e.message || '要確認データを読み込めませんでした', { icon: 'triangle-exclamation' });
        const counter = document.getElementById('counter');
        counter.textContent = '読み込み失敗';
        counter.className = 'counter has-conflicts';
    }
}

function startConflictRefreshTimer() {
    if (conflictRefreshTimer || document.hidden) return;
    conflictRefreshTimer = setInterval(refreshData, 5000);
}

function stopConflictRefreshTimer() {
    if (!conflictRefreshTimer) return;
    clearInterval(conflictRefreshTimer);
    conflictRefreshTimer = null;
}

async function refreshData() {
    if (conflictRefreshPromise) return conflictRefreshPromise;
    conflictRefreshPromise = refreshDataInternal().finally(() => {
        conflictRefreshPromise = null;
    });
    return conflictRefreshPromise;
}

async function refreshDataInternal() {
    const startedAt = performance.now();
    if (scoreConflictRpcAvailable) {
        try {
            serverConflictRows = await CIQSupabaseAPI.listScoreConflicts(projectId);
            const dataMs = Math.round(performance.now() - startedAt);
            const renderStartedAt = performance.now();
            await render();
            logPerf('conflictRefresh', {
                conflicts: currentConflicts.length,
                dataMs,
                renderMs: Math.round(performance.now() - renderStartedAt),
                totalMs: Math.round(performance.now() - startedAt),
                source: 'rpc',
            });
            return;
        } catch (error) {
            scoreConflictRpcAvailable = false;
            serverConflictRows = null;
            console.warn('Score conflict RPC unavailable; falling back to client calculation.', error);
        }
    }

    const [
        projectRow,
        pages,
        modelRows,
        votes,
        finals,
        scorers,
    ] = await Promise.all([
        project ? Promise.resolve(project) : CIQSupabaseAPI.getProject(projectId),
        CIQSupabaseAPI.listAnswerPages(projectId),
        CIQSupabaseAPI.listModelAnswers(projectId),
        CIQSupabaseAPI.listScoreVotes(projectId),
        CIQSupabaseAPI.listFinalResults(projectId),
        CIQSupabaseAPI.listQuestionScorers(projectId),
    ]);
    const dataMs = Math.round(performance.now() - startedAt);

    project = projectRow;
    answerPages = pages;
    scoreVotes = votes;
    finalResults = finals;
    questionScorers = scorers;
    modelAnswers = {};
    for (const row of modelRows) modelAnswers[row.question_number] = row.answer;

    const renderStartedAt = performance.now();
    await render();
    logPerf('conflictRefresh', {
        pages: answerPages.length,
        votes: scoreVotes.length,
        conflicts: currentConflicts.length,
        dataMs,
        renderMs: Math.round(performance.now() - renderStartedAt),
        totalMs: Math.round(performance.now() - startedAt),
        source: 'client',
    });
}

function getEntryMeta(page) {
    const entry = page.entries || {};
    const entryNumber = Number(entry.entry_number || 0);
    return {
        entryId: page.entry_id,
        entryNumber,
        displayName: entry.entry_name || `No.${String(entryNumber).padStart(3, '0')}`,
        affiliation: entry.affiliation || '',
        grade: entry.grade || '',
        storagePath: page.storage_path || '',
        cellRegions: page.cells?.regions || {},
        pageWidth: Number(page.cells?.pageWidth || 0) || null,
        cellGeneration: page.cells?.cellGeneration || null,
    };
}

function buildConflicts() {
    if (serverConflictRows) return serverConflictRows;

    const conflicts = [];
    const required = Number(project?.required_scorers || 3);
    const totalQuestions = Number(project?.question_count || 100);
    const completedByQuestion = new Map();
    const pagesMeta = answerPages
        .map(getEntryMeta)
        .filter(meta => meta.entryId && meta.entryNumber);
    const votesByQuestionEntry = new Map();
    const finalsByQuestionEntry = new Map();

    for (const scorer of questionScorers) {
        if (!scorer.completed_at) continue;
        const q = Number(scorer.question_number);
        completedByQuestion.set(q, (completedByQuestion.get(q) || 0) + 1);
    }

    for (const vote of scoreVotes) {
        const q = Number(vote.question_number);
        const key = `${q}:${vote.entry_id}`;
        const list = votesByQuestionEntry.get(key) || [];
        list.push(vote);
        votesByQuestionEntry.set(key, list);
    }

    for (const finalResult of finalResults) {
        const q = Number(finalResult.question_number);
        finalsByQuestionEntry.set(`${q}:${finalResult.entry_id}`, finalResult);
    }

    for (let q = 1; q <= totalQuestions; q++) {
        if ((completedByQuestion.get(q) || 0) < required) continue;

        for (const meta of pagesMeta) {
            const key = `${q}:${meta.entryId}`;
            const votes = votesByQuestionEntry.get(key) || [];
            let corrects = 0;
            let wrongs = 0;
            for (const vote of votes) {
                if (vote.result === 'correct') corrects++;
                if (vote.result === 'wrong') wrongs++;
            }
            const finalResult = finalsByQuestionEntry.get(key);

            if (corrects >= required || wrongs >= required) continue;
            conflicts.push({
                q,
                ...meta,
                cellStatus: CIQSupabaseAPI.getCellStatus({ cellGeneration: meta.cellGeneration }, q),
                cellPath: CIQSupabaseAPI.getCellStatus({ cellGeneration: meta.cellGeneration }, q)
                    ? CIQSupabaseAPI.getAnswerCellPath(projectId, meta.entryNumber, q)
                    : null,
                cellGenerationVersion: meta.cellGeneration?.version || null,
                votes,
                finalResult: finalResult?.result || null,
            });
        }
    }

    return conflicts.sort((a, b) => a.q - b.q || a.entryNumber - b.entryNumber);
}

function getMissingConflictImageRequests(conflicts) {
    return conflicts
        .map(conflict => ({
            key: `${conflict.entryNumber}:q${conflict.q}`,
            entryNumber: conflict.entryNumber,
            questionNumber: conflict.q,
            entryId: conflict.entryId,
            storagePath: conflict.storagePath,
            cellRegion: conflict.cellRegion || conflict.cellRegions?.[`q${conflict.q}`] || null,
            pageWidth: conflict.pageWidth,
            cellStatus: conflict.cellStatus || null,
            cellPath: conflict.cellPath || null,
        }))
        .filter(request => cellUrlCache[request.key] === undefined);
}

function getConflictRenderSignature(conflicts) {
    return conflicts.map((conflict) => {
        const votes = conflict.votes
            .map(vote => `${vote.scorer_member_id || ''}:${vote.result || ''}`)
            .sort()
            .join(',');
        return [
            conflict.q,
            conflict.entryId,
            conflict.entryNumber,
            conflict.finalResult || '',
            conflict.modelAnswer || modelAnswers[conflict.q] || '',
            votes,
        ].join(':');
    }).join('|');
}

function updateConflictSelectionClasses() {
    document.querySelectorAll('.conflict-card').forEach((card, i) => {
        const selected = i === selectedIndex;
        card.classList.toggle('selected', selected);
        card.setAttribute('aria-selected', selected ? 'true' : 'false');
        card.tabIndex = selected ? 0 : -1;
    });
}

async function render() {
    const previousSelected = currentConflicts[selectedIndex] || null;
    currentConflicts = buildConflicts().sort(compareConflictsByQuestionAndEntry);
    CIQSupabaseAPI.enqueueAnswerCellGeneration(projectId, currentConflicts.map(conflict => ({
        ...conflict,
        questionNumber: conflict.q,
    })));
    if (shouldResetConflictSelection) {
        // question.js の setInitialSelectionToFirstUnscored と同じく、未確定の先頭から始める。
        // 確定済みカードは並び替えずその場に残るので、先頭固定だと確定済みを選んだ状態で開いてしまう。
        const firstUnresolved = currentConflicts.findIndex(conflict => !conflict.finalResult);
        selectedIndex = firstUnresolved >= 0 ? firstUnresolved : 0;
        shouldResetConflictSelection = false;
    } else if (previousSelected) {
        const nextIndex = currentConflicts.findIndex(conflict => (
            conflict.entryId === previousSelected.entryId
            && Number(conflict.q) === Number(previousSelected.q)
        ));
        selectedIndex = nextIndex >= 0 ? nextIndex : Math.min(selectedIndex, Math.max(0, currentConflicts.length - 1));
    } else if (selectedIndex >= currentConflicts.length) {
        selectedIndex = Math.max(0, currentConflicts.length - 1);
    }

    const unresolvedCount = currentConflicts.filter(c => !c.finalResult).length;
    const counter = document.getElementById('counter');
    if (currentConflicts.length === 0 || unresolvedCount === 0) {
        counter.textContent = `全${currentConflicts.length}件 確定済み`;
        counter.className = 'counter all-clear';
    } else {
        counter.textContent = `${unresolvedCount} / ${currentConflicts.length}件`;
        counter.className = 'counter has-conflicts';
    }

    const grid = document.getElementById('conflict-grid');
    if (currentConflicts.length === 0) {
        setConflictActionsDisabled(true);
        lastConflictRenderSignature = '';
        setConflictGridMessage('要確認はありません', {
            className: 'loading-state no-conflict',
            icon: 'circle-check',
            iconSize: '48px',
            iconColor: 'var(--success)',
        });
        return;
    }
    setConflictActionsDisabled(false);

    const renderSignature = getConflictRenderSignature(currentConflicts);
    if (renderSignature === lastConflictRenderSignature && grid.children.length === currentConflicts.length) {
        updateConflictSelectionClasses();
        return;
    }

    const initialImageLimit = getInitialConflictImageLimit(currentConflicts);
    const missingImages = getMissingConflictImageRequests(currentConflicts.slice(0, initialImageLimit));
    if (missingImages.length) {
        setConflictGridMessage('画像を準備中...', { icon: 'spinner' });
        const imageStatsBefore = CIQSupabaseAPI.takeImagePerfStats();
        const imageStartedAt = performance.now();
        await ensureConflictCellUrls(missingImages);
        await preloadImageUrls(missingImages.map(request => cellUrlCache[request.key]));
        logPerf('conflictImagePrep', {
            requested: missingImages.length,
            initialImageLimit,
            imageMs: Math.round(performance.now() - imageStartedAt),
            imageStats: CIQSupabaseAPI.takeImagePerfStats(imageStatsBefore),
        });
        await render();
        return;
    }

    lastConflictRenderSignature = renderSignature;
    grid.textContent = '';
    const fragment = document.createDocumentFragment();
    currentConflicts.forEach((conflict, idx) => {
        const card = createConflictCard(conflict, idx);
        card.addEventListener('click', () => selectConflictCard(idx, { focus: true }));
        card.addEventListener('focus', () => selectConflictCard(idx));
        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            selectConflictCard(idx, { focus: true });
        });
        card.addEventListener('dblclick', () => showPreview(projectId, null, conflict.entryNumber));
        fragment.appendChild(card);
    });
    grid.appendChild(fragment);
    // 再描画の直前に取得が完了していたカードを拾う(プレースホルダの取り残し防止)。
    updateVisibleConflictImages();
    scheduleBackgroundConflictImages(currentConflicts, initialImageLimit);

    scrollToSelectedConflict();
}

function compareConflictsByQuestionAndEntry(a, b) {
    return Number(a.q || a.questionNumber || 0) - Number(b.q || b.questionNumber || 0)
        || Number(a.entryNumber || 0) - Number(b.entryNumber || 0);
}

function createVoteDot(result) {
    const dot = document.createElement('span');
    if (result === 'correct') {
        dot.className = 'vote-dot correct';
        dot.appendChild(createIcon('circle', { size: 12, title: '正解' }));
    } else if (result === 'wrong') {
        dot.className = 'vote-dot wrong';
        dot.appendChild(createIcon('xmark', { size: 12, title: '不正解' }));
    } else if (result === 'hold') {
        dot.className = 'vote-dot hold';
        dot.appendChild(createIcon('triangle', { size: 12, title: '保留' }));
    } else {
        return null;
    }
    return dot;
}

function createConflictCard(conflict, idx) {
    const cacheKey = `${conflict.entryNumber}:q${conflict.q}`;
    const cellUrl = cellUrlCache[cacheKey];
    // cellUrlCache の状態: undefined=未取得 / null=取得中 / ''=取得済みで画像なし / 文字列=URL。
    // null を「取得済み」と数えると、取得中のカードに「画像がありません」と出てしまう。
    const isResolved = typeof cellUrl === 'string';
    const modelAnswer = conflict.modelAnswer || modelAnswers[conflict.q] || '';

    const card = document.createElement('div');
    card.className = `answer-card conflict-card ${conflict.finalResult ? 'resolved ' + conflict.finalResult : ''} ${idx === selectedIndex ? 'selected' : ''}`;
    card.setAttribute('role', 'gridcell');
    card.setAttribute('aria-label', `${conflict.displayName} ${conflict.q}問 要確認`);
    card.setAttribute('aria-selected', idx === selectedIndex ? 'true' : 'false');
    card.tabIndex = idx === selectedIndex ? 0 : -1;
    card._ciqConflict = conflict;
    if (cellUrl) {
        const image = document.createElement('img');
        image.src = cellUrl;
        image.alt = `${conflict.displayName} ${conflict.q}問`;
        image.loading = idx < 12 ? 'eager' : 'lazy';
        image.decoding = 'async';
        if (idx < 12) image.fetchPriority = 'high';
        attachConflictImageErrorFallback(image, conflict);
        card.appendChild(image);
    } else {
        const expired = document.createElement('div');
        expired.className = 'img-expired';
        const icon = createIcon('clock');
        expired.append(icon, isResolved ? ' 画像がありません' : ' 画像を読み込み中');
        card.appendChild(expired);
        if (!isResolved && conflict.storagePath && (conflict.cellRegion || conflict.cellRegions?.[`q${conflict.q}`])) {
            observeConflictImage(card, conflict);
        }
    }

    const entryNum = document.createElement('div');
    entryNum.className = 'entry-num';
    entryNum.textContent = conflict.displayName;
    card.appendChild(entryNum);

    const reviewRow = document.createElement('div');
    reviewRow.className = 'conflict-review-row';
    const model = document.createElement('span');
    model.className = 'conflict-review-answer';
    model.textContent = modelAnswer || '未登録';
    const votes = document.createElement('span');
    votes.className = 'votes-mini';
    conflict.votes.forEach((vote, index) => {
        const dot = createVoteDot(vote.result);
        if (!dot) return;
        if (index > 0 && votes.childNodes.length) votes.appendChild(document.createTextNode(' '));
        votes.appendChild(dot);
    });
    reviewRow.append(model, votes);
    card.appendChild(reviewRow);
    return card;
}

function scoreSelectedConflict(result) {
    const conflict = currentConflicts[selectedIndex];
    if (!conflict) return;
    const card = document.querySelectorAll('.conflict-card')[selectedIndex];
    if (card) {
        card.classList.add('score-pop');
        setTimeout(() => card.classList.remove('score-pop'), 150);
    }
    // 書き込みを待たずに選択を進める(question.js の scoreSelected と同じ)。
    // 進めるのは setFinal より前。render() は「描画開始時点の選択」を復元するので、
    // 後から進めると選択が判定済みのカードへ戻ってしまう。
    advanceConflictSelection();
    setFinal(conflict.q, conflict.entryId, result)
        .catch(err => showToast(err.message, 'error'));
}

function attachConflictImageErrorFallback(image, conflict) {
    image.addEventListener('error', () => {
        const key = `${conflict.entryNumber}:q${conflict.q}`;
        if (conflict.cellStatus === 'ready') {
            CIQSupabaseAPI.markAnswerCellFailed(projectId, conflict.entryId, conflict.q);
        }
        delete cellUrlCache[key];
        const placeholder = document.createElement('div');
        placeholder.className = 'img-expired';
        const icon = createIcon('clock');
        placeholder.append(icon, ' 画像を読み込み中');
        image.replaceWith(placeholder);
        queueConflictImage(conflict);
    }, { once: true });
}

function observeConflictImage(card, conflict) {
    if (!conflictImageObserver && 'IntersectionObserver' in window) {
        conflictImageObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                conflictImageObserver.unobserve(entry.target);
                queueConflictImage(entry.target._ciqConflict);
            });
        }, { rootMargin: '300px 0px' });
    }
    card._ciqConflict = conflict;
    if (conflictImageObserver) {
        conflictImageObserver.observe(card);
    } else {
        queueConflictImage(conflict);
    }
}

function queueConflictImage(conflict) {
    const key = `${conflict.entryNumber}:q${conflict.q}`;
    const cached = cellUrlCache[key];
    if (typeof cached === 'string') {
        // 背景プリロードが先にキャッシュを埋めていることがある。ここで黙って返すと
        // カードのプレースホルダが「画像を読み込み中」のまま残るため、その場で反映する。
        updateVisibleConflictImages([{ key }]);
        return;
    }
    if (cached === null) return; // 取得中。完了時に flush 側が反映する
    conflictImageQueue.set(key, {
        key,
        entryNumber: conflict.entryNumber,
        questionNumber: conflict.q,
        storagePath: conflict.storagePath,
        cellRegion: conflict.cellRegion || conflict.cellRegions?.[`q${conflict.q}`] || null,
        pageWidth: conflict.pageWidth,
        cellStatus: conflict.cellStatus || null,
        cellPath: conflict.cellPath || null,
        entryId: conflict.entryId,
    });
    if (conflictImageFlushTimer) return;
    conflictImageFlushTimer = setTimeout(flushConflictImages, 40);
}

async function flushConflictImages() {
    conflictImageFlushTimer = null;
    const batch = Array.from(conflictImageQueue.values());
    conflictImageQueue.clear();
    if (!batch.length) return;
    await ensureConflictCellUrls(batch);
    await preloadImageUrls(batch.map(request => cellUrlCache[request.key]));
    await nextFrame();
    updateVisibleConflictImages(batch);
}

// requests を省略すると、いま画面にある全カードを対象に掃く。
// 取得済みなのにプレースホルダのまま残っているカードを最後に拾うために使う。
function updateVisibleConflictImages(requests) {
    const requestKeys = requests ? new Set(requests.map(request => request.key)) : null;
    document.querySelectorAll('.conflict-card').forEach((card) => {
        const conflict = card._ciqConflict;
        if (!conflict) return;
        const key = `${conflict.entryNumber}:q${conflict.q}`;
        if (requestKeys && !requestKeys.has(key)) return;
        const cellUrl = cellUrlCache[key];
        if (typeof cellUrl !== 'string') return; // 未取得・取得中はプレースホルダのまま待つ
        const imageSlot = card.querySelector('.img-expired');
        if (!imageSlot) return;
        if (!cellUrl) {
            imageSlot.textContent = '';
            const icon = createIcon('clock');
            imageSlot.append(icon, ' 画像がありません');
            return;
        }
        const image = document.createElement('img');
        image.src = cellUrl;
        image.alt = `${conflict.displayName} ${conflict.q}問`;
        image.loading = 'lazy';
        image.decoding = 'async';
        attachConflictImageErrorFallback(image, conflict);
        imageSlot.replaceWith(image);
    });
}

async function ensureConflictCellUrls(missing) {
    if (!missing.length) return;

    const preloadKey = missing.map(request => request.key).sort().join('|');
    if (preloadKey === cellUrlPreloadKey) return;
    cellUrlPreloadKey = preloadKey;
    for (const request of missing) cellUrlCache[request.key] = null;

    try {
        const readyMissing = missing.filter(request => request.cellStatus === 'ready');
        const cellUrls = await CIQSupabaseAPI.getAnswerCellUrls(projectId, readyMissing.map(request => ({
            key: request.key,
            entryNumber: request.entryNumber,
            questionNumber: request.questionNumber,
            cellPath: request.cellPath,
        }))).catch(() => ({}));
        const fallbackRequests = missing.filter((request) => {
            const cellUrl = cellUrls[request.key] || '';
            if (cellUrl) {
                cellUrlCache[request.key] = cellUrl;
                return false;
            }
            return request.storagePath && request.cellRegion;
        });
        const pageUrls = await CIQSupabaseAPI.getAnswerPageUrls(projectId, fallbackRequests.map(request => ({
            key: request.key,
            storagePath: request.storagePath,
        }))).catch(() => ({}));
        await runLimited(fallbackRequests, CONFLICT_IMAGE_CROP_CONCURRENCY, async (request) => {
            const pageUrl = pageUrls[request.key];
            if (!pageUrl) {
                cellUrlCache[request.key] = '';
                return;
            }
            cellUrlCache[request.key] = await CIQSupabaseAPI.cropImageRegion(pageUrl, request.cellRegion, request.pageWidth);
        });
    } catch (_) {
        for (const request of missing) cellUrlCache[request.key] = '';
    }
    cellUrlPreloadKey = '';
}

function scheduleBackgroundConflictImages(conflicts, startIndex) {
    const token = ++conflictBackgroundPreloadToken;
    const candidates = getMissingConflictImageRequests(conflicts.slice(startIndex));
    if (!candidates.length) return;

    let offset = 0;
    const runNextBatch = async () => {
        if (token !== conflictBackgroundPreloadToken) return;
        const batch = candidates.slice(offset, offset + BACKGROUND_CONFLICT_IMAGE_BATCH);
        offset += BACKGROUND_CONFLICT_IMAGE_BATCH;
        if (!batch.length) return;

        await ensureConflictCellUrls(batch);
        // 背景取得でも必ずDOMへ反映する。ここを省くとキャッシュだけが埋まり、
        // 後から交差監視が発火しても queueConflictImage が「取得済み」で弾くため、
        // カードが「画像を読み込み中」のまま永久に残る。
        await preloadImageUrls(batch.map(request => cellUrlCache[request.key]));
        updateVisibleConflictImages(batch);
        if (offset < candidates.length) runWhenIdle(runNextBatch);
    };

    runWhenIdle(runNextBatch);
}

// question.js の mark() と同じ流れ: まず手元の状態を更新して即座に描画し、
// そのあと書き込む。失敗したら元に戻して知らせる。
// (以前は書き込み完了まで何も変わらず、そのうえ全件再取得していた)
function applyLocalFinalResult(q, entryId, result) {
    const questionNumber = Number(q);
    if (serverConflictRows) {
        const row = serverConflictRows.find(item => (
            Number(item.q) === questionNumber && item.entryId === entryId
        ));
        if (!row) return () => {};
        const previous = row.finalResult;
        row.finalResult = result;
        return () => { row.finalResult = previous; };
    }

    const index = finalResults.findIndex(item => (
        Number(item.question_number) === questionNumber && item.entry_id === entryId
    ));
    if (index >= 0) {
        const previous = finalResults[index];
        finalResults[index] = { ...previous, result };
        return () => { finalResults[index] = previous; };
    }
    finalResults.push({ question_number: questionNumber, entry_id: entryId, result });
    return () => {
        finalResults = finalResults.filter(item => !(
            Number(item.question_number) === questionNumber && item.entry_id === entryId
        ));
    };
}

async function setFinal(q, entryId, result) {
    const rollback = applyLocalFinalResult(q, entryId, result);
    await render();
    try {
        await CIQSupabaseAPI.resolveScoreConflict(projectId, q, entryId, result);
    } catch (error) {
        rollback();
        await render();
        throw error;
    }
    await refreshData();
}

function selectConflictCard(idx, options = {}) {
    if (idx < 0 || idx >= currentConflicts.length) return;
    selectedIndex = idx;
    updateConflictSelectionClasses();
    if (options.focus) document.querySelectorAll('.conflict-card')[selectedIndex]?.focus({ preventScroll: true });
    scrollToSelectedConflict();
}

function advanceConflictSelection() {
    if (selectedIndex < currentConflicts.length - 1) {
        selectConflictCard(selectedIndex + 1);
    }
}

function getConflictGridCols() {
    const grid = document.getElementById('conflict-grid');
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
}

function scrollToSelectedConflict() {
    const cards = document.querySelectorAll('.conflict-card');
    const card = cards[selectedIndex];
    if (!card) return;
    scrollElementIntoReviewViewport(card);
}

function scrollElementIntoReviewViewport(element) {
    const header = document.querySelector('.fixed-header');
    const topLimit = (header?.getBoundingClientRect().bottom || 0) + 16;
    const actionBar = document.getElementById('conflict-action-bar');
    const actionTop = actionBar && getComputedStyle(actionBar).display !== 'none'
        ? actionBar.getBoundingClientRect().top
        : window.innerHeight;
    const bottomLimit = Math.max(topLimit + 80, actionTop - 16);
    const rect = element.getBoundingClientRect();

    if (rect.bottom > bottomLimit) {
        window.scrollBy({ top: rect.bottom - bottomLimit, behavior: 'auto' });
    } else if (rect.top < topLimit) {
        window.scrollBy({ top: rect.top - topLimit, behavior: 'auto' });
    }
}

document.addEventListener('keydown', (e) => {
    if (currentConflicts.length === 0) return;
    const key = e.key;
    if (key === 'm' || key === 'M') {
        e.preventDefault();
        scoreSelectedConflict('correct');
    } else if (key === 'x' || key === 'X') {
        e.preventDefault();
        scoreSelectedConflict('wrong');
    } else if (key === 'ArrowRight') {
        e.preventDefault();
        selectConflictCard(selectedIndex + 1, { focus: true });
    } else if (key === 'ArrowLeft') {
        e.preventDefault();
        selectConflictCard(selectedIndex - 1, { focus: true });
    } else if (key === 'ArrowDown') {
        e.preventDefault();
        selectConflictCard(selectedIndex + getConflictGridCols(), { focus: true });
    } else if (key === 'ArrowUp') {
        e.preventDefault();
        selectConflictCard(selectedIndex - getConflictGridCols(), { focus: true });
    }
});

document.getElementById('conflict-correct-btn')?.addEventListener('click', () => scoreSelectedConflict('correct'));
document.getElementById('conflict-wrong-btn')?.addEventListener('click', () => scoreSelectedConflict('wrong'));

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopConflictRefreshTimer();
        return;
    }
    refreshData().catch(err => showToast(err.message, 'error'));
    startConflictRefreshTimer();
});

document.getElementById('conflict-back-btn')?.addEventListener('click', () => {
    navigateBack(opsBackTarget());
});

init();

window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    selectedIndex = 0;
    shouldResetConflictSelection = true;
    refreshData();
});
