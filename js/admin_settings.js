// admin_settings.js — プロジェクト設定・エクスポート・削除・オンボーディング

        window.adjustNumberInput = async function(id, delta) {
            const input = document.getElementById(id);
            if (!input) return;
            let val = parseInt(input.value) || 0;
            const min = parseInt(input.min);
            const max = parseInt(input.max);
            val += delta;
            if (!isNaN(min) && val < min) val = min;
            if (!isNaN(max) && val > max) val = max;
            input.value = val;
            
            const event = new Event('change', { bubbles: true });
            input.dispatchEvent(event);

            // 問題数変更時はSupabaseにも同期
            if (id === 'question-count') {
                try {
                    await CIQSupabaseAPI.updateProject(projectId, { question_count: val });
                    totalQuestions = val;
                    showAdminToast(`問題数を ${val} 問に変更しました`, 'success');
                } catch(e) { console.error('問題数の同期失敗:', e); }
            }
        };


        // ============================
        // 設定更新処理
        // ============================

        function setMemberTableMessage(tbody, message, className = 'td-loading') {
            tbody.textContent = '';
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.className = className;
            td.textContent = message;
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        function appendMemberActionButton(container, options) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `btn ${options.variant || 'secondary'}`;
            button.disabled = Boolean(options.disabled);
            if (options.icon) {
                const icon = createIcon(options.icon);
                button.appendChild(icon);
                button.appendChild(document.createTextNode(' '));
            }
            button.appendChild(document.createTextNode(options.label));
            button.addEventListener('click', options.onClick);
            container.appendChild(button);
        }

        let projectMembersRefreshTimer = 0;
        let projectMembersLoading = false;

        function appendProjectMemberRow(tbody, member, currentUserId) {
            const roleLabel = member.role === 'owner' ? '所有者' : member.role === 'admin' ? '管理者' : '採点者';
            const statusLabel = member.status === 'removed' ? '停止中' : '有効';
            const isSelf = member.user_id === currentUserId;
            const canChange = member.role !== 'owner' && !isSelf;

            const tr = document.createElement('tr');
            if (member.status === 'removed') tr.className = 'member-row-removed';

            [member.display_name || member.invited_email || '-', roleLabel, statusLabel].forEach((text) => {
                const td = document.createElement('td');
                td.textContent = text;
                tr.appendChild(td);
            });

            const actionTd = document.createElement('td');
            const actionGroup = document.createElement('div');
            actionGroup.className = 'member-action-group';
            if (member.status === 'removed') {
                appendMemberActionButton(actionGroup, {
                    label: '復帰',
                    icon: 'rotate-left',
                    disabled: isSelf,
                    onClick: () => restoreProjectMember(member.id),
                });
            } else {
                appendMemberActionButton(actionGroup, {
                    label: member.role === 'admin' ? '採点者へ' : '管理者へ',
                    disabled: !canChange,
                    onClick: () => changeProjectMemberRole(member.id, member.role === 'admin' ? 'scorer' : 'admin'),
                });
                appendMemberActionButton(actionGroup, {
                    label: 'キック',
                    icon: 'user-xmark',
                    variant: 'danger',
                    disabled: !canChange,
                    onClick: () => removeProjectMember(member.id),
                });
            }
            actionTd.appendChild(actionGroup);
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        }

        function setTableMessage(tbody, colspan, message, className = 'td-loading') {
            tbody.textContent = '';
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = colspan;
            td.className = className;
            td.textContent = message;
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        function getCachedAdminEntries() {
            const cached = Object.values(window._entriesRaw || {});
            if (!cached.length) return null;
            return cached.sort((a, b) => Number(a.entry_number || a.entryNumber || 0) - Number(b.entry_number || b.entryNumber || 0));
        }

        function yieldToBrowser() {
            return new Promise(resolve => setTimeout(resolve, 0));
        }

        function generateAdminEntryPassword() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
            return AppCrypto.randomString(8, chars);
        }

        let lastAdminEntryReceipt = null;
        let lastAdminEntryReceiptUrl = '';
        let adminEntryReturnFocus = null;
        let adminEntryWasScrollLocked = false;
        let adminEntrySubmitting = false;

        function getAdminEntryModal() {
            return document.getElementById('admin-entry-modal');
        }

        function setAdminEntryStatus(message, type = '') {
            const el = document.getElementById('admin-entry-status');
            if (!el) return;
            if (message) setPageMessage(el, message, type || 'info');
            else clearPageMessage(el);
        }

        function setAdminEntrySubmitting(isSubmitting) {
            adminEntrySubmitting = Boolean(isSubmitting);
            const submit = document.getElementById('admin-entry-submit');
            if (!submit) return;
            submit.disabled = isSubmitting;
            submit.textContent = '';
            const icon = createIcon(isSubmitting ? 'spinner' : 'plus');
            submit.append(icon, document.createTextNode(isSubmitting ? ' 追加中...' : ' 追加する'));
        }

        function resetAdminEntryForm() {
            document.getElementById('admin-entry-form')?.reset();
            document.getElementById('admin-entry-form')?.classList.remove('u-hidden');
            document.getElementById('admin-entry-result')?.classList.add('u-hidden');
            document.getElementById('admin-entry-receipt-image')?.setAttribute('hidden', '');
            if (lastAdminEntryReceiptUrl) URL.revokeObjectURL(lastAdminEntryReceiptUrl);
            lastAdminEntryReceipt = null;
            lastAdminEntryReceiptUrl = '';
            ['admin-entry-result-number', 'admin-entry-result-status', 'admin-entry-result-password'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.textContent = '';
            });
            const receiptStatus = document.getElementById('admin-entry-receipt-status');
            if (receiptStatus) {
                setPageMessage(receiptStatus, '二次元コード入り控え画像を生成しています...', 'info');
            }
            setAdminEntryStatus('');
            setAdminEntrySubmitting(false);
        }

        function openAdminEntryModal() {
            const modal = getAdminEntryModal();
            if (!modal) return;
            adminEntryReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            adminEntryWasScrollLocked = document.body.classList.contains('body-scroll-locked');
            resetAdminEntryForm();
            modal.hidden = false;
            document.body.classList.add('body-scroll-locked');
            modal.addEventListener('keydown', handleAdminEntryModalKeydown);
            if (modal.dataset.backdropBound !== 'true') {
                modal.dataset.backdropBound = 'true';
                modal.addEventListener('click', (event) => {
                    if (event.target === modal) closeAdminEntryModal();
                });
            }
            requestAnimationFrame(() => modal.classList.add('visible'));
            document.getElementById('admin-entry-family-name')?.focus();
        }

        function handleAdminEntryModalKeydown(event) {
            const modal = getAdminEntryModal();
            const dialog = modal?.querySelector('[role="dialog"]');
            if (!modal || !dialog) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeAdminEntryModal();
                return;
            }
            if (typeof trapFocusWithin === 'function') trapFocusWithin(event, dialog);
        }

        function canDismissAdminEntryModal() {
            const resultVisible = !document.getElementById('admin-entry-result')?.classList.contains('u-hidden');
            return !adminEntrySubmitting && !resultVisible;
        }

        function closeAdminEntryModal(force = false) {
            const modal = getAdminEntryModal();
            if (!modal) return;
            if (!force && !canDismissAdminEntryModal()) {
                if (adminEntrySubmitting) {
                    setAdminEntryStatus('参加者を追加中です。完了までお待ちください。', 'info');
                }
                return;
            }
            modal.removeEventListener('keydown', handleAdminEntryModalKeydown);
            modal.classList.remove('visible');
            setTimeout(() => {
                modal.hidden = true;
                resetAdminEntryForm();
                if (!adminEntryWasScrollLocked) document.body.classList.remove('body-scroll-locked');
                if (adminEntryReturnFocus?.isConnected) adminEntryReturnFocus.focus();
                adminEntryReturnFocus = null;
            }, 160);
        }

        function finishAdminEntryFlow() {
            closeAdminEntryModal(true);
        }

        async function copyAdminEntryPassword() {
            const password = document.getElementById('admin-entry-result-password')?.textContent || '';
            if (!password) return;
            await navigator.clipboard.writeText(password);
            showAdminToast('パスワードをコピーしました', 'success');
        }

        function buildAdminEntryLinks() {
            const baseUrl = new URL('.', window.location.href);
            return {
                myUrl: new URL(`my.html?pid=${encodeURIComponent(projectId)}`, baseUrl).href,
                entryListUrl: new URL(`entry_list.html?pid=${encodeURIComponent(projectId)}`, baseUrl).href,
            };
        }

        function buildAdminEntryTemplateText(receipt = lastAdminEntryReceipt) {
            if (!receipt) return '';
            return [
                `${receipt.familyName} ${receipt.firstName} 様`,
                '',
                `${receipt.projectName} のエントリーを代理で登録しました。`,
                `受付番号: ${receipt.entryNumber}`,
                ...(receipt.status === 'waitlist' ? ['状態: キャンセル待ち'] : []),
                `パスワード: ${receipt.password}`,
                '',
                '当日受付には、別途送付する二次元コード画像が必要です。',
                'この画像とパスワードは大会当日まで保管してください。',
                '',
                `マイエントリー(内容の確認・変更): ${receipt.myUrl}`,
                `エントリーリスト: ${receipt.entryListUrl}`,
            ].join('\n');
        }

        async function copyAdminEntryTemplate() {
            const text = buildAdminEntryTemplateText();
            if (!text) return;
            await navigator.clipboard.writeText(text);
            showAdminToast('定型文をコピーしました', 'success');
        }

        function drawRoundedRect(ctx, x, y, w, h, r) {
            const radius = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.arcTo(x + w, y, x + w, y + h, radius);
            ctx.arcTo(x + w, y + h, x, y + h, radius);
            ctx.arcTo(x, y + h, x, y, radius);
            ctx.arcTo(x, y, x + w, y, radius);
            ctx.closePath();
        }

        function drawReceiptText(ctx, text, x, y, maxWidth, lineHeight) {
            const chars = String(text || '').split('');
            let line = '';
            let currentY = y;
            for (const char of chars) {
                const next = line + char;
                if (ctx.measureText(next).width > maxWidth && line) {
                    ctx.fillText(line, x, currentY);
                    line = char;
                    currentY += lineHeight;
                } else {
                    line = next;
                }
            }
            if (line) ctx.fillText(line, x, currentY);
            return currentY;
        }

        function loadImageFromBlob(blob) {
            return new Promise((resolve, reject) => {
                const url = URL.createObjectURL(blob);
                const image = new Image();
                image.onload = () => {
                    URL.revokeObjectURL(url);
                    resolve(image);
                };
                image.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error('二次元コード画像を読み込めませんでした。'));
                };
                image.src = url;
            });
        }

        async function renderAdminEntryReceiptImage(receipt, qrSvg) {
            const appleTextFont = '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
            const appleDisplayFont = '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
            const qrImage = await loadImageFromBlob(new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' }));
            const canvas = document.createElement('canvas');
            canvas.width = 900;
            canvas.height = 1180;
            const ctx = canvas.getContext('2d');

            try { await document.fonts.ready; } catch (_) {}

            ctx.fillStyle = '#f5f5f7';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#1d1d1f';
            ctx.fillRect(0, 0, canvas.width, 170);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';
            ctx.font = `800 38px ${appleDisplayFont}`;
            ctx.fillText('エントリー受付完了', canvas.width / 2, 72);
            ctx.fillStyle = '#d2d2d7';
            ctx.font = `600 24px ${appleTextFont}`;
            ctx.fillText(receipt.projectName, canvas.width / 2, 116);

            ctx.fillStyle = '#ffffff';
            drawRoundedRect(ctx, 70, 215, 760, 820, 24);
            ctx.fill();
            ctx.strokeStyle = '#e5e5ea';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.textAlign = 'left';
            ctx.fillStyle = '#1d1d1f';
            ctx.font = `600 24px ${appleTextFont}`;
            drawReceiptText(ctx, `${receipt.familyName} ${receipt.firstName} 様`, 110, 270, 680, 36);

            ctx.fillStyle = '#f5f5f7';
            drawRoundedRect(ctx, 110, 315, 680, 150, 16);
            ctx.fill();
            ctx.fillStyle = '#6e6e73';
            ctx.font = `700 22px ${appleTextFont}`;
            ctx.fillText('受付番号', 145, 370);
            ctx.fillText('パスワード', 145, 430);
            ctx.fillStyle = '#1d1d1f';
            ctx.textAlign = 'right';
            ctx.font = `800 34px ${appleDisplayFont}`;
            ctx.fillText(receipt.entryNumber, 750, 374);
            ctx.fillText(receipt.password, 750, 434);

            if (receipt.status === 'waitlist') {
                ctx.textAlign = 'center';
                ctx.fillStyle = '#fff7e8';
                drawRoundedRect(ctx, 110, 490, 680, 62, 14);
                ctx.fill();
                ctx.fillStyle = '#bf6a02';
                ctx.font = `800 22px ${appleTextFont}`;
                ctx.fillText('現在はキャンセル待ちです', canvas.width / 2, 530);
            }

            ctx.drawImage(qrImage, 285, 585, 330, 330);
            ctx.strokeStyle = '#d2d2d7';
            ctx.lineWidth = 2;
            drawRoundedRect(ctx, 275, 575, 350, 350, 20);
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.fillStyle = '#1d1d1f';
            ctx.font = `800 24px ${appleTextFont}`;
            ctx.fillText('当日受付にはこの二次元コードが必要です', canvas.width / 2, 970);
            ctx.fillStyle = '#6e6e73';
            ctx.font = `500 18px ${appleTextFont}`;
            ctx.fillText('この画像とパスワードを大会当日まで保管してください', canvas.width / 2, 1005);

            ctx.fillStyle = '#f5f5f7';
            ctx.fillRect(0, 1080, canvas.width, 100);
            ctx.fillStyle = '#6e6e73';
            ctx.font = `600 18px ${appleDisplayFont}`;
            ctx.fillText('CIQ', canvas.width / 2, 1138);

            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('控え画像を生成できませんでした。'));
                }, 'image/png');
            });
        }

        function setAdminEntryReceiptStatus(message, type = 'info') {
            const status = document.getElementById('admin-entry-receipt-status');
            if (!status) return;
            setPageMessage(status, message, type);
        }

        async function prepareAdminEntryReceipt(receipt) {
            const image = document.getElementById('admin-entry-receipt-image');
            try {
                const qrSvg = await CIQSupabaseAPI.getAdminEntryQrSvg(projectId, receipt.entryId);
                const blob = await renderAdminEntryReceiptImage(receipt, qrSvg);
                if (lastAdminEntryReceiptUrl) URL.revokeObjectURL(lastAdminEntryReceiptUrl);
                lastAdminEntryReceiptUrl = URL.createObjectURL(blob);
                receipt.imageBlob = blob;
                lastAdminEntryReceipt = receipt;
                if (image) {
                    image.src = lastAdminEntryReceiptUrl;
                    image.hidden = false;
                }
                setAdminEntryReceiptStatus('二次元コード入り控え画像を生成しました。', 'success');
            } catch (e) {
                setAdminEntryReceiptStatus(e.message || '二次元コード入り控え画像を生成できませんでした。', 'error');
            }
        }

        function downloadAdminEntryReceipt() {
            if (!lastAdminEntryReceipt?.imageBlob) {
                showAdminToast('控え画像がまだ生成されていません', 'error');
                return;
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(lastAdminEntryReceipt.imageBlob);
            a.download = `ciq-entry-${lastAdminEntryReceipt.entryNumber}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }

        function getAdminEntryValue(id) {
            return document.getElementById(id)?.value?.trim() || '';
        }

        function validateAdminEntryForm(values) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
                return '正しいメールアドレスを入力してください。';
            }
            if (!/^[ァ-ヴー]+$/.test(values.familyNameKana) || !/^[ァ-ヴー]+$/.test(values.firstNameKana)) {
                return 'カナは全角カタカナで入力してください。';
            }
            return '';
        }

        function readAdminEntryForm() {
            return {
                email: getAdminEntryValue('admin-entry-email'),
                familyName: getAdminEntryValue('admin-entry-family-name'),
                firstName: getAdminEntryValue('admin-entry-first-name'),
                familyNameKana: getAdminEntryValue('admin-entry-family-kana'),
                firstNameKana: getAdminEntryValue('admin-entry-first-kana'),
                affiliation: getAdminEntryValue('admin-entry-affiliation'),
                grade: getAdminEntryValue('admin-entry-grade'),
                entryName: getAdminEntryValue('admin-entry-entry-name'),
                recordNamePermission: document.querySelector('input[name="admin-entry-record-name-permission"]:checked')?.value || '',
                message: getAdminEntryValue('admin-entry-public-message'),
                inquiry: getAdminEntryValue('admin-entry-inquiry'),
                isChubu: document.getElementById('admin-entry-chubu')?.checked === true,
            };
        }

        async function submitAdminEntryForm(event) {
            event?.preventDefault();
            const form = document.getElementById('admin-entry-form');
            if (form && !form.reportValidity()) return;
            const values = readAdminEntryForm();
            const validationMessage = validateAdminEntryForm(values);
            if (validationMessage) {
                setAdminEntryStatus(validationMessage, 'error');
                return;
            }

            setAdminEntrySubmitting(true);
            setAdminEntryStatus('参加者を追加しています...', 'info');
            const password = generateAdminEntryPassword();
            try {
                const settings = await CIQSupabaseAPI.getPublicSettings(projectId);
                const publicKeyJwk = settings?.publicKey;
                if (!publicKeyJwk) throw new Error('セキュリティキーが取得できません。');

                const emailHash = await AppCrypto.hashPassword(values.email.toLowerCase());
                const passwordHash = await AppCrypto.hashPassword(password);
                const { recordNamePermission, ...piiValues } = values;
                const piiData = { ...piiValues, useEntryName: false, allowRealNameInRecord: recordNamePermission === 'allow' };
                const encryptedPII = await AppCrypto.encryptRSA(JSON.stringify(piiData), publicKeyJwk);
                const entry = await CIQSupabaseAPI.adminCreateEntry({
                    projectId,
                    encryptedPii: encryptedPII,
                    emailHash,
                    disclosurePasswordHash: passwordHash,
                    publicProfile: {
                        entryName: values.entryName,
                        affiliation: values.affiliation,
                        grade: values.grade,
                        message: values.message,
                        inquiry: values.inquiry,
                        isChubu: values.isChubu,
                    },
                });

                document.getElementById('admin-entry-form')?.classList.add('u-hidden');
                document.getElementById('admin-entry-result')?.classList.remove('u-hidden');
                document.getElementById('admin-entry-result-number').textContent = padNum(entry.entry_number || entry.entryNumber);
                document.getElementById('admin-entry-result-status').textContent = entry.status === 'waitlist' ? 'キャンセル待ち' : '登録済み';
                document.getElementById('admin-entry-result-password').textContent = password;
                const { myUrl, entryListUrl } = buildAdminEntryLinks();
                const receipt = {
                    projectName: adminProjectName || projectId,
                    entryId: entry.id,
                    entryNumber: padNum(entry.entry_number || entry.entryNumber),
                    status: entry.status,
                    password,
                    familyName: values.familyName,
                    firstName: values.firstName,
                    myUrl,
                    entryListUrl,
                    imageBlob: null,
                };
                lastAdminEntryReceipt = receipt;
                prepareAdminEntryReceipt(receipt);
                setAdminEntryStatus('');
                window._entriesRaw = null;
                await loadAdminEntries();
                updateAdminOverview();
                showAdminToast('参加者を追加しました', 'success');
            } catch (e) {
                setAdminEntryStatus(e.message || '参加者の追加に失敗しました。', 'error');
            } finally {
                setAdminEntrySubmitting(false);
            }
        }

        async function loadProjectMembers() {
            const tbody = document.getElementById('project-members-tbody');
            if (!tbody || projectMembersLoading) return;
            projectMembersLoading = true;
            if (!tbody.children.length) setMemberTableMessage(tbody, '読み込み中...');
            try {
                const currentSession = await CIQSupabaseAPI.getSession();
                const currentUserId = currentSession?.user?.id || '';
                const members = await CIQSupabaseAPI.listProjectMembers(projectId);
                if (!members.length) {
                    setMemberTableMessage(tbody, 'メンバーがいません。');
                    return;
                }
                tbody.textContent = '';
                members.forEach(member => appendProjectMemberRow(tbody, member, currentUserId));
            } catch (e) {
                setMemberTableMessage(tbody, `読み込みに失敗しました: ${e.message}`, 'td-loading-error');
            } finally {
                projectMembersLoading = false;
            }
        }

        // ---- 採点者招待リンク(AB-1) ----
        // 平文トークンは発行直後の応答にしか存在しない(DBには HMAC のみ保存)。
        // そのため一覧では URL を再表示できず、必要なら新しく発行する運用にしている。

        function setInviteStatus(message, type = '') {
            const box = document.getElementById('invite-status');
            if (!box) return;
            if (message) setPageMessage(box, message, type || 'info');
            else clearPageMessage(box);
        }

        function inviteUrlFor(token) {
            return new URL(`join.html?t=${encodeURIComponent(token)}`, location.href).href;
        }

        function inviteState(invite) {
            if (invite.revoked_at) return { label: '無効化済み', className: 'is-revoked' };
            if (new Date(invite.expires_at).getTime() <= Date.now()) return { label: '期限切れ', className: 'is-expired' };
            if (Number(invite.use_count) >= Number(invite.max_uses)) return { label: '上限到達', className: 'is-expired' };
            return { label: '有効', className: 'is-active' };
        }

        function appendInviteRow(tbody, invite) {
            const tr = document.createElement('tr');
            const state = inviteState(invite);
            const cells = [
                new Date(invite.created_at).toLocaleString('ja-JP'),
                `${invite.use_count} / ${invite.max_uses}`,
                new Date(invite.expires_at).toLocaleString('ja-JP'),
                state.label,
            ];
            cells.forEach((text) => {
                const td = document.createElement('td');
                td.textContent = text;
                tr.appendChild(td);
            });
            const actionTd = document.createElement('td');
            if (!invite.revoked_at) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn danger';
                button.append(createIcon('ban'), document.createTextNode(' 無効化'));
                button.addEventListener('click', () => revokeInvite(invite.id, button));
                actionTd.appendChild(button);
            }
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        }

        async function loadScorerInvites() {
            const tbody = document.getElementById('invite-tbody');
            if (!tbody) return;
            try {
                const invites = await CIQSupabaseAPI.listScorerInvites(projectId);
                tbody.textContent = '';
                if (!invites.length) {
                    setTableMessage(tbody, 5, 'まだ招待リンクはありません。', 'td-empty');
                    return;
                }
                invites.forEach((invite) => appendInviteRow(tbody, invite));
            } catch (e) {
                setTableMessage(tbody, 5, '招待リンクを取得できませんでした。', 'td-error');
                console.warn('招待一覧の取得に失敗:', e);
            }
        }

        async function revokeInvite(inviteId, button) {
            const ok = await showConfirm('この招待リンクを無効化します。以後このリンクからは参加できません。', '無効化する');
            if (!ok) return;
            if (button) button.disabled = true;
            try {
                await CIQSupabaseAPI.revokeScorerInvite(inviteId);
                setInviteStatus('招待リンクを無効化しました。', 'success');
                await loadScorerInvites();
            } catch (e) {
                setInviteStatus('無効化に失敗しました: ' + (e.message || ''), 'error');
                if (button) button.disabled = false;
            }
        }

        async function createScorerInvite() {
            const button = document.getElementById('invite-create-btn');
            const maxInput = document.getElementById('invite-max-uses');
            const maxUses = Number(maxInput?.value);
            if (!Number.isFinite(maxUses) || maxUses < 1) {
                setInviteStatus('上限人数を1以上で入力してください。', 'error');
                return;
            }
            if (button) button.disabled = true;
            setInviteStatus('招待リンクを発行しています...');
            try {
                const invite = await CIQSupabaseAPI.createScorerInvite(projectId, maxUses);
                const url = inviteUrlFor(invite.token);
                const box = document.getElementById('invite-new');
                const field = document.getElementById('invite-new-url');
                if (field) field.value = url;
                box?.classList.remove('u-hidden');
                setInviteStatus('招待リンクを発行しました。この場でコピーしてください（再表示できません）。', 'success');
                await loadScorerInvites();
            } catch (e) {
                setInviteStatus('発行に失敗しました: ' + (e.message || ''), 'error');
            } finally {
                if (button) button.disabled = false;
            }
        }

        function setupScorerInvites() {
            document.getElementById('invite-create-btn')?.addEventListener('click', createScorerInvite);
            document.getElementById('invite-copy-btn')?.addEventListener('click', () => {
                const field = document.getElementById('invite-new-url');
                if (!field?.value) return;
                navigator.clipboard.writeText(field.value).then(
                    () => setInviteStatus('招待リンクをコピーしました。', 'success'),
                    () => setInviteStatus('コピーできませんでした。手動で選択してください。', 'error'),
                );
            });
            loadScorerInvites();
        }

        function startProjectMembersAutoRefresh() {
            if (projectMembersRefreshTimer) return;
            loadProjectMembers();
            setupScorerInvites();
            projectMembersRefreshTimer = window.setInterval(() => {
                if (document.visibilityState === 'hidden') return;
                const settingsTab = document.getElementById('tab-settings');
                if (settingsTab && !settingsTab.classList.contains('active')) return;
                loadProjectMembers();
            }, 10000);
        }

        async function changeProjectMemberRole(memberId, role) {
            try {
                await CIQSupabaseAPI.updateProjectMemberRole(memberId, role);
                showAdminToast('権限を更新しました', 'success');
                await loadProjectMembers();
            } catch (e) {
                showAdminToast(e.message || '権限更新に失敗しました', 'error');
            }
        }

        async function removeProjectMember(memberId) {
            const ok = await showConfirm('このメンバーをキックします。同じパスワードでは再参加できなくなります。', 'キックする');
            if (!ok) return;
            try {
                await CIQSupabaseAPI.removeProjectMember(memberId);
                showAdminToast('メンバーを停止しました', 'success');
                await loadProjectMembers();
            } catch (e) {
                showAdminToast(e.message || 'キックに失敗しました', 'error');
            }
        }

        async function restoreProjectMember(memberId) {
            try {
                await CIQSupabaseAPI.restoreProjectMember(memberId);
                showAdminToast('メンバーを復帰しました', 'success');
                await loadProjectMembers();
            } catch (e) {
                showAdminToast(e.message || '復帰に失敗しました', 'error');
            }
        }

        async function updateTerms() {
            const termsText = document.getElementById('setting-terms').value.trim();
            await CIQSupabaseAPI.updateProject(projectId, { terms: termsText || null });
            showAdminToast('参加規約を更新しました', 'success');
        }

        async function updateEmailSettings() {
            await CIQSupabaseAPI.updateProject(projectId, {
                notify_entry_edit: document.getElementById('setting-notify-entry-edit')?.checked !== false,
                notify_entry_cancel: document.getElementById('setting-notify-entry-cancel')?.checked !== false,
                notify_late_notice: document.getElementById('setting-notify-late-notice')?.checked !== false,
            });
            showAdminToast('メール設定を更新しました', 'success');
        }

        function bindEmailSettingsAutosave() {
            const ids = ['setting-notify-entry-edit', 'setting-notify-entry-cancel', 'setting-notify-late-notice'];
            ids.forEach((id) => {
                const input = document.getElementById(id);
                if (!input) return;
                input.addEventListener('change', async () => {
                    const previous = !input.checked;
                    ids.forEach((targetId) => {
                        const target = document.getElementById(targetId);
                        if (target) target.disabled = true;
                    });
                    try {
                        await updateEmailSettings();
                    } catch (e) {
                        input.checked = previous;
                        showAdminToast(e.message || 'メール設定の更新に失敗しました', 'error');
                    } finally {
                        ids.forEach((targetId) => {
                            const target = document.getElementById(targetId);
                            if (target) target.disabled = false;
                        });
                    }
                });
            });
        }

        function toggleMaxEntries() {
            const isOn = document.getElementById('max-entries-toggle').checked;
            const badge = document.getElementById('max-entries-status');
            const inputArea = document.getElementById('max-entries-input-area');
            if (isOn) {
                badge.textContent = document.getElementById('setting-max-entries').value + '人';
                badge.className = 'status-badge status-open';
                inputArea.classList.remove('u-hidden');
            } else {
                badge.textContent = '制限なし';
                badge.className = 'status-badge status-closed';
                inputArea.classList.add('u-hidden');
            }
            saveEntryPeriod();
        }

        function setMaxEntriesStatusSaving() {
            const badge = document.getElementById('max-entries-status');
            if (badge) {
                badge.textContent = '保存中...';
                badge.className = 'status-badge status-warning';
            }
        }


        // ============================
        // 参加者管理・エントリー管理
        // ============================
        async function toggleEntryOpen() {
            const enabled = document.getElementById('entry-open-toggle').checked;
            await CIQSupabaseAPI.updateProject(projectId, { entry_open: enabled });
            updateEntryOpenStatus();
            showAdminToast(enabled ? 'エントリー設定を更新しました' : 'エントリーを停止しました', 'success');
        }
        function updateEntryOpenStatus() {
            const isOpen = document.getElementById('entry-open-toggle').checked;
            const ps = document.getElementById('entry-period-start').value;
            const pe = document.getElementById('entry-period-end').value;
            const el = document.getElementById('entry-open-status');
            const summary = document.getElementById('entry-state-summary');
            const meta = document.getElementById('entry-state-meta');

            const setPublicState = (label, detail) => {
                if (summary) summary.textContent = label;
                if (meta) meta.textContent = detail;
            };

            if (!isOpen) {
                el.textContent = '停止中';
                el.className = 'status-badge status-closed';
                setPublicState('停止中', 'エントリーフォームは利用不可');
                window.updateAdminOverview?.();
                return;
            }

            const now = new Date();
            if (ps && new Date(ps) > now) {
                el.textContent = '期間外（開始前）';
                el.className = 'status-badge status-warning';
                setPublicState('開始前', `${formatDtDisplay(ps)} から`);
                window.updateAdminOverview?.();
                return;
            }
            if (pe && new Date(pe) < now) {
                el.textContent = '期間外（終了済）';
                el.className = 'status-badge status-warning';
                setPublicState('終了済', `${formatDtDisplay(pe)} まで`);
                window.updateAdminOverview?.();
                return;
            }

            el.textContent = 'エントリー中';
            el.className = 'status-badge status-open';
            setPublicState('エントリー中', pe ? `${formatDtDisplay(pe)} まで` : '終了日時なし');
            window.updateAdminOverview?.();
        }

        async function saveEntryPeriod() {
            const start = document.getElementById('entry-period-start').value || null;
            const end = document.getElementById('entry-period-end').value || null;
            const waitlistEnd = document.getElementById('waitlist-period-end')?.value || null;
            const hasLimit = document.getElementById('max-entries-toggle').checked;
            const maxEntries = hasLimit ? (parseInt(document.getElementById('setting-max-entries').value) || 100) : 0;
            setMaxEntriesStatusSaving();
            await CIQSupabaseAPI.updateProject(projectId, {
                period_start: start ? new Date(start).toISOString() : null,
                period_end: end ? new Date(end).toISOString() : null,
                waitlist_promotion_period_end: waitlistEnd ? new Date(waitlistEnd).toISOString() : null,
                max_entries: maxEntries
            });
            // トグルONなら人数バッジも更新
            const badge = document.getElementById('max-entries-status');
            if (hasLimit) {
                badge.textContent = maxEntries + '人';
                badge.className = 'status-badge status-open';
            } else {
                badge.textContent = '制限なし';
                badge.className = 'status-badge status-closed';
            }
            showAdminToast('エントリー期間・定員を保存しました', 'success');
        }

        function updateWaitlistPromotionDeadlineDisplay() {
            const value = document.getElementById('waitlist-period-end')?.value || '';
            const display = document.getElementById('dt-waitlist-end-display');
            if (!display) return;
            display.textContent = value ? formatDtDisplay(value) : 'エントリー終了と同じ';
        }

        async function toggleDisclosureOpen() {
            const enabled = document.getElementById('disclosure-open-toggle').checked;
            await CIQSupabaseAPI.updateProject(projectId, { disclosure_enabled: enabled });
            updateDisclosureOpenStatus();
            showAdminToast(enabled ? '成績照会を有効にしました' : '成績照会を停止しました', 'success');
        }

        function updateDisclosureOpenStatus() {
            const toggle = document.getElementById('disclosure-open-toggle');
            const el = document.getElementById('disclosure-open-status');
            if (!toggle || !el) return;
            const isOpen = toggle.checked;
            const ps = document.getElementById('disclosure-period-start').value;
            const pe = document.getElementById('disclosure-period-end').value;
            const summary = document.getElementById('disclosure-state-summary');
            const meta = document.getElementById('disclosure-state-meta');

            const setPublicState = (label, detail) => {
                if (summary) summary.textContent = label;
                if (meta) meta.textContent = detail;
            };

            if (!isOpen) {
                el.textContent = '停止中';
                el.className = 'status-badge status-closed';
                setPublicState('停止中', '成績照会ページは利用不可');
                window.updateAdminOverview?.();
                return;
            }

            const now = new Date();
            if (ps && new Date(ps) > now) {
                el.textContent = '期間外（開始前）';
                el.className = 'status-badge status-warning';
                setPublicState('開始前', `${formatDtDisplay(ps)} から`);
                window.updateAdminOverview?.();
                return;
            }
            if (pe && new Date(pe) < now) {
                el.textContent = '期間外（終了済）';
                el.className = 'status-badge status-warning';
                setPublicState('終了済', `${formatDtDisplay(pe)} まで`);
                window.updateAdminOverview?.();
                return;
            }

            el.textContent = '照会中';
            el.className = 'status-badge status-open';
            setPublicState('照会中', pe ? `${formatDtDisplay(pe)} まで` : '終了日時なし');
            window.updateAdminOverview?.();
        }

        async function saveDisclosurePeriod() {
            const start = document.getElementById('disclosure-period-start').value || null;
            const end = document.getElementById('disclosure-period-end').value || null;
            await CIQSupabaseAPI.updateProject(projectId, {
                disclosure_period_start: start ? new Date(start).toISOString() : null,
                disclosure_period_end: end ? new Date(end).toISOString() : null
            });
            updateDisclosureOpenStatus();
            showAdminToast('照会期間を保存しました', 'success');
        }

        // ============================
        // Custom DateTime Picker
        // ============================
        let dtScope = 'entry'; // 'entry', 'disclosure', or 'waitlist'
        let dtTarget = null; // 'start' or 'end'
        let dtYear, dtMonth, dtDay, dtHour = 0, dtMin = 0;
        let dtHost = null;
        let dtCloseTimer = 0;
        let dtReturnFocus = null;

        function formatDtDisplay(val) {
            if (!val) return '未設定';
            const d = new Date(val);
            const mm = d.getMonth() + 1, dd = d.getDate();
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            return `${d.getFullYear()}/${mm}/${dd} ${hh}:${mi}`;
        }

        function getPeriodPrefix(scope = dtScope) {
            if (scope === 'waitlist') return 'waitlist';
            return scope === 'disclosure' ? 'disclosure' : 'entry';
        }

        function getDtDisplayId(scope, target) {
            if (scope === 'waitlist') return `dt-waitlist-${target}-display`;
            return scope === 'disclosure' ? `dt-disclosure-${target}-display` : `dt-${target}-display`;
        }

        function getDtTriggerId(scope, target) {
            if (scope === 'waitlist') return `dt-waitlist-${target}-trigger`;
            return scope === 'disclosure' ? `dt-disclosure-${target}-trigger` : `dt-${target}-trigger`;
        }

        function placeDatePicker(picker, scope, target) {
            const trigger = document.getElementById(getDtTriggerId(scope, target));
            if (!picker || !trigger) return;
            const host = trigger.parentElement;
            if (!host) return;

            if (dtHost && dtHost !== host) dtHost.classList.remove('dt-anchor-host');
            dtHost = host;
            dtHost.classList.add('dt-anchor-host');
            dtHost.appendChild(picker);
            picker.classList.remove('align-end', 'place-above');

            const rect = trigger.getBoundingClientRect();
            const margin = 12;
            const pickerWidth = picker.offsetWidth || 300;
            const pickerHeight = picker.offsetHeight || 390;
            if (rect.left + pickerWidth > window.innerWidth - margin) picker.classList.add('align-end');
            if (rect.bottom + pickerHeight + margin > window.innerHeight && rect.top > pickerHeight + margin) {
                picker.classList.add('place-above');
            }
        }

        function getDtTimeInput() {
            return document.getElementById('dt-picker-time-input');
        }

        function normalizeTimeDigits(digits) {
            return String(digits || '').replace(/\D/g, '').slice(0, 4);
        }

        function parseTimeDigits(digits) {
            const padded = normalizeTimeDigits(digits).padStart(4, '0');
            const hour = Math.min(23, parseInt(padded.slice(0, 2), 10) || 0);
            const minute = Math.min(59, parseInt(padded.slice(2, 4), 10) || 0);
            return { hour, minute };
        }

        function formatTimeDigits(digits) {
            const time = parseTimeDigits(digits);
            return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
        }

        function setDtTimeInput(hour = 0, minute = 0) {
            const input = getDtTimeInput();
            if (!input) return;
            const digits = `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
            input.dataset.timeDigits = digits;
            input.dataset.timeFresh = 'true';
            input.value = formatTimeDigits(digits);
        }

        function readDtTimeInput() {
            const input = getDtTimeInput();
            return parseTimeDigits(input?.dataset.timeDigits || input?.value || '');
        }

        function updateDtTimeInputFromDigits(input, digits) {
            const normalized = normalizeTimeDigits(digits);
            input.dataset.timeDigits = normalized;
            input.dataset.timeFresh = 'false';
            input.value = formatTimeDigits(normalized);
        }

        function handleDtTimeKeydown(event) {
            const input = event.currentTarget;
            if (!input) return;
            if (/^\d$/.test(event.key)) {
                event.preventDefault();
                const current = input.dataset.timeFresh === 'true' ? '' : (input.dataset.timeDigits || '');
                updateDtTimeInputFromDigits(input, `${current}${event.key}`);
                return;
            }
            if (event.key === 'Backspace' || event.key === 'Delete') {
                event.preventDefault();
                const current = input.dataset.timeFresh === 'true' ? '' : (input.dataset.timeDigits || '');
                updateDtTimeInputFromDigits(input, current.slice(0, -1));
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                dtConfirm();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDatePicker();
                return;
            }
            if (['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
        }

        function handleDtTimePaste(event) {
            const input = event.currentTarget;
            if (!input) return;
            event.preventDefault();
            updateDtTimeInputFromDigits(input, event.clipboardData?.getData('text') || '');
        }

        function openDatePicker(scopeOrTarget, maybeTarget) {
            dtScope = maybeTarget ? scopeOrTarget : 'entry';
            dtTarget = maybeTarget || scopeOrTarget;
            dtReturnFocus = document.getElementById(getDtTriggerId(dtScope, dtTarget));
            const prefix = getPeriodPrefix(dtScope);
            const existing = document.getElementById(`${prefix}-period-${dtTarget}`).value;
            const now = existing ? new Date(existing) : new Date();
            dtYear = now.getFullYear(); dtMonth = now.getMonth();
            dtDay = now.getDate();
            dtHour = now.getHours(); dtMin = now.getMinutes();

            setDtTimeInput(dtHour, dtMin);

            renderDtDays();

            const picker = document.getElementById('dt-picker');
            window.clearTimeout(dtCloseTimer);
            picker.hidden = false;
            placeDatePicker(picker, dtScope, dtTarget);
            picker.dataset.place = picker.classList.contains('place-above') ? 'above' : 'below';
            picker.setAttribute('role', 'dialog');
            picker.setAttribute('aria-modal', 'true');
            picker.setAttribute('aria-label', '日時を選択');
            dtReturnFocus?.setAttribute('aria-expanded', 'true');
            dtReturnFocus?.setAttribute('aria-controls', picker.id);
            const overlay = document.getElementById('dt-picker-overlay');
            overlay.hidden = false;
            overlay.classList.add('active');
            requestAnimationFrame(() => {
                picker.classList.add('is-open');
                (picker.querySelector('.dt-day.selected') || getDtTimeInput() || picker).focus();
            });
        }

        function closeDatePicker() {
            const picker = document.getElementById('dt-picker');
            const overlay = document.getElementById('dt-picker-overlay');
            window.clearTimeout(dtCloseTimer);
            picker.classList.remove('is-open');
            overlay.classList.remove('active');
            dtCloseTimer = window.setTimeout(() => {
                if (picker.classList.contains('is-open')) return;
                picker.hidden = true;
                picker.classList.remove('align-end', 'place-above');
                delete picker.dataset.place;
                overlay.hidden = true;
                dtHost?.classList.remove('dt-anchor-host');
                document.body.appendChild(picker);
                dtHost = null;
            }, 160);
            dtReturnFocus?.setAttribute('aria-expanded', 'false');
            if (dtReturnFocus?.isConnected) dtReturnFocus.focus();
            dtReturnFocus = null;
        }

        function dtNavMonth(delta) {
            dtMonth += delta;
            if (dtMonth < 0) { dtMonth = 11; dtYear--; }
            if (dtMonth > 11) { dtMonth = 0; dtYear++; }
            renderDtDays();
            const picker = document.getElementById('dt-picker');
            placeDatePicker(picker, dtScope, dtTarget);
            picker.dataset.place = picker.classList.contains('place-above') ? 'above' : 'below';
        }

        function renderDtDays() {
            const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
            document.getElementById('dt-picker-month').textContent = `${dtYear}年 ${months[dtMonth]}`;

            const container = document.getElementById('dt-picker-days');
            container.textContent = '';

            const firstDay = new Date(dtYear, dtMonth, 1).getDay();
            const daysInMonth = new Date(dtYear, dtMonth + 1, 0).getDate();
            const prevDays = new Date(dtYear, dtMonth, 0).getDate();
            const today = new Date();

            // Previous month padding
            for (let i = firstDay - 1; i >= 0; i--) {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'dt-day other';
                btn.textContent = prevDays - i;
                btn.disabled = true;
                container.appendChild(btn);
            }
            // Current month
            for (let d = 1; d <= daysInMonth; d++) {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'dt-day';
                btn.textContent = d;
                if (d === dtDay && dtMonth === today.getMonth() && dtYear === today.getFullYear() && d === today.getDate()) {
                    btn.classList.add('today');
                } else if (d === today.getDate() && dtMonth === today.getMonth() && dtYear === today.getFullYear()) {
                    btn.classList.add('today');
                }
                const isSelected = d === dtDay;
                if (isSelected) btn.classList.add('selected');
                btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
                btn.setAttribute('aria-label', `${dtYear}年${dtMonth + 1}月${d}日`);
                btn.onclick = () => { dtDay = d; renderDtDays(); };
                container.appendChild(btn);
            }
            // Next month padding
            const totalCells = firstDay + daysInMonth;
            const remaining = (7 - totalCells % 7) % 7;
            for (let i = 1; i <= remaining; i++) {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'dt-day other';
                btn.textContent = i;
                btn.disabled = true;
                container.appendChild(btn);
            }
        }

        function dtConfirm() {
            const selectedTime = readDtTimeInput();
            dtHour = selectedTime.hour;
            dtMin = selectedTime.minute;
            const d = new Date(dtYear, dtMonth, dtDay, dtHour, dtMin);
            // Format as datetime-local value
            const pad = n => String(n).padStart(2, '0');
            const val = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            
            const prefix = getPeriodPrefix();
            document.getElementById(`${prefix}-period-${dtTarget}`).value = val;
            document.getElementById(getDtDisplayId(dtScope, dtTarget)).textContent = formatDtDisplay(val);
            closeDatePicker();
            if (dtScope === 'disclosure') {
                saveDisclosurePeriod();
            } else if (dtScope === 'waitlist') {
                updateWaitlistPromotionDeadlineDisplay();
                saveEntryPeriod();
            } else {
                saveEntryPeriod();
                updateEntryOpenStatus();
            }
        }

        function dtClear() {
            const prefix = getPeriodPrefix();
            document.getElementById(`${prefix}-period-${dtTarget}`).value = '';
            document.getElementById(getDtDisplayId(dtScope, dtTarget)).textContent = '未設定';
            closeDatePicker();
            if (dtScope === 'disclosure') {
                saveDisclosurePeriod();
            } else if (dtScope === 'waitlist') {
                updateWaitlistPromotionDeadlineDisplay();
                saveEntryPeriod();
            } else {
                saveEntryPeriod();
                updateEntryOpenStatus();
            }
        }

        window.bindDatePickerControls = function bindDatePickerControls() {
            document.querySelectorAll('[data-dt-target]').forEach((el) => {
                if (el.dataset.dtBound === 'true') return;
                el.dataset.dtBound = 'true';
                el.addEventListener('click', () => {
                    if (el.dataset.dtScope) {
                        openDatePicker(el.dataset.dtScope, el.dataset.dtTarget);
                    } else {
                        openDatePicker(el.dataset.dtTarget);
                    }
                });
            });

            document.querySelectorAll('[data-dt-nav]').forEach((el) => {
                if (el.dataset.dtBound === 'true') return;
                el.dataset.dtBound = 'true';
                el.addEventListener('click', () => dtNavMonth(Number(el.dataset.dtNav || 0)));
            });

            const closeControl = document.querySelector('[data-dt-close]');
            if (closeControl && closeControl.dataset.dtBound !== 'true') {
                closeControl.dataset.dtBound = 'true';
                closeControl.addEventListener('click', closeDatePicker);
            }

            const clearControl = document.querySelector('[data-dt-clear]');
            if (clearControl && clearControl.dataset.dtBound !== 'true') {
                clearControl.dataset.dtBound = 'true';
                clearControl.addEventListener('click', dtClear);
            }

            const confirmControl = document.querySelector('[data-dt-confirm]');
            if (confirmControl && confirmControl.dataset.dtBound !== 'true') {
                confirmControl.dataset.dtBound = 'true';
                confirmControl.addEventListener('click', dtConfirm);
            }

            const timeInput = document.getElementById('dt-picker-time-input');
            if (timeInput && timeInput.dataset.dtBound !== 'true') {
                timeInput.dataset.dtBound = 'true';
                timeInput.addEventListener('focus', () => {
                    timeInput.dataset.timeFresh = 'true';
                    timeInput.select();
                });
                timeInput.addEventListener('keydown', (event) => handleDtTimeKeydown(event));
                timeInput.addEventListener('paste', (event) => handleDtTimePaste(event));
            }

            const picker = document.getElementById('dt-picker');
            if (picker && picker.dataset.dtKeyboardBound !== 'true') {
                picker.dataset.dtKeyboardBound = 'true';
                picker.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        closeDatePicker();
                        return;
                    }
                    if (typeof trapFocusWithin === 'function') trapFocusWithin(event, picker);
                });
            }

            if (document.body.dataset.dtOutsideBound !== 'true') {
                document.body.dataset.dtOutsideBound = 'true';
                document.addEventListener('pointerdown', (event) => {
                    const picker = document.getElementById('dt-picker');
                    if (!picker || picker.hidden) return;
                    const target = event.target;
                    if (picker.contains(target) || target.closest?.('[data-dt-target]')) return;
                    closeDatePicker();
                });
            }

            if (document.body.dataset.dtResizeBound !== 'true') {
                document.body.dataset.dtResizeBound = 'true';
                window.addEventListener('resize', () => {
                    const currentPicker = document.getElementById('dt-picker');
                    if (!currentPicker || currentPicker.hidden || !dtTarget) return;
                    // ASVS 3.4.3: positioning is class-based; no CSP-blocked inline styles are created.
                    placeDatePicker(currentPicker, dtScope, dtTarget);
                    currentPicker.dataset.place = currentPicker.classList.contains('place-above') ? 'above' : 'below';
                });
            }
        };

        async function loadAdminEntries() {
            const tbody = document.getElementById('admin-entries-tbody');
            setTableMessage(tbody, 10, '読み込み中...');

            try {
                const entries = getCachedAdminEntries() || await CIQSupabaseAPI.listEntriesForAdmin(projectId);
                window._entriesRaw = Object.fromEntries(entries.map(e => [e.id, normalizeSupabaseEntry(e)]));
                entryNumbers = entries.map(e => e.entry_number || e.entryNumber).sort((a, b) => a - b);
                if (!entries.length) {
                    setTableMessage(tbody, 10, '名簿データがありません。');
                    window.setAdminEntriesCount?.(0);
                    return;
                }
                tbody.textContent = '';
                window.setAdminEntriesCount?.(entries.length);
                const privateKeyText = projectKeyStore.get();
                let privJwk = null;
                if (privateKeyText) {
                    try {
                        privJwk = JSON.parse(privateKeyText);
                    } catch (e) {
                        console.warn('復号鍵の読み込みをスキップ:', e);
                    }
                }
                const fragment = document.createDocumentFragment();
                const rowsToHydrate = [];
                for (const v of entries) {
                    const tr = document.createElement('tr');
                    if (v.status === 'canceled') tr.classList.add('member-row-canceled');
                    if (v.status === 'waitlist') tr.classList.add('member-row-waitlist');
                    appendAdminEntryRow(tr, v, null);
                    if (v.encrypted_pii) rowsToHydrate.push({ row: tr, entry: v });
                    fragment.appendChild(tr);
                    if (fragment.childNodes.length >= 20) {
                        tbody.appendChild(fragment);
                        await yieldToBrowser();
                    }
                }
                tbody.appendChild(fragment);
                if (privJwk) {
                    hydrateAdminEntryPII(rowsToHydrate, privJwk);
                } else if (window._adminPrivateKeyReadyPromise) {
                    window._adminPrivateKeyReadyPromise.then(() => {
                        const readyKeyText = projectKeyStore.get();
                        if (!readyKeyText) return null;
                        return JSON.parse(readyKeyText);
                    }).then((readyKey) => {
                        hydrateAdminEntryPII(rowsToHydrate, readyKey);
                    }).catch(e => console.warn('復号鍵の後追い読み込みをスキップ:', e));
                }
            } catch (e) {
                setTableMessage(tbody, 10, `参加者一覧を読み込めませんでした。ページを再読み込みしてください。${e.message ? ` (${e.message})` : ''}`, 'td-loading-error');
            }
        }

        function createBadge(className, iconClass, title, styles = {}) {
            const badge = document.createElement('span');
            badge.className = className;
            badge.title = title;
            Object.assign(badge.style, styles);
            const icon = createIcon(iconClass);
            badge.appendChild(icon);
            return badge;
        }

        function appendAdminEntryCell(row, content) {
            const td = document.createElement('td');
            if (content instanceof Node) {
                td.appendChild(content);
            } else {
                td.textContent = content;
            }
            row.appendChild(td);
            return td;
        }

        function appendStackedText(container, primary, secondary, emptyText = '-') {
            container.appendChild(document.createTextNode(primary || emptyText));
            if (!secondary) return;
            container.appendChild(document.createElement('br'));
            const sub = document.createElement('span');
            sub.className = 'text-muted-sm';
            sub.textContent = secondary;
            container.appendChild(sub);
        }

        function appendAdminEntryRow(row, entry, pii = null) {
            appendAdminEntryCell(row, padNum(entry.entry_number) || '-');

            const nameInfo = document.createDocumentFragment();
            const fullName = [pii?.familyName, pii?.firstName].filter(Boolean).join(' ');
            const fullKana = [pii?.familyNameKana, pii?.firstNameKana].filter(Boolean).join(' ');
            const encryptedStatus = entry.encrypted_pii
                ? (projectKeyStore.get() ? '復号不可' : '復号鍵なし')
                : '';
            appendStackedText(nameInfo, fullName, fullKana || encryptedStatus);
            appendAdminEntryCell(row, nameInfo);

            appendAdminEntryCell(row, pii?.entryName || entry.entry_name || '');
            appendAdminEntryCell(row, pii?.affiliation || entry.affiliation || '');
            appendAdminEntryCell(row, pii?.grade || entry.grade || '');

            const emailInfo = document.createDocumentFragment();
            appendStackedText(emailInfo, pii?.email || '', pii?.email ? '' : encryptedStatus);
            appendAdminEntryCell(row, emailInfo);

            const inquiry = pii?.inquiry || entry.inquiry || '';
            appendAdminEntryCell(row, inquiry || '-');

            const realNamePermission = pii?.allowRealNameInRecord === true
                ? '許可'
                : pii?.allowRealNameInRecord === false
                    ? '不許可'
                    : encryptedStatus;
            appendAdminEntryCell(row, realNamePermission);

            const statusTd = appendAdminEntryCell(row, document.createDocumentFragment());
            if (entry.status === 'canceled') {
                statusTd.appendChild(createBadge('badge danger', 'xmark', 'キャンセル'));
            } else if (entry.status === 'waitlist') {
                statusTd.appendChild(createBadge('badge', 'clock', 'キャンセル待ち', {
                    background: 'var(--warning-soft)',
                    color: 'var(--warning)',
                }));
            } else if (entry.status === 'late') {
                statusTd.appendChild(createBadge('badge', 'clock-rotate-left', '遅刻', {
                    background: 'var(--warn-100)',
                    color: 'var(--warn-600)',
                }));
            } else if (entry.checked_in) {
                statusTd.appendChild(createBadge('badge success', 'check', '受付済'));
            } else {
                statusTd.appendChild(createBadge('badge muted', 'clock', '未受付'));
            }

            const noticeTd = appendAdminEntryCell(row, document.createDocumentFragment());
            const noticeState = entry.waitlist_promotion_notice;
            if (noticeState === 'pending' || noticeState === 'sending') {
                noticeTd.appendChild(createBadge('badge', 'clock', '繰り上げ通知送信待ち', {
                    background: 'var(--surface-2)',
                    color: 'var(--ink)',
                }));
            } else if (noticeState === 'sent') {
                noticeTd.appendChild(createBadge('badge success', 'check', '繰り上げ通知送信済み'));
            } else if (noticeState === 'failed') {
                noticeTd.appendChild(createBadge('badge danger', 'triangle-exclamation', '繰り上げ通知未送信'));
            } else {
                noticeTd.textContent = '-';
            }
        }

        async function hydrateAdminEntryPII(rows, privJwk) {
            if (!privJwk || !rows.length) return;
            for (const { row, entry } of rows) {
                if (!entry.encrypted_pii) continue;
                try {
                    const pii = JSON.parse(await AppCrypto.decryptRSA(entry.encrypted_pii, privJwk));
                    row.textContent = '';
                    appendAdminEntryRow(row, entry, pii);
                    if (entry.waitlist_promotion_notice === 'pending') {
                        sendWaitlistPromotionNotice(entry, pii).catch(e => console.warn('繰り上げ通知スキップ:', e));
                    }
                } catch (e) {
                    console.warn('PII復号をスキップ:', e);
                }
                await yieldToBrowser();
            }
        }

        async function sendWaitlistPromotionNotice(entry, pii) {
            if (!entry?.id) return;
            await CIQSupabaseAPI.updateEntryNoticeState(entry.id, 'sending');
            if (!pii?.email) {
                await CIQSupabaseAPI.updateEntryNoticeState(entry.id, 'failed');
                return;
            }
            const ok = await CIQEmail.sendWaitlistPromotion(pii.email, {
                projectName: adminProjectName || projectId,
                entryNumber: String(entry.entry_number).padStart(3, '0'),
                entryId: entry.id,
                familyName: pii.familyName || '',
                firstName: pii.firstName || '',
                senderName: (adminProjectName || projectId) + ' 実行委員会'
            });
            await CIQSupabaseAPI.updateEntryNoticeState(entry.id, ok ? 'sent' : 'failed');
            if (ok) showAdminToast(`受付番号 ${padNum(entry.entry_number)} へ繰り上げ通知を送信しました`, 'success');
        }

        async function exportEntriesCSV() {
            const entriesData = window._entriesRaw || Object.fromEntries((await CIQSupabaseAPI.listEntriesForAdmin(projectId)).map(e => [e.id, normalizeSupabaseEntry(e)]));
            if (!entriesData) return;
            const rows = [['受付番号', '姓', '名', 'セイ', 'メイ', 'メールアドレス', '所属機関', '学年', 'エントリー名', '記録集本名使用', '意気込み', '連絡事項', '状態', 'UUID']];
            
            const children = Object.values(entriesData).sort((a, b) => (a.entryNumber || 0) - (b.entryNumber || 0));
            
            for (const v of children) {
                let pii = v;
                if (v.encryptedPII) {
                    try {
                        const privJwk = JSON.parse(projectKeyStore.get());
                        const jsonStr = await AppCrypto.decryptRSA(v.encryptedPII, privJwk);
                        pii = JSON.parse(jsonStr);
                    } catch(e) { console.error("Decryption failed", e); }
                }
                
                const stat = v.status === 'canceled' ? 'canceled' : v.status === 'waitlist' ? 'waitlist' : v.checkedIn ? 'checkedIn' : 'registered';
                const realNamePermission = pii.allowRealNameInRecord === true ? '許可' : pii.allowRealNameInRecord === false ? '不許可' : '';
                rows.push([
                    v.entryNumber, pii.familyName || '', pii.firstName || '', pii.familyNameKana || '', pii.firstNameKana || '',
                    pii.email || '', pii.affiliation || '', pii.grade || '', pii.entryName || '', realNamePermission, `"${(pii.message || '').replace(/"/g, '""')}"`,
                    `"${(pii.inquiry || '').replace(/"/g, '""')}"`, stat, v.uuid || v.id || ''
                ]);
            }
            const csv = rows.map(r => r.join(',')).join('\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = 'entries.csv'; a.click();
        }

        async function resetProject() {
            if (!(await showConfirm(
                'プロジェクト内の全データ（エントリー・答案・スコア）をリセットしますか？\n\n' +
                'この操作は取り消せません。\n' +
                'プロジェクト設定（パスワード・暗号鍵等）は維持されます。',
                'リセットする'
            ))) return;

            // 2段階確認
            if (!(await showConfirm(
                `プロジェクト「${projectId}」を本当にリセットしますか？\nすべてのエントリー・答案・スコアが失われます。`,
                'リセットを確定'
            ))) return;

            try {
                showAdminToast('プロジェクトをリセットしています...', 'info', 10000);

                await CIQSupabaseAPI.resetProjectData(projectId);
                showAdminToast('プロジェクトをリセットしました。ページを再読み込みします。', 'success', 3000);
                setTimeout(() => { location.reload(); }, 2000);
            } catch (e) {
                console.error('リセットエラー:', e);
                showAdminToast('リセットエラー: ' + e.message, 'error');
            }
        }

        document.getElementById('admin-entry-form')?.addEventListener('submit', submitAdminEntryForm);

        init();
