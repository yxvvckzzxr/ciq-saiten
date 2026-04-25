// admin_scan.js — 答案一覧管理 + 模範解答グリッド
        // 答案一覧
        let entryListData = [];
        async function loadEntryList() {
            const el = document.getElementById('entry-list');
            el.innerHTML = '<div class="text-muted-loader">読み込み中...</div>';
            try {
                const data = await dbShallow(`projects/${projectId}/protected/${secretHash}/answers`);
                entryListData = data ? Object.keys(data).map(Number).sort((a, b) => a - b) : [];
            } catch (e) {
                console.error('答案リスト読み込みエラー:', e);
                entryListData = [];
            }
            entryNumbers = [...entryListData]; // 全体のentryNumbersも更新
            let masterData = getMasterData(projectId);

            // カウントバッジ更新
            document.getElementById('entry-count-badge').textContent = `${entryListData.length}件`;

            if (entryListData.length === 0) {
                el.innerHTML = '<div class="text-muted-center"><i class="fa-solid fa-box-open icon-empty"></i>保存済み答案はありません</div>';
                document.getElementById('select-all-label').hidden = true;
                document.getElementById('batch-delete-btn').hidden = true;
                return;
            }

            // コントロール表示
            document.getElementById('select-all-label').hidden = false;
            document.getElementById('batch-delete-btn').hidden = false;

            el.innerHTML = '';
            const grid = document.createElement('div');
            grid.className = 'entry-list-grid';
            entryListData.forEach(num => {
                const md = masterData[num] || {};
                const displayName = md.name || `No.${padNum(num)}`;
                const subText = md.affiliation || '';
                const card = document.createElement('div');
                card.className = 'entry-card';
                card.innerHTML = `
                    <label class="custom-checkbox scan-cb-wrap">
                        <input type="checkbox" class="entry-cb" data-num="${num}" />
                        <span class="checkbox-mark"><svg class="checkbox-svg" viewBox="0 0 16 16"><path d="M3 8.5L6.5 12L13 4"></path></svg></span>
                    </label>
                    <div class="entry-info">
                        <div class="entry-name">${displayName}</div>
                        ${subText ? `<div class="entry-sub">${subText}</div>` : ''}
                    </div>
                    <span class="entry-num-badge">#${padNum(num)}</span>
                `;
                // チェック時のカードハイライト
                        const cb = card.querySelector('.entry-cb');
                cb.addEventListener('change', () => {
                    card.classList.toggle('selected', cb.checked);
                    updateBatchBtn();
                });
                // ダブルクリックでページプレビュー
                card.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.scan-cb')) return; // チェックボックスは除外
                    showEntryPreview(num);
                });
                grid.appendChild(card);
            });
            el.appendChild(grid);
            document.getElementById('batch-delete-btn').disabled = true;
            document.getElementById('select-all-cb').checked = false;
        }

        function updateBatchBtn() {
            const checked = document.querySelectorAll('.entry-cb:checked').length;
            document.getElementById('batch-delete-btn').disabled = checked === 0;
        }
        function toggleSelectAll() {
            const all = document.getElementById('select-all-cb').checked;
            document.querySelectorAll('.entry-cb').forEach(cb => {
                cb.checked = all;
                cb.closest('.entry-card')?.classList.toggle('selected', all);
            });
            updateBatchBtn();
        }
        async function deleteEntry(num, e) {
            e?.stopPropagation();
            if (!(await showConfirm(`受付番号 ${num} の答案を削除しますか？`))) return;
            await dbRemove(`projects/${projectId}/protected/${secretHash}/answers/${num}`);
            await dbRemove(`projects/${projectId}/protected/${secretHash}/scores/${num}`);
            loadEntryList();
        }
        async function batchDelete() {
            const checked = [...document.querySelectorAll('.entry-cb:checked')].map(cb => cb.dataset.num);
            if (!checked.length) return;
            if (!(await showConfirm(`${checked.length}件の答案を一括削除しますか？`))) return;
            // 全エントリーを並列削除
            await Promise.all(checked.map(async num => {
                await Promise.all([
                    dbRemove(`projects/${projectId}/protected/${secretHash}/answers/${num}`),
                    dbRemove(`projects/${projectId}/protected/${secretHash}/scores/${num}`)
                ]);
            }));
            loadEntryList();
        }

        async function showEntryPreview(num) {
            let overlay = document.getElementById('admin-preview-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'admin-preview-overlay';
                overlay.className = 'preview-overlay';
                document.body.appendChild(overlay);
            }
            const masterData = getMasterData(projectId);
            const name = masterData[num]?.name || `No.${padNum(num)}`;
            overlay.innerHTML = `<div class="preview-overlay-header"><h2 class="preview-overlay-title"><i class="fa-solid fa-file-image"></i> ${escapeHtml(name)} の解答用紙</h2><button class="btn secondary" onclick="document.getElementById('admin-preview-overlay').style.display='none'">✕ 閉じる</button></div><div id="admin-preview-content" class="preview-overlay-content"><div class="text-muted-loader"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div></div>`;
            overlay.style.display = 'block';
            const pc = document.getElementById('admin-preview-content');
            const imageUrl = await dbGet(`projects/${projectId}/protected/${secretHash}/answerImages/${num}`);
            if (imageUrl) {
                pc.innerHTML = `<img src="${imageUrl}" alt="${name}" class="preview-image">`;
            } else {
                pc.innerHTML = '<div class="text-muted-center">ページ画像が保存されていません。答案を再読み込みしてください。</div>';
            }
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') { const o = document.getElementById('admin-preview-overlay'); if (o) o.style.display = 'none'; }});

        // ============================
        // TAB 3: 模範解答
        // ============================
        let dragSrcIdx = null;
        function renderModelGrid() {
            const grid = document.getElementById('model-answer-grid'); grid.innerHTML = '';
            modelAnswers.forEach((ans, i) => {
                const item = document.createElement('div'); item.className = 'model-cell';
                item.style.cursor = 'grab';
                item.draggable = true;
                item.dataset.idx = i;
                item.innerHTML = `<div class="q-label"><i class="fa-solid fa-hashtag"></i>${i + 1}</div><div class="q-answer${ans ? '' : ' model-answer-empty'}">${ans || '—'}</div>`;

                // ドラッグ開始
                item.addEventListener('dragstart', e => {
                    dragSrcIdx = i;
                    e.dataTransfer.effectAllowed = 'move';
                    setTimeout(() => item.classList.add('dragging'), 0);
                });
                item.addEventListener('dragend', async () => { 
                    item.classList.remove('dragging');
                    item.style.borderColor = '';
                    
                    // Rebuild array from current DOM order to persist changes
                    const newAnswers = [];
                    grid.querySelectorAll('.model-cell').forEach(cell => {
                        const originalIdx = parseInt(cell.dataset.idx, 10);
                        newAnswers.push(modelAnswers[originalIdx]);
                    });
                    
                    let changed = false;
                    for (let j = 0; j < modelAnswers.length; j++) {
                        if (modelAnswers[j] !== newAnswers[j]) changed = true;
                    }

                    if (changed) {
                        modelAnswers.splice(0, modelAnswers.length, ...newAnswers);
                        renderModelGrid(); // Re-render to fix the # numbers
                        await saveModelAnswers();
                        showAdminToast('並び替えを保存しました', 'success');
                    } else {
                        renderModelGrid(); // reset DOM
                    }
                });

                // ドロップ先へのドラッグ中の動的並び替え (Live sorting)
                item.addEventListener('dragenter', e => {
                    e.preventDefault();
                    const draggingItem = grid.querySelector('.dragging');
                    if (draggingItem && draggingItem !== item) {
                        const allItems = [...grid.querySelectorAll('.model-cell')];
                        const currPos = allItems.indexOf(draggingItem);
                        const tgtPos = allItems.indexOf(item);
                        if (currPos < tgtPos) {
                            item.after(draggingItem);
                        } else {
                            grid.insertBefore(draggingItem, item);
                        }
                    }
                });
                item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
                // drop時の固有処理はdragendに統合したため不要
                item.addEventListener('drop', e => e.preventDefault());

                // クリックで編集
                item.addEventListener('click', () => {
                    if (item.querySelector('input')) return;
                    const ansDiv = item.querySelector('.q-answer');
                    const current = modelAnswers[i] || '';
                    ansDiv.innerHTML = `<input type="text" value="${current}" class="inline-edit-input" />`;
                    const input = ansDiv.querySelector('input');
                    item.draggable = false; // 編集中はドラッグ無効
                    input.focus();
                    input.select();
                    const save = async () => {
                        const newVal = input.value.trim();
                        modelAnswers[i] = newVal;
                        ansDiv.style = newVal ? '' : 'color:var(--text-muted);font-style:italic';
                        ansDiv.textContent = newVal || '—';
                        item.draggable = true;
                        await saveModelAnswers();
                    };
                    input.addEventListener('blur', save);
                    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { ansDiv.textContent = current || '—'; item.draggable = true; } });
                });
                grid.appendChild(item);
            });
        }
        function loadCSV() {
            const file = document.getElementById('csv-file').files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async e => {
                const lines = e.target.result.split('\n').filter(l => l.trim());
                modelAnswers = new Array(totalQuestions).fill('');
                lines.forEach((line, idx) => {
                    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
                    if (cols.length >= 2 && !isNaN(parseInt(cols[0]))) { const q = parseInt(cols[0]); if (q >= 1 && q <= totalQuestions) modelAnswers[q - 1] = cols[1]; }
                    else if (idx < totalQuestions) modelAnswers[idx] = cols[0];
                });
                renderModelGrid();
                showAdminToast(`${lines.length}件読み込み中...`);
                await saveModelAnswers();
                showAdminToast(`${lines.length}件の模範解答を保存しました`, 'success');
            };
            reader.readAsText(file, 'UTF-8');
        }
        async function saveModelAnswers() {
            const data = {};
            modelAnswers.forEach((ans, idx) => { if (ans) data[idx + 1] = ans; });
            try {
                await dbSet(`projects/${projectId}/protected/${secretHash}/answers_text`, data);
            } catch(e) {
                showAdminToast('保存に失敗: ' + e.message);
            }
        }

        // ============================
        // TAB 4: 集計・設定
