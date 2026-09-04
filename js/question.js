// question.js - 採点画面（Supabase）

const auth = requireAuth();
const { projectId } = auth || {};
if (!auth) throw new Error('auth');

const currentQ = parseInt(localStorage.getItem('current_q') || '1', 10);
let currentMemberId = '';
let answerCards = [];
let myScores = {};
let selectedIndex = 0;
let isCompleted = false;
let pendingWrites = {};
let fallbackImageObserver = null;
let fallbackImageFlushTimer = null;
const fallbackImageQueue = new Map();
const IMAGE_CROP_CONCURRENCY = 12;
const BACKGROUND_PREWARM_BATCH = 24;
let backgroundPrewarmToken = 0;
let lastRenderMetrics = null;
let totalQuestions = 100;
let requiredScorers = 3;
let hasSetInitialSelection = false;

document.getElementById('q-badge').textContent = `${currentQ}問`;

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
    try {
        console.info(`[CIQ perf json] ${label} ${JSON.stringify(details)}`);
    } catch (_) {
        // Keep profiling non-blocking if a browser cannot serialize a field.
    }
}

function roundMs(value) {
    return Math.round(Number(value || 0));
}

function runWhenIdle(task, timeout = 2500) {
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(task, { timeout });
    } else {
        setTimeout(task, 250);
    }
}

function isQuestionFullError(error) {
    const message = error?.message || String(error || '');
    return message.includes('満員') || message.includes('Question is full');
}

async function navigateToNextScoringQuestion(options = {}) {
    const next = await CIQSupabaseAPI.getNextScoringQuestion(projectId, {
        totalQuestions,
        requiredScorers,
        currentMemberId,
        excludeQuestionNumber: options.excludeCurrent ? currentQ : 0,
    }).catch(error => {
        console.warn('次の採点問題の取得に失敗:', error);
        return null;
    });
    if (next?.questionNumber > 0) {
        if (options.notice) showToast(options.notice, 'info');
        localStorage.setItem('current_q', String(next.questionNumber));
        location.href = 'question.html';
        return true;
    }
    location.href = 'judge.html';
    return false;
}

// 模範解答の表示。別解は主答えの後ろに続けて出す。
// 採点は M/X/H のキーボード操作が主なので、hover や click で隠すと
// 「判断に迷った瞬間」に一番重い操作を要求することになる。常時見せる。
function renderModelAnswer(model) {
    const answer = model?.answer || '';
    const alts = Array.isArray(model?.altAnswers) ? model.altAnswers : [];

    document.getElementById('answer-badge').textContent = answer || '未設定';

    const altsEl = document.getElementById('answer-alts');
    if (!altsEl) return;
    altsEl.textContent = '';
    if (!alts.length) {
        altsEl.hidden = true;
        return;
    }
    // 「別解」というラベルは置かない。主答えとの差はサイズと濃度で示す。
    // 区切りは項目と同じ要素に入れる。別要素にすると折り返しで行末に「/」だけが残る。
    alts.forEach((alt, index) => {
        const item = document.createElement('span');
        item.className = 'answer-alt';
        item.textContent = index === 0 ? alt : `/ ${alt}`;
        altsEl.appendChild(item);
    });
    altsEl.hidden = false;
}

function preloadImageUrl(url) {
    if (!url) return Promise.resolve(false);
    return new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
            if (image.decode) {
                image.decode().then(() => resolve(true)).catch(() => resolve(false));
                return;
            }
            resolve(true);
        };
        image.onerror = () => resolve(false);
        image.src = url;
    });
}

async function preloadImageUrls(urls, limit = IMAGE_CROP_CONCURRENCY) {
    const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
    if (!uniqueUrls.length) return { requested: 0, decoded: 0, failed: 0 };
    const results = await runLimited(uniqueUrls, limit, preloadImageUrl);
    const decoded = results.filter(Boolean).length;
    return {
        requested: uniqueUrls.length,
        decoded,
        failed: uniqueUrls.length - decoded,
    };
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function getGridColumnCount(grid) {
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, columns || 1);
}

function getMedianCellAspect(cards) {
    const aspects = cards
        .map(card => {
            const width = Number(card.cellRegion?.w || 0);
            const height = Number(card.cellRegion?.h || 0);
            return width > 0 && height > 0 ? height / width : 0;
        })
        .filter(Boolean)
        .sort((a, b) => a - b);
    if (!aspects.length) return 0.62;
    return aspects[Math.floor(aspects.length / 2)];
}

function getInitialImageLimit(cards) {
    const grid = document.getElementById('answer-grid');
    const style = getComputedStyle(grid);
    const columns = getGridColumnCount(grid);
    const columnGap = Number.parseFloat(style.columnGap || style.gap || '0') || 0;
    const inlinePadding = (Number.parseFloat(style.paddingLeft || '0') || 0) + (Number.parseFloat(style.paddingRight || '0') || 0);
    const gridWidth = Math.max(1, grid.clientWidth || window.innerWidth);
    const cardWidth = Math.max(1, (gridWidth - inlinePadding - columnGap * (columns - 1)) / columns);
    const estimatedRowHeight = Math.max(72, cardWidth * getMedianCellAspect(cards) + 28);
    const gridTop = Math.max(0, grid.getBoundingClientRect().top);
    const visibleHeight = Math.max(estimatedRowHeight, window.innerHeight - gridTop);
    const rows = Math.max(1, Math.ceil(visibleHeight / estimatedRowHeight) + 1);
    return Math.min(cards.length, columns * rows);
}

function setAnswerGridMessage(message, iconClass = '') {
    const grid = document.getElementById('answer-grid');
    grid.textContent = '';
    const messageEl = document.createElement('div');
    messageEl.className = 'loading-state grid-message';
    if (iconClass) {
        const icon = createIcon(iconClass);
        messageEl.append(icon, ' ');
    }
    messageEl.appendChild(document.createTextNode(message));
    grid.appendChild(messageEl);
}

function updateAnswerCardClass(card, result, isSelected) {
    card.className = `answer-card ${result === 'correct' ? 'correct' : result === 'wrong' ? 'wrong' : result === 'hold' ? 'hold' : ''} ${isSelected ? 'selected' : ''}`;
    card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    card.tabIndex = isSelected ? 0 : -1;
}

function setInitialSelectionToFirstUnscored() {
    if (hasSetInitialSelection || !answerCards.length) return;
    const firstUnscoredIndex = answerCards.findIndex(card => myScores[card.entryId] === null);
    selectedIndex = firstUnscoredIndex >= 0 ? firstUnscoredIndex : 0;
    hasSetInitialSelection = true;
}

function keepSelectedVisibleDuringInitialLayout() {
    scrollToSelected({ center: true });
    requestAnimationFrame(() => {
        scrollToSelected({ center: true });
        requestAnimationFrame(() => scrollToSelected({ center: true }));
    });
    setTimeout(() => scrollToSelected({ center: true }), 120);
    setTimeout(() => scrollToSelected({ center: true }), 420);
    setTimeout(() => scrollToSelected({ center: true }), 900);
}

function createAnswerCard(cardData, idx) {
    const myScore = myScores[cardData.entryId];
    const card = document.createElement('div');
    updateAnswerCardClass(card, myScore, idx === selectedIndex);
    card.setAttribute('role', 'gridcell');
    card.setAttribute('aria-label', `${cardData.displayName} の答案`);
    if (cardData.cellUrl || (cardData.pageUrl && cardData.cellRegion) || (cardData.storagePath && cardData.cellRegion)) {
        const image = document.createElement('img');
        image.alt = cardData.displayName;
        image.loading = idx < 16 ? 'eager' : 'lazy';
        image.decoding = 'async';
        if (idx < 16) image.fetchPriority = 'high';
        if (cardData.cellUrl) {
            image.src = cardData.cellUrl;
            attachAnswerImageErrorFallback(image, cardData, card);
        } else {
            image.classList.add('is-loading');
            image.dataset.fallbackPending = 'true';
        }
        card.appendChild(image);
        if (!cardData.cellUrl) observeFallbackImage(card, image, cardData);
    } else {
        const expired = document.createElement('div');
        expired.className = 'img-expired';
        const icon = createIcon('clock');
        expired.append(icon, ' 画像がありません');
        card.appendChild(expired);
    }

    const entryNum = document.createElement('div');
    entryNum.className = 'entry-num';
    entryNum.textContent = cardData.displayName;
    card.appendChild(entryNum);
    card.addEventListener('click', () => selectCard(idx, { focus: true }));
    card.addEventListener('focus', () => selectCard(idx));
    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectCard(idx, { focus: true });
    });
    card.addEventListener('dblclick', () => showPreview(projectId, null, cardData.entryNumber));
    return card;
}

function attachAnswerImageErrorFallback(image, cardData, card) {
    image.addEventListener('error', () => {
        if (image.dataset.fallbackPending) return;
        if (cardData.cellUrlSource === 'answer-cell') {
            CIQSupabaseAPI.markAnswerCellFailed(projectId, cardData.entryId, currentQ);
        }
        cardData.cellUrl = null;
        cardData.cellUrlSource = '';
        image.removeAttribute('src');
        image.classList.add('is-loading');
        image.dataset.fallbackPending = 'true';
        queueFallbackImage(image, cardData, card);
    }, { once: true });
}

function observeFallbackImage(card, image, cardData) {
    if (!fallbackImageObserver && 'IntersectionObserver' in window) {
        fallbackImageObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                fallbackImageObserver.unobserve(entry.target);
                const target = entry.target;
                queueFallbackImage(target._ciqImage, target._ciqCardData, target);
            });
        }, { rootMargin: '240px 0px' });
    }
    card._ciqImage = image;
    card._ciqCardData = cardData;
    if (fallbackImageObserver) {
        fallbackImageObserver.observe(card);
    } else {
        queueFallbackImage(image, cardData, card);
    }
}

function queueFallbackImage(image, cardData, card) {
    if (!image || image.dataset.fallbackPending !== 'true') return;
    fallbackImageQueue.set(String(cardData.entryId), { image, cardData, card });
    if (fallbackImageFlushTimer) return;
    fallbackImageFlushTimer = setTimeout(flushFallbackImages, 40);
}

async function flushFallbackImages() {
    fallbackImageFlushTimer = null;
    const batch = Array.from(fallbackImageQueue.values());
    fallbackImageQueue.clear();
    if (!batch.length) return;

    const readyBatch = batch.filter(item => item.cardData.cellStatus === 'ready');
    const cellUrls = await CIQSupabaseAPI.getAnswerCellUrls(projectId, readyBatch.map(item => ({
        key: String(item.cardData.entryId),
        entryNumber: item.cardData.entryNumber,
        questionNumber: currentQ,
        cellPath: item.cardData.cellPath,
    }))).catch(() => ({}));
    const directResults = [];
    const cropBatch = [];
    batch.forEach((item) => {
        const cellUrl = cellUrls[String(item.cardData.entryId)] || '';
        if (cellUrl) {
            item.image.dataset.fallbackPending = 'loading';
            item.cardData.cellUrl = cellUrl;
            item.cardData.cellUrlSource = 'answer-cell';
            directResults.push({ image: item.image, card: item.card, cardData: item.cardData, cellUrl, source: 'answer-cell' });
            return;
        }
        cropBatch.push(item);
    });

    const needsPageUrl = cropBatch
        .filter(item => !item.cardData.pageUrl && item.cardData.storagePath)
        .map(item => ({
            key: String(item.cardData.entryId),
            storagePath: item.cardData.storagePath,
        }));
    const pageUrls = await CIQSupabaseAPI.getAnswerPageUrls(projectId, needsPageUrl).catch(() => ({}));
    cropBatch.forEach((item) => {
        item.cardData.pageUrl = item.cardData.pageUrl || pageUrls[String(item.cardData.entryId)] || '';
    });
    const cropResults = await runLimited(cropBatch, IMAGE_CROP_CONCURRENCY, ({ image, cardData, card }) => resolveFallbackImage(image, cardData, card));
    const results = [...directResults, ...cropResults];
    await preloadImageUrls(results.map(result => result.cellUrl));
    await nextFrame();
    await Promise.all(results.map(applyFallbackImageResult));
}

async function resolveFallbackImage(image, cardData, card) {
    if (!image || image.dataset.fallbackPending !== 'true') return { image, card, cellUrl: '' };
    image.dataset.fallbackPending = 'loading';
    try {
        let pageUrl = cardData.pageUrl || '';
        if (!pageUrl) {
            const pageUrls = await CIQSupabaseAPI.getAnswerPageUrls(projectId, [{
                key: String(cardData.entryId),
                storagePath: cardData.storagePath,
            }]);
            pageUrl = pageUrls[String(cardData.entryId)];
        }
        if (!pageUrl) throw new Error('Missing page URL');
        const cellUrl = await CIQSupabaseAPI.cropImageRegion(pageUrl, cardData.cellRegion, cardData.pageWidth);
        cardData.cellUrlSource = 'crop';
        return { image, card, cardData, cellUrl, source: 'crop' };
    } catch (_) {
        return { image, card, cardData, cellUrl: '' };
    }
}

async function applyFallbackImageResult(result) {
    const { image, card, cardData, cellUrl, source } = result || {};
    if (!image || !card || image.dataset.fallbackPending !== 'loading') return;
    if (cellUrl) {
        if (cardData) {
            cardData.cellUrl = cellUrl;
            cardData.cellUrlSource = source || cardData.cellUrlSource || '';
        }
        if (source === 'answer-cell' && cardData) attachAnswerImageErrorFallback(image, cardData, card);
        image.src = cellUrl;
        image.classList.remove('is-loading');
        delete image.dataset.fallbackPending;
        return;
    }
    image.remove();
    const expired = document.createElement('div');
    expired.className = 'img-expired';
    const icon = createIcon('clock');
    expired.append(icon, ' 画像がありません');
    card.prepend(expired);
}

async function prewarmInitialImages(cards, limit) {
    const metrics = {
        requested: 0,
        readyCandidates: 0,
        answerCellHits: 0,
        answerCellMisses: 0,
        cropCandidates: 0,
        cropSuccesses: 0,
        cropFailures: 0,
        pageUrlRequests: 0,
        pageUrlHits: 0,
        decodedImages: 0,
        decodeFailures: 0,
        decodeSkipped: 0,
        answerCellUrlMs: 0,
        pageUrlMs: 0,
        cropMs: 0,
        decodeMs: 0,
    };
    const targets = cards
        .slice(0, limit)
        .filter(card => !card.cellUrl && card.storagePath && card.cellRegion);
    metrics.requested = targets.length;
    const readyTargets = targets.filter(card => card.cellStatus === 'ready');
    metrics.readyCandidates = readyTargets.length;
    let stepStartedAt = performance.now();
    const cellUrls = await CIQSupabaseAPI.getAnswerCellUrls(projectId, readyTargets.map(card => ({
        key: String(card.entryId),
        entryNumber: card.entryNumber,
        questionNumber: currentQ,
        cellPath: card.cellPath,
    }))).catch(() => ({}));
    metrics.answerCellUrlMs = roundMs(performance.now() - stepStartedAt);
    const cropTargets = [];
    for (const card of targets) {
        const cellUrl = cellUrls[String(card.entryId)] || '';
        if (cellUrl) {
            card.cellUrl = cellUrl;
            card.cellUrlSource = 'answer-cell';
            metrics.answerCellHits++;
        } else {
            cropTargets.push(card);
            if (card.cellStatus === 'ready') metrics.answerCellMisses++;
        }
    }
    metrics.cropCandidates = cropTargets.length;
    metrics.pageUrlRequests = cropTargets.filter(card => card.storagePath).length;
    stepStartedAt = performance.now();
    const pageUrls = await CIQSupabaseAPI.getAnswerPageUrls(projectId, cropTargets.map(card => ({
        key: String(card.entryId),
        storagePath: card.storagePath,
    }))).catch(() => ({}));
    metrics.pageUrlMs = roundMs(performance.now() - stepStartedAt);
    metrics.pageUrlHits = Object.keys(pageUrls).length;
    stepStartedAt = performance.now();
    await runLimited(cropTargets, IMAGE_CROP_CONCURRENCY, async (card) => {
        try {
            card.pageUrl = pageUrls[String(card.entryId)] || card.pageUrl || '';
            if (!card.pageUrl) throw new Error('Missing page URL');
            card.cellUrl = await CIQSupabaseAPI.cropImageRegion(card.pageUrl, card.cellRegion, card.pageWidth);
            card.cellUrlSource = 'crop';
            metrics.cropSuccesses++;
        } catch (_) {
            card.cellUrl = null;
            metrics.cropFailures++;
        }
    });
    metrics.cropMs = roundMs(performance.now() - stepStartedAt);
    metrics.decodedImages = 0;
    metrics.decodeFailures = 0;
    metrics.decodeSkipped = targets.filter(card => card.cellUrl).length;
    return metrics;
}

function scheduleBackgroundImagePrewarm(cards, startIndex) {
    const token = ++backgroundPrewarmToken;
    const candidates = cards
        .slice(startIndex)
        .filter(card => !card.cellUrl && card.storagePath && card.cellRegion);
    if (!candidates.length) return;

    let offset = 0;
    const runNextBatch = async () => {
        if (token !== backgroundPrewarmToken) return;
        const batch = candidates.slice(offset, offset + BACKGROUND_PREWARM_BATCH);
        offset += BACKGROUND_PREWARM_BATCH;
        if (!batch.length) return;

        const readyBatch = batch.filter(card => card.cellStatus === 'ready');
        const cellUrls = await CIQSupabaseAPI.getAnswerCellUrls(projectId, readyBatch.map(card => ({
            key: String(card.entryId),
            entryNumber: card.entryNumber,
            questionNumber: currentQ,
            cellPath: card.cellPath,
        }))).catch(() => ({}));
        const cropBatch = [];
        for (const card of batch) {
            const cellUrl = cellUrls[String(card.entryId)] || '';
            if (cellUrl) {
                card.cellUrl = cellUrl;
                card.cellUrlSource = 'answer-cell';
            } else {
                cropBatch.push(card);
            }
        }

        const pageUrls = await CIQSupabaseAPI.getAnswerPageUrls(projectId, cropBatch.map(card => ({
            key: String(card.entryId),
            storagePath: card.storagePath,
        }))).catch(() => ({}));

        await runLimited(cropBatch, IMAGE_CROP_CONCURRENCY, async (card) => {
            try {
                card.pageUrl = pageUrls[String(card.entryId)] || card.pageUrl || '';
                if (!card.pageUrl) throw new Error('Missing page URL');
                card.cellUrl = await CIQSupabaseAPI.cropImageRegion(card.pageUrl, card.cellRegion, card.pageWidth);
                card.cellUrlSource = 'crop';
            } catch (_) {
                card.cellUrl = null;
            }
        });

        if (offset < candidates.length) runWhenIdle(runNextBatch);
    };

    runWhenIdle(runNextBatch);
}

async function init() {
    try {
        const startedAt = performance.now();
        let stepStartedAt = performance.now();
        const projectPromise = CIQSupabaseAPI.getProject(projectId).catch(() => null);
        const joined = await CIQSupabaseAPI.joinQuestionScorer(projectId, currentQ);
        const joinMs = roundMs(performance.now() - stepStartedAt);
        currentMemberId = joined.scorer_member_id;
        isCompleted = Boolean(joined.completed_at);
        const project = await projectPromise;
        totalQuestions = Number(project?.question_count || totalQuestions);
        requiredScorers = Number(project?.required_scorers || requiredScorers);

        const answerTextPromise = (async () => {
            const started = performance.now();
            const value = await CIQSupabaseAPI.getModelAnswer(projectId, currentQ);
            return { value, ms: roundMs(performance.now() - started) };
        })();
        const cardsPromise = (async () => {
            const started = performance.now();
            const value = await CIQSupabaseAPI.getQuestionAnswerCards(projectId, currentQ);
            return { value, ms: roundMs(performance.now() - started) };
        })();
        const [answerResult, cardsResult] = await Promise.all([answerTextPromise, cardsPromise]);
        const modelAnswer = answerResult.value;
        const cards = cardsResult.value;
        const dataMs = Math.max(answerResult.ms, cardsResult.ms);

        renderModelAnswer(modelAnswer);
        answerCards = cards;
        CIQSupabaseAPI.enqueueAnswerCellGeneration(projectId, answerCards.map(card => ({
            ...card,
            questionNumber: currentQ,
        })));

        if (answerCards.length === 0) {
            setAnswerGridMessage('答案データがありません', 'inbox');
            return;
        }

        const imageStatsBefore = CIQSupabaseAPI.takeImagePerfStats();
        const prewarmStartedAt = performance.now();
        const initialImageLimit = getInitialImageLimit(answerCards);
        const initialImageMetrics = await prewarmInitialImages(answerCards, initialImageLimit);
        const prewarmMs = roundMs(performance.now() - prewarmStartedAt);
        const initialImageStats = CIQSupabaseAPI.takeImagePerfStats(imageStatsBefore);
        stepStartedAt = performance.now();
        await refreshVotes();
        const votesAndRenderMs = roundMs(performance.now() - stepStartedAt);
        scheduleBackgroundImagePrewarm(answerCards, initialImageLimit);
        logPerf('questionInitialProfile', {
            questionNumber: currentQ,
            cards: answerCards.length,
            initialImageLimit,
            timings: {
                joinMs,
                modelAnswerRpcMs: answerResult.ms,
                cardsRpcMs: cardsResult.ms,
                dataMs,
                answerCellUrlMs: initialImageMetrics.answerCellUrlMs,
                pageUrlMs: initialImageMetrics.pageUrlMs,
                cropMs: initialImageMetrics.cropMs,
                decodeMs: initialImageMetrics.decodeMs,
                initialImageMs: prewarmMs,
                votesAndRenderMs,
                domRenderMs: lastRenderMetrics?.renderMs || 0,
                totalMs: roundMs(performance.now() - startedAt),
            },
            imageCounts: {
                requested: initialImageMetrics.requested,
                readyCandidates: initialImageMetrics.readyCandidates,
                answerCellHits: initialImageMetrics.answerCellHits,
                answerCellMisses: initialImageMetrics.answerCellMisses,
                cropCandidates: initialImageMetrics.cropCandidates,
                cropSuccesses: initialImageMetrics.cropSuccesses,
                cropFailures: initialImageMetrics.cropFailures,
                pageUrlRequests: initialImageMetrics.pageUrlRequests,
                pageUrlHits: initialImageMetrics.pageUrlHits,
                decodedImages: initialImageMetrics.decodedImages,
                decodeFailures: initialImageMetrics.decodeFailures,
                decodeSkipped: initialImageMetrics.decodeSkipped,
            },
            render: lastRenderMetrics,
            imageStats: initialImageStats,
        });
        logPerf('questionInitialLoad', {
            questionNumber: currentQ,
            cards: answerCards.length,
            initialImageLimit,
            dataMs,
            initialImageMs: prewarmMs,
            imageStats: initialImageStats,
            totalMs: roundMs(performance.now() - startedAt),
        });
    } catch (e) {
        if (isQuestionFullError(e)) {
            await navigateToNextScoringQuestion({
                excludeCurrent: true,
                notice: 'この問題は満員になりました。次に入れる問題へ移動します。',
            });
            return;
        }
        setAnswerGridMessage(e.message || '採点データを読み込めませんでした', 'triangle-exclamation');
    }
}

async function refreshVotes() {
    const votes = await CIQSupabaseAPI.listMyQuestionScoreVotes(projectId, currentQ, currentMemberId);
    const myVoteByEntry = new Map();
    for (const vote of votes) {
        myVoteByEntry.set(vote.entry_id, vote);
    }
    const nextScores = {};
    for (const card of answerCards) {
        if (pendingWrites[card.entryId] !== undefined) {
            nextScores[card.entryId] = pendingWrites[card.entryId];
            continue;
        }
        const vote = myVoteByEntry.get(card.entryId);
        nextScores[card.entryId] = vote?.result || null;
    }
    for (const [entryId, result] of Object.entries(pendingWrites)) {
        const serverVote = myVoteByEntry.get(entryId);
        if (serverVote?.result === result) delete pendingWrites[entryId];
    }
    myScores = nextScores;
    setInitialSelectionToFirstUnscored();
    renderGrid();
    checkAutoCompletion();
}

function renderGrid() {
    const renderStartedAt = performance.now();
    const grid = document.getElementById('answer-grid');
    if (selectedIndex >= answerCards.length) selectedIndex = Math.max(0, answerCards.length - 1);

    const total = answerCards.length;
    let done = 0;
    for (const card of answerCards) {
        if (myScores[card.entryId] !== null) done++;
    }
    updateProgressText(done, total);

    let createdCards = false;
    if (grid.children.length === answerCards.length && grid.children[0]?.className?.includes('answer-card')) {
        answerCards.forEach((cardData, idx) => {
            const myScore = myScores[cardData.entryId];
            const card = grid.children[idx];
            updateAnswerCardClass(card, myScore, idx === selectedIndex);
        });
    } else {
        createdCards = true;
        grid.textContent = '';
        const fragment = document.createDocumentFragment();
        answerCards.forEach((cardData, idx) => {
            fragment.appendChild(createAnswerCard(cardData, idx));
        });
        grid.appendChild(fragment);
    }

    if (createdCards) keepSelectedVisibleDuringInitialLayout();
    lastRenderMetrics = {
        renderMs: roundMs(performance.now() - renderStartedAt),
        createdCards,
        cardCount: answerCards.length,
        domChildren: grid.children.length,
    };
}

function updateProgressText(done, total) {
    const progress = document.getElementById('progress-text');
    if (!progress) return;
    progress.textContent = `${done} / ${total} 件`;
    progress.className = `counter ${total > 0 && done === total ? 'all-clear' : 'has-conflicts'}`;
}

async function mark(entryId, result) {
    pendingWrites[entryId] = result;
    myScores[entryId] = result;
    renderGrid();
    try {
        await CIQSupabaseAPI.setScoreVote(projectId, currentQ, entryId, result);
        if (pendingWrites[entryId] === result) delete pendingWrites[entryId];
        myScores[entryId] = result;
        renderGrid();
        await checkAutoCompletion();
    } catch (e) {
        delete pendingWrites[entryId];
        showToast('採点の保存に失敗しました: ' + e.message, 'error');
        await refreshVotes();
    }
}

function selectCard(idx, options = {}) {
    if (idx < 0 || idx >= answerCards.length) return;
    selectedIndex = idx;
    const cards = document.querySelectorAll('.answer-card');
    cards.forEach((card, i) => {
        const selected = i === selectedIndex;
        card.classList.toggle('selected', selected);
        card.setAttribute('aria-selected', selected ? 'true' : 'false');
        card.tabIndex = selected ? 0 : -1;
    });
    if (options.focus) cards[selectedIndex]?.focus({ preventScroll: true });
    scrollToSelected();
}

function advanceSelection() {
    if (selectedIndex < answerCards.length - 1) selectCard(selectedIndex + 1);
}

function getGridCols() {
    const grid = document.getElementById('answer-grid');
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
}

function scrollToSelected(options = {}) {
    const cards = document.querySelectorAll('.answer-card');
    const card = cards[selectedIndex];
    if (!card) return;
    scrollElementIntoScoringViewport(card, options);
}

function scrollElementIntoScoringViewport(element, options = {}) {
    const header = document.querySelector('.fixed-header');
    const topLimit = (header?.getBoundingClientRect().bottom || 0) + 16;
    const fixedBottomElements = Array.from(document.querySelectorAll('.action-bar, .kbd-hint'))
        .filter(el => {
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
    const fixedTop = fixedBottomElements.reduce((min, el) => {
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0) return min;
        return Math.min(min, rect.top);
    }, window.innerHeight);
    const bottomLimit = Math.max(topLimit + 80, fixedTop - 16);
    const rect = element.getBoundingClientRect();

    if (options.center) {
        const availableHeight = Math.max(120, bottomLimit - topLimit);
        const desiredTop = topLimit + Math.max(0, (availableHeight - rect.height) / 2);
        window.scrollBy({ top: rect.top - desiredTop, behavior: 'auto' });
    } else if (rect.bottom > bottomLimit) {
        window.scrollBy({ top: rect.bottom - bottomLimit, behavior: 'auto' });
    } else if (rect.top < topLimit) {
        window.scrollBy({ top: rect.top - topLimit, behavior: 'auto' });
    }
}

function scoreSelected(status) {
    if (answerCards.length === 0) return;
    const cardData = answerCards[selectedIndex];
    if (!cardData) return;
    const cards = document.querySelectorAll('.answer-card');
    const card = cards[selectedIndex];
    if (card) {
        card.classList.add('score-pop');
        setTimeout(() => card.classList.remove('score-pop'), 150);
    }
    mark(cardData.entryId, status);
    advanceSelection();
}

document.getElementById('question-back-btn')?.addEventListener('click', () => {
    navigateBack('judge.html');
});
document.getElementById('score-correct-btn')?.addEventListener('click', () => scoreSelected('correct'));
document.getElementById('score-wrong-btn')?.addEventListener('click', () => scoreSelected('wrong'));
document.getElementById('score-hold-btn')?.addEventListener('click', () => scoreSelected('hold'));

document.addEventListener('keydown', (e) => {
    if (answerCards.length === 0) return;
    const key = e.key;
    if (key === 'm' || key === 'M') {
        e.preventDefault();
        const cardData = answerCards[selectedIndex];
        if (cardData) {
            mark(cardData.entryId, 'correct');
            advanceSelection();
        }
    } else if (key === 'x' || key === 'X') {
        e.preventDefault();
        const cardData = answerCards[selectedIndex];
        if (cardData) {
            mark(cardData.entryId, 'wrong');
            advanceSelection();
        }
    } else if (key === 'h' || key === 'H') {
        e.preventDefault();
        const cardData = answerCards[selectedIndex];
        if (cardData) {
            mark(cardData.entryId, 'hold');
            advanceSelection();
        }
    } else if (key === 'ArrowRight') {
        e.preventDefault();
        selectCard(selectedIndex + 1, { focus: true });
    } else if (key === 'ArrowLeft') {
        e.preventDefault();
        selectCard(selectedIndex - 1, { focus: true });
    } else if (key === 'ArrowDown') {
        e.preventDefault();
        selectCard(selectedIndex + getGridCols(), { focus: true });
    } else if (key === 'ArrowUp') {
        e.preventDefault();
        selectCard(selectedIndex - getGridCols(), { focus: true });
    }
});

async function checkAutoCompletion() {
    const total = answerCards.length;
    const done = answerCards.filter(card => myScores[card.entryId] !== null).length;
    updateProgressText(done, total);
    if (done === total && total > 0 && !isCompleted) {
        isCompleted = true;
        await CIQSupabaseAPI.completeQuestionScoring(projectId, currentQ);
        await navigateToNextScoringQuestion({ excludeCurrent: true });
    }
}

init();
