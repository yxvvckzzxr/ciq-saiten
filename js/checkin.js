const projectId = session.projectId;
        const secretHash = session.get("secretHash");
        if (!projectId) { document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#f87171;font-weight:bold;">プロジェクトに入室してください。3秒後にトップページへ戻ります。</div>'; setTimeout(() => location.href = 'index.html', 3000); return; }

        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const resultDiv = document.getElementById('result');
        const scanningText = document.getElementById('scanning-text');
        let processing = false;
        let lastUUID = '';
        let hideTimer = null;

        // プロジェクト名読み込み
        (async function init() {
            const snap = await db.ref(`projects/${projectId}/settings`).once('value');
            if (snap.exists()) {
                const s = snap.val();
                document.getElementById('page-title').innerHTML = `<i class="fa-solid fa-qrcode"></i> ${s.projectName || ''} 受付`;
            }
            loadStats();
        })();

        async function loadStats() {
            const snap = await db.ref(`projects/${projectId}/entries`).once('value');
            if (!snap.exists()) {
                document.getElementById('stat-total').textContent = 0;
                document.getElementById('stat-checked').textContent = 0;
                document.getElementById('stat-remaining').textContent = 0;
                document.getElementById('stats-bar').style.display = 'block';
                return;
            }
            let total = 0, checked = 0;
            snap.forEach(c => {
                total++;
                if (c.val().checkedIn) checked++;
            });
            document.getElementById('stat-total').textContent = total;
            document.getElementById('stat-checked').textContent = checked;
            document.getElementById('stat-remaining').textContent = total - checked;
            document.getElementById('stats-bar').style.display = 'block';
        }


        // カメラ起動（リファレンス準拠: 即座に起動）
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
            .then(stream => {
                video.srcObject = stream;
                video.play();
                requestAnimationFrame(scanFrame);
            })
            .catch(err => {
                scanningText.textContent = 'カメラの起動に失敗しました: ' + err.message;
            });

        // スキャンループ（リファレンス準拠: 常時スキャン、重複防止付き）
        function scanFrame() {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code && !processing && code.data !== lastUUID) {
                    processing = true;
                    lastUUID = code.data;
                    showLoading();
                    processQR(code.data);
                }
            }
            requestAnimationFrame(scanFrame);
        }

        function showLoading() {
            if (hideTimer) clearTimeout(hideTimer);
            resultDiv.style.display = 'block';
            resultDiv.className = 'loading';
            resultDiv.innerHTML = '<div>⏳ 読み込み中...</div>';
        }

        // Firebase直接参照（リファレンスのGAS方式ではなく、Firebase直接）
        async function processQR(uuid) {
            try {
                const snap = await db.ref(`projects/${projectId}/entries/${uuid}`).once('value');

                if (!snap.exists()) {
                    showResultUI('error', '<i class="fa-solid fa-xmark"></i> 該当者が見つかりません', '', '');
                } else {
                    const data = snap.val();
                    if (data.status === 'canceled') {
                        showResultUI('canceled', '<i class="fa-solid fa-xmark"></i> キャンセル済み', `${data.familyName} ${data.firstName}`, `受付番号 ${data.entryNumber}`);
                    } else if (data.checkedIn) {
                        showResultUI('already', '<i class="fa-solid fa-triangle-exclamation"></i>️ 受付済み', `${data.familyName} ${data.firstName}`, `受付番号 ${data.entryNumber}`);
                    } else {
                        await db.ref(`projects/${projectId}/entries/${uuid}/checkedIn`).set(true);
                        showResultUI('success', '<i class="fa-solid fa-check"></i> 受付完了', `${data.familyName} ${data.firstName}`, `受付番号 ${data.entryNumber}`);
                        loadStats();
                    }
                }
            } catch (err) {
                showResultUI('error', '<i class="fa-solid fa-xmark"></i> エラーが発生しました', err.message, '');
                lastUUID = ''; // エラー時はリトライ可能に
            }
            processing = false;
        }

        function showResultUI(type, title, name, number) {
            if (hideTimer) clearTimeout(hideTimer);
            resultDiv.style.display = 'block';
            resultDiv.className = type;
            resultDiv.innerHTML = `
                <div>${title}</div>
                ${name ? `<div class="name">${name}</div>` : ''}
                ${number ? `<div class="number">${number}</div>` : ''}
            `;
            scanningText.textContent = 'QRコードをカメラにかざしてください';

            // 3秒後に結果を非表示にし、同じQRの再スキャンを許可
            hideTimer = setTimeout(() => {
                resultDiv.style.display = 'none';
                lastUUID = '';
            }, 3000);
        }