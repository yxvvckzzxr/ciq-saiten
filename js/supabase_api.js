/**
 * CIQ Supabase API adapter.
 */

const CIQSupabaseAPI = {
    _cache: new Map(),
    _imageCache: new Map(),
    _imageBitmapCache: new Map(),
    _cropUrlCache: new Map(),
    _cropPromiseCache: new Map(),
    _cropWorker: null,
    _cropWorkerAvailable: null,
    _cropWorkerRequests: new Map(),
    _cropWorkerRequestId: 0,
    _imageCacheLimit: 80,
    _imageBitmapCacheLimit: 50,
    _cropUrlCacheLimit: 400,
    _imagePerfStats: {
        cropUrlHits: 0,
        cropPromiseHits: 0,
        cropMisses: 0,
        cropErrors: 0,
        cropWorkerSuccesses: 0,
        cropWorkerFallbacks: 0,
        cropMainThreadCrops: 0,
    },
    _answerCellUrlLookupEnabled: true,
    _answerCellVersion: 'answer-cell-v1',
    _answerCellProcessingStaleMs: 10 * 60 * 1000,
    _answerCellQueue: [],
    _answerCellRunningKeys: new Set(),
    _answerCellQueuedKeys: new Set(),
    _answerCellQueueScheduled: false,
    _answerPagesCacheMs: 15000,
    _signedUrlCacheMs: 5 * 60 * 1000,

    getCachedValue(key) {
        const cached = this._cache.get(key);
        if (!cached) return null;
        if (cached.expiresAt <= Date.now()) {
            this._cache.delete(key);
            return null;
        }
        return cached.value;
    },

    setCachedValue(key, value, ttlMs) {
        this._cache.set(key, {
            value,
            expiresAt: Date.now() + Math.max(0, ttlMs),
        });
        return value;
    },

    invalidateProjectAnswerCache(projectId) {
        const prefix = `${projectId}:`;
        Array.from(this._cache.keys()).forEach(key => {
            if (String(key).startsWith(prefix)) this._cache.delete(key);
        });
    },

    clearCropUrlCache() {
        this._cropUrlCache.forEach((url) => {
            if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
        });
        this._cropUrlCache.clear();
        this._cropPromiseCache.clear();
    },

    releaseImageCaches() {
        this.clearCropUrlCache();
        this._imageBitmapCache.forEach((bitmapPromise) => {
            Promise.resolve(bitmapPromise).then(bitmap => bitmap?.close?.()).catch(() => {});
        });
        this._imageBitmapCache.clear();
        this._imageCache.clear();
    },

    getImagePerfStats() {
        return {
            ...this._imagePerfStats,
            cropUrlCacheSize: this._cropUrlCache.size,
            cropPromiseCacheSize: this._cropPromiseCache.size,
            pageImageCacheSize: this._imageCache.size,
            pageBitmapCacheSize: this._imageBitmapCache.size,
        };
    },

    takeImagePerfStats(previous = null) {
        const current = this.getImagePerfStats();
        if (!previous) return current;
        return {
            cropUrlHits: current.cropUrlHits - (previous.cropUrlHits || 0),
            cropPromiseHits: current.cropPromiseHits - (previous.cropPromiseHits || 0),
            cropMisses: current.cropMisses - (previous.cropMisses || 0),
            cropErrors: current.cropErrors - (previous.cropErrors || 0),
            cropWorkerSuccesses: current.cropWorkerSuccesses - (previous.cropWorkerSuccesses || 0),
            cropWorkerFallbacks: current.cropWorkerFallbacks - (previous.cropWorkerFallbacks || 0),
            cropMainThreadCrops: current.cropMainThreadCrops - (previous.cropMainThreadCrops || 0),
            cropUrlCacheSize: current.cropUrlCacheSize,
            cropPromiseCacheSize: current.cropPromiseCacheSize,
            pageImageCacheSize: current.pageImageCacheSize,
            pageBitmapCacheSize: current.pageBitmapCacheSize,
        };
    },

    getCropWorker() {
        if (this._cropWorkerAvailable === false) return null;
        if (this._cropWorker) return this._cropWorker;
        if (!window.Worker || !window.OffscreenCanvas || !window.OffscreenCanvas.prototype?.convertToBlob || !window.createImageBitmap) {
            this._cropWorkerAvailable = false;
            return null;
        }
        try {
            const worker = new Worker('js/image_crop_worker.js');
            worker.addEventListener('message', (event) => {
                const { id, ok, blob, error } = event.data || {};
                const request = this._cropWorkerRequests.get(id);
                if (!request) return;
                this._cropWorkerRequests.delete(id);
                if (ok && blob) {
                    request.resolve(blob);
                } else {
                    request.reject(new Error(error || 'Image crop worker failed'));
                }
            });
            worker.addEventListener('error', () => {
                this._cropWorkerAvailable = false;
                this._cropWorkerRequests.forEach(request => request.reject(new Error('Image crop worker failed')));
                this._cropWorkerRequests.clear();
                this._cropWorker?.terminate?.();
                this._cropWorker = null;
            });
            this._cropWorker = worker;
            this._cropWorkerAvailable = true;
            return worker;
        } catch (_) {
            this._cropWorkerAvailable = false;
            return null;
        }
    },

    cropImageRegionBlobInWorker(imageUrl, region, sourceWidth, quality) {
        const worker = this.getCropWorker();
        if (!worker) return null;
        const id = ++this._cropWorkerRequestId;
        const promise = new Promise((resolve, reject) => {
            this._cropWorkerRequests.set(id, { resolve, reject });
            worker.postMessage({
                id,
                payload: { imageUrl, region, sourceWidth, quality },
            });
        });
        return promise;
    },

    getConfigStatus() {
        const cfg = window.CIQ_SUPABASE_CONFIG;
        if (!cfg) return { ok: false, reason: 'missing-config' };
        if (!cfg.url || String(cfg.url).includes('YOUR_PROJECT_REF')) {
            return { ok: false, reason: 'missing-url' };
        }
        if (!cfg.publishableKey || String(cfg.publishableKey).includes('YOUR_SUPABASE_PUBLISHABLE_KEY')) {
            return { ok: false, reason: 'missing-key' };
        }
        if (!window.supabase?.createClient) {
            return { ok: false, reason: 'missing-sdk' };
        }
        if (!window.CIQSupabase?.getClient) {
            return { ok: false, reason: 'missing-client' };
        }
        return { ok: true, reason: '' };
    },

    getConfigErrorMessage() {
        const status = this.getConfigStatus();
        if (status.ok) return '';
        if (status.reason === 'missing-sdk') {
            return 'Supabase SDKを読み込めませんでした。ネットワーク接続を確認して、https://chromquiz.github.io/app/ から開き直してください。';
        }
        if (status.reason === 'missing-client') {
            return 'Supabaseクライアントを読み込めませんでした。ページを再読み込みしてください。';
        }
        return 'Supabase設定が見つかりません。js/supabase_config.js を確認してください。';
    },

    isEnabled() {
        return this.getConfigStatus().ok;
    },

    client() {
        if (!this.isEnabled()) {
            throw new Error(this.getConfigErrorMessage() || 'Supabase is not configured.');
        }
        return window.CIQSupabase.getClient();
    },

    async getSession() {
        const { data, error } = await this.client().auth.getSession();
        if (error) throw error;
        return data.session;
    },

    onAuthStateChange(callback) {
        return this.client().auth.onAuthStateChange((_event, session) => callback(session));
    },

    async signInWithGoogle() {
        let redirectTo;
        if (location.protocol !== 'file:') {
            const redirectUrl = new URL('/app/', location.origin);
            redirectTo = redirectUrl.href;
        }
        const { error } = await this.client().auth.signInWithOAuth({
            provider: 'google',
            options: redirectTo ? { redirectTo } : undefined,
        });
        if (error) throw error;
    },

    async signOut() {
        const { error } = await this.client().auth.signOut();
        if (error) throw error;
    },

    async invokePublicFunction(name, payload) {
        const cfg = window.CIQ_SUPABASE_CONFIG;
        const res = await fetch(`${cfg.url.replace(/\/$/, '')}/functions/v1/${name}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                apikey: cfg.publishableKey,
                authorization: `Bearer ${cfg.publishableKey}`,
            },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const error = new Error(data?.error || `${name} failed`);
            error.status = res.status;
            error.functionName = name;
            throw error;
        }
        return data;
    },

    async invokeAuthedFunction(name, payload) {
        const cfg = window.CIQ_SUPABASE_CONFIG;
        const session = await this.getSession();
        if (!session?.access_token) throw new Error('Googleログインが必要です。');
        const res = await fetch(`${cfg.url.replace(/\/$/, '')}/functions/v1/${name}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                apikey: cfg.publishableKey,
                authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const error = new Error(data?.error || `${name} failed`);
            error.status = res.status;
            error.functionName = name;
            throw error;
        }
        return data;
    },

    async getPublicSettings(projectId) {
        const { data, error } = await this.client()
            .from('public_project_settings')
            .select('project_id, project_name, rsa_public_key, entry_open, period_start, period_end, max_entries, disclosure_enabled, disclosure_period_start, disclosure_period_end, terms, notify_entry_edit, notify_entry_cancel, notify_late_notice')
            .eq('project_id', projectId)
            .single();

        if (error) throw error;
        if (!data) return null;

        return {
            projectName: data.project_name,
            publicKey: data.rsa_public_key,
            entryOpen: data.entry_open,
            periodStart: data.period_start,
            periodEnd: data.period_end,
            maxEntries: data.max_entries || 0,
            disclosureOpen: data.disclosure_enabled,
            disclosurePeriodStart: data.disclosure_period_start,
            disclosurePeriodEnd: data.disclosure_period_end,
            terms: data.terms,
            notifyEntryEdit: data.notify_entry_edit !== false,
            notifyEntryCancel: data.notify_entry_cancel !== false,
            notifyLateNotice: data.notify_late_notice !== false,
        };
    },

    mapPublicEntry(row) {
        return {
            // entry UUID は公開しない(V7: 受付QR偽造の材料になるため列権限で非公開)
            entryNumber: row.entry_number,
            entryName: row.entry_name,
            affiliation: row.affiliation,
            grade: row.grade,
            message: row.message,
            isChubu: row.is_chubu,
            status: row.status,
            checkedIn: row.checked_in,
            timestamp: row.created_at ? new Date(row.created_at).getTime() : 0,
        };
    },

    async getPublicEntries(projectId) {
        const { data, error } = await this.client()
            .from('public_entry_list')
            .select('entry_number, entry_name, affiliation, grade, message, is_chubu, status, checked_in, created_at')
            .eq('project_id', projectId)
            .order('created_at', { ascending: true })
            .order('entry_number', { ascending: true });

        if (error) throw error;

        const entries = {};
        for (const row of data || []) {
            entries[row.entry_number] = this.mapPublicEntry(row);
        }
        return entries;
    },

    subscribePublicEntries(projectId, callback, onError = null) {
        const client = this.client();
        let active = true;

        this.getPublicEntries(projectId).then((entries) => {
            if (active) callback(entries);
        }).catch((error) => {
            console.error('Supabase public entry list load error:', error);
            if (active && onError) onError(error);
        });

        const channel = client
            .channel(`public-entry-list:${projectId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'public_entry_list',
                    filter: `project_id=eq.${projectId}`,
                },
                async () => {
                    try {
                        const entries = await this.getPublicEntries(projectId);
                        if (active) callback(entries);
                    } catch (error) {
                        console.error('Supabase public entry list refresh error:', error);
                        if (active && onError) onError(error);
                    }
                }
            )
            .subscribe();

        return {
            stop() {
                active = false;
                client.removeChannel(channel);
            },
        };
    },

    async createEntry(payload) {
        const data = await this.invokePublicFunction('create-entry', payload);
        if (!data?.ok) throw new Error(data?.error || 'Entry failed');
        return data.entry;
    },

    async adminCreateEntry(payload) {
        let data;
        try {
            data = await this.invokeAuthedFunction('admin-create-entry', payload);
        } catch (error) {
            const message = String(error.message || '');
            if (error.status !== 401 && !message.includes('Googleログイン')) throw error;
            data = await this.invokePublicFunction('create-entry', payload);
        }
        if (!data?.ok) throw new Error(data?.error || 'Entry failed');
        return data.entry;
    },

    async getAdminEntryQrSvg(projectId, entryId) {
        const data = await this.invokeAuthedFunction('admin-entry-qr', { projectId, entryId });
        if (!data?.ok || !data.svg) throw new Error(data?.error || 'QR code failed');
        return data.svg;
    },

    async cancelEntry(payload) {
        const normalizedPayload = payload?.token
            ? { ...payload, token: String(payload.token) }
            : payload;
        const data = await this.invokePublicFunction('cancel-entry', normalizedPayload);
        if (!data?.ok) throw new Error(data?.error || 'Cancel failed');
        return data;
    },

    async discloseResult(payload) {
        const normalizedPayload = payload?.token
            ? { ...payload, token: String(payload.token) }
            : payload;
        const data = await this.invokePublicFunction('disclose-result', normalizedPayload);
        if (!data?.ok) throw new Error(data?.error || 'Disclosure failed');
        return data;
    },

    async editEntry(payload) {
        const data = await this.invokePublicFunction('edit-entry', payload);
        if (!data?.ok) throw new Error(data?.error || 'Edit failed');
        return data;
    },

    async markLate(payload) {
        const data = await this.invokePublicFunction('mark-late', payload);
        if (!data?.ok) throw new Error(data?.error || 'Late report failed');
        return data;
    },

    // マイエントリー(my.html): 認証 + サマリー + QR + セッショントークン
    async myEntry(payload) {
        const data = await this.invokePublicFunction('my-entry', payload);
        if (!data?.ok) throw new Error(data?.error || 'My entry failed');
        return data;
    },

    async getCheckInStats(projectId) {
        const data = await this.invokeAuthedFunction('check-in', {
            action: 'stats',
            projectId,
        });
        if (!data?.ok) throw new Error(data?.error || 'Check-in stats failed');
        return data.stats;
    },

    // QR(署名付きトークン)で受付する。素の entry UUID はサーバ側で拒否される(V7)。
    async checkInEntry(projectId, qr) {
        const data = await this.invokeAuthedFunction('check-in', {
            action: 'check',
            projectId,
            qr,
        });
        if (!data?.ok) throw new Error(data?.error || 'Check-in failed');
        return data;
    },

    // 受付番号で照会する(状態は変えない)。QRが読めないときの運用フォールバックの第一段階で、
    // 運営が氏名・所属を目視確認するために使う。運営専用ページからのみ呼ぶ(サーバ側も owner/admin 限定)。
    async lookupEntryByNumber(projectId, entryNumber) {
        const data = await this.invokeAuthedFunction('check-in', {
            action: 'lookup',
            projectId,
            entryNumber,
        });
        if (!data?.ok) throw new Error(data?.error || 'Lookup failed');
        return data.entry;
    },

    // 手入力での受付確定。lookupEntryByNumber で得た id を必ず添える(照会を経ない確定を防ぐ)。
    async checkInEntryManually(projectId, entryNumber, confirmedEntryId) {
        const data = await this.invokeAuthedFunction('check-in', {
            action: 'check_manual',
            projectId,
            entryNumber,
            confirmedEntryId,
        });
        if (!data?.ok) throw new Error(data?.error || 'Check-in failed');
        return data;
    },

    // 受付の取り消し。誤受付を当日中に戻すための運営操作で、サーバ側で監査ログに残る。
    async undoCheckIn(projectId, entryNumber, confirmedEntryId) {
        const data = await this.invokeAuthedFunction('check-in', {
            action: 'undo',
            projectId,
            entryNumber,
            confirmedEntryId,
        });
        if (!data?.ok) throw new Error(data?.error || 'Undo failed');
        return data;
    },

    // ---- 採点者招待リンク(AB-1) ----

    // 招待リンクを発行する。平文トークンはこの応答でのみ返る(DBには保存されない)。
    async createScorerInvite(projectId, maxUses) {
        const data = await this.invokeAuthedFunction('create-scorer-invite', { projectId, maxUses });
        if (!data?.ok || !data.invite?.token) throw new Error(data?.error || '招待リンクを発行できませんでした。');
        return data.invite;
    },

    // 招待リンクを引き換えて採点者として参加する。
    async redeemScorerInvite(token) {
        const data = await this.invokeAuthedFunction('redeem-scorer-invite', { token });
        if (!data?.ok) throw new Error(data?.error || '参加できませんでした。');
        return data;
    },

    // 招待一覧(token_hash は列権限で除外されているため取得できない)。
    async listScorerInvites(projectId) {
        const { data, error } = await this.client()
            .from('project_invites')
            .select('id, max_uses, use_count, expires_at, revoked_at, created_at')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async revokeScorerInvite(inviteId) {
        const { data, error } = await this.client()
            .rpc('revoke_scorer_invite', { p_invite_id: inviteId })
            .single();
        if (error) throw error;
        return data;
    },

    async storeProjectPrivateKey(projectId, privateKeyJwk) {
        const data = await this.invokeAuthedFunction('project-key', {
            action: 'store',
            projectId,
            privateKeyJwk,
        });
        if (!data?.ok) throw new Error(data?.error || 'Project key store failed');
        return data;
    },

    async fetchProjectPrivateKey(projectId) {
        const data = await this.invokeAuthedFunction('project-key', {
            action: 'fetch',
            projectId,
        });
        if (!data?.ok || !data.privateKeyJwk) throw new Error(data?.error || 'Project key fetch failed');
        return data.privateKeyJwk;
    },

    async createProjectWithOwner(payload) {
        const { data, error } = await this.client()
            .rpc('create_project_with_owner', {
                p_project_id: payload.projectId,
                p_name: payload.name,
                p_rsa_public_key: payload.publicKey,
                p_rsa_private_key_encrypted: payload.encryptedPrivateKey,
                p_owner_display_name: payload.ownerDisplayName,
            })
            .single();
        if (error) {
            if (error.code === '23505') throw new Error(`プロジェクト "${payload.projectId}" は既に存在します。別の回数を指定してください。`);
            throw error;
        }
        return data;
    },


    async listMyProjects() {
        const { data, error } = await this.client()
            .from('projects')
            .select(`
                id,
                name,
                updated_at,
                project_members!project_members_project_id_fkey!inner(role, display_name, status)
            `)
            .eq('project_members.status', 'active')
            .order('updated_at', { ascending: false });
        if (error) throw error;
        return (data || []).map((project) => ({
            id: project.id,
            name: project.name,
            updatedAt: project.updated_at,
            role: project.project_members?.[0]?.role || '',
            displayName: project.project_members?.[0]?.display_name || '',
        }));
    },

    async listProjectMembers(projectId) {
        const { data, error } = await this.client()
            .from('project_members')
            .select('id, user_id, invited_email, role, display_name, status, created_at')
            .eq('project_id', projectId)
            .order('status', { ascending: true })
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async updateProjectMemberRole(memberId, role) {
        const { data, error } = await this.client()
            .rpc('update_project_member_role', {
                p_member_id: memberId,
                p_role: role,
            })
            .single();
        if (error) throw error;
        return data;
    },

    async removeProjectMember(memberId) {
        const { data, error } = await this.client()
            .rpc('remove_project_member', { p_member_id: memberId })
            .single();
        if (error) throw error;
        return data;
    },

    async restoreProjectMember(memberId) {
        const { data, error } = await this.client()
            .rpc('restore_project_member', { p_member_id: memberId })
            .single();
        if (error) throw error;
        return data;
    },

    async getProject(projectId) {
        const { data, error } = await this.client()
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .single();
        if (error) throw error;
        return data;
    },

    async updateProject(projectId, patch) {
        const { data, error } = await this.client()
            .from('projects')
            .update(patch)
            .eq('id', projectId)
            .select('*')
            .single();
        if (error) throw error;
        return data;
    },

    async listEntriesForAdmin(projectId) {
        const { data, error } = await this.client()
            .rpc('list_entries_for_admin', { p_project_id: projectId });
        if (error) {
            const message = error.message || String(error);
            const isMissingRpc = error.code === 'PGRST202'
                || message.includes('Could not find the function')
                || message.includes('schema cache');
            if (!isMissingRpc) throw error;

            console.warn('[CIQ upload debug] listEntriesForAdmin:fallbackDirectSelect', {
                projectId,
                code: error.code || null,
                message,
            });
            const { data: fallbackData, error: fallbackError } = await this.client()
                .from('entries')
                .select('id, project_id, entry_number, entry_name, affiliation, grade, message, is_chubu, status, checked_in, created_at, updated_at, waitlist_promoted_at, waitlist_promotion_notice')
                .eq('project_id', projectId)
                .order('entry_number', { ascending: true });
            if (fallbackError) throw fallbackError;
            return fallbackData || [];
        }
        return data || [];
    },

    async updateEntryNoticeState(entryId, noticeState) {
        const { data, error } = await this.client()
            .from('entries')
            .update({ waitlist_promotion_notice: noticeState })
            .eq('id', entryId)
            .select('id, waitlist_promotion_notice')
            .single();
        if (error) throw error;
        return data;
    },

    async listModelAnswers(projectId) {
        const { data, error } = await this.client()
            .from('model_answers')
            .select('question_number, answer')
            .eq('project_id', projectId)
            .order('question_number', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async saveModelAnswers(projectId, answers) {
        const client = this.client();
        const { error: deleteError } = await client
            .from('model_answers')
            .delete()
            .eq('project_id', projectId);
        if (deleteError) throw deleteError;

        const rows = (answers || [])
            .map((answer, index) => ({
                project_id: projectId,
                question_number: index + 1,
                answer: String(answer || '').trim(),
            }))
            .filter(row => row.answer);

        if (rows.length === 0) return [];
        const { data, error } = await client
            .from('model_answers')
            .upsert(rows, { onConflict: 'project_id,question_number' })
            .select('question_number, answer');
        if (error) throw error;
        return data || [];
    },

    dataUrlToBlob(dataUrl) {
        const [meta, data] = String(dataUrl).split(',');
        const mime = meta.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream';
        const binary = atob(data || '');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    },

    toUploadBlob(source, fallbackType = 'image/webp') {
        if (source instanceof Blob) return source;
        if (typeof source === 'string' && source.startsWith('data:')) return this.dataUrlToBlob(source);
        throw new Error('Invalid upload image data');
    },

    createEmptyCellGeneration(status = 'not_started') {
        return {
            version: this._answerCellVersion,
            status,
            startedAt: null,
            generatedAt: null,
            failedAt: null,
            questions: {},
        };
    },

    normalizeCellsForSave(cells, pageWidth) {
        return {
            regions: cells || {},
            pageWidth: pageWidth || null,
            cellGeneration: this.createEmptyCellGeneration('not_started'),
        };
    },

    normalizeAnswerCellGeneration(cells) {
        const generation = cells?.cellGeneration || {};
        return {
            ...this.createEmptyCellGeneration(generation.status || 'not_started'),
            ...generation,
            questions: {
                ...(generation.questions || {}),
            },
        };
    },

    getAnswerCellPath(projectId, entryNumber, questionNumber) {
        return `${projectId}/${entryNumber}/q${questionNumber}.webp`;
    },

    getCellStatus(cells, questionNumber) {
        const generation = this.normalizeAnswerCellGeneration(cells);
        if (generation.version !== this._answerCellVersion) return null;
        return generation.questions?.[`q${questionNumber}`] === 'ready' ? 'ready' : null;
    },

    buildCellGenerationPatch(questionStatuses, totalQuestions = 0, base = {}) {
        const questions = { ...(base.questions || {}), ...(questionStatuses || {}) };
        const keys = Object.keys(questions);
        const readyCount = keys.filter(key => questions[key] === 'ready').length;
        const failedCount = keys.filter(key => questions[key] === 'failed').length;
        const now = new Date().toISOString();
        let status = 'not_started';
        if (totalQuestions && readyCount >= totalQuestions) status = 'complete';
        else if (keys.length && failedCount === keys.length) status = 'failed';
        else if (readyCount || failedCount) status = 'partial';
        return {
            version: this._answerCellVersion,
            status,
            startedAt: base.startedAt || null,
            generatedAt: status === 'complete' ? now : null,
            failedAt: status === 'failed' ? now : null,
            questions,
        };
    },

    isCellGenerationStale(generation) {
        if (!generation?.startedAt) return false;
        const startedAt = Date.parse(generation.startedAt);
        return Number.isFinite(startedAt) && Date.now() - startedAt > this._answerCellProcessingStaleMs;
    },

    async uploadAnswerPage(projectId, entryNumber, pageImage, cells, pageWidth, knownEntry = null) {
        const entry = knownEntry?.id ? knownEntry : await this.findEntryByNumber(projectId, entryNumber);
        if (!entry) throw new Error(`受付番号 ${entryNumber} の参加者が見つかりません。`);

        const pagePath = `${projectId}/${entryNumber}/page.webp`;
        await this.uploadAnswerPageImage(projectId, entryNumber, pageImage);

        const { data, error } = await this.client()
            .from('answer_pages')
            .upsert({
                project_id: projectId,
                entry_id: entry.id,
                storage_path: pagePath,
                cells: this.normalizeCellsForSave(cells, pageWidth),
            }, { onConflict: 'project_id,entry_id' })
            .select('id, project_id, entry_id, storage_path, cells, uploaded_at')
            .single();
        if (error) throw error;
        this.invalidateProjectAnswerCache(projectId);
        return data;
    },

    async uploadAnswerPageImage(projectId, entryNumber, pageImage) {
        const pagePath = `${projectId}/${entryNumber}/page.webp`;
        const pageBlob = this.toUploadBlob(pageImage, 'image/webp');
        const { error } = await this.client()
            .storage
            .from('answer-pages')
            .upload(pagePath, pageBlob, {
                contentType: pageBlob.type || 'image/webp',
                upsert: true,
            });
        if (error) throw error;
        return pagePath;
    },

    async upsertAnswerPages(projectId, records) {
        const rows = (records || [])
            .filter(record => record?.entryId && record?.storagePath)
            .map(record => ({
                project_id: projectId,
                entry_id: record.entryId,
                storage_path: record.storagePath,
                cells: this.normalizeCellsForSave(record.cells, record.pageWidth),
            }));
        if (!rows.length) return [];

        const results = [];
        for (let i = 0; i < rows.length; i += 100) {
            const { data, error } = await this.client()
                .from('answer_pages')
                .upsert(rows.slice(i, i + 100), { onConflict: 'project_id,entry_id' })
                .select('id, project_id, entry_id, storage_path, cells, uploaded_at');
            if (error) throw error;
            results.push(...(data || []));
        }
        this.invalidateProjectAnswerCache(projectId);
        return results;
    },

    async deleteAnswerPageStoragePaths(paths) {
        const uniquePaths = Array.from(new Set((paths || []).filter(Boolean)));
        if (!uniquePaths.length) return;
        const { error } = await this.client().storage.from('answer-pages').remove(uniquePaths);
        if (error) throw error;
    },

    async uploadAnswerCell(projectId, entryNumber, questionNumber, cellDataUrl, invalidateCache = true) {
        const blob = this.dataUrlToBlob(cellDataUrl);
        return this.uploadAnswerCellBlob(projectId, entryNumber, questionNumber, blob, invalidateCache);
    },

    async uploadAnswerCellBlob(projectId, entryNumber, questionNumber, blob, invalidateCache = true) {
        const path = this.getAnswerCellPath(projectId, entryNumber, questionNumber);
        const { error } = await this.client()
            .storage
            .from('answer-cells')
            .upload(path, blob, {
                contentType: blob.type || 'image/webp',
                upsert: true,
            });
        if (error) throw error;
        if (invalidateCache) this.invalidateProjectAnswerCache(projectId);
        return path;
    },

    async updateAnswerCellGeneration(projectId, entryId, patch) {
        if (!projectId || !entryId) throw new Error('Missing answer page identity');
        const { data: current, error: readError } = await this.client()
            .from('answer_pages')
            .select('cells')
            .eq('project_id', projectId)
            .eq('entry_id', entryId)
            .single();
        if (readError) throw readError;

        const cells = current?.cells || {};
        const previous = this.normalizeAnswerCellGeneration(cells);
        const nextGeneration = {
            ...previous,
            ...(patch || {}),
            questions: {
                ...(previous.questions || {}),
                ...((patch || {}).questions || {}),
            },
        };
        const nextCells = {
            ...cells,
            cellGeneration: nextGeneration,
        };
        const { data, error } = await this.client()
            .from('answer_pages')
            .update({ cells: nextCells })
            .eq('project_id', projectId)
            .eq('entry_id', entryId)
            .select('id, project_id, entry_id, storage_path, cells, uploaded_at')
            .single();
        if (error) throw error;
        this.invalidateProjectAnswerCache(projectId);
        return data;
    },

    async markAnswerCellFailed(projectId, entryId, questionNumber) {
        try {
            await this.updateAnswerCellGeneration(projectId, entryId, {
                version: this._answerCellVersion,
                status: 'partial',
                failedAt: new Date().toISOString(),
                questions: { [`q${questionNumber}`]: 'failed' },
            });
        } catch (error) {
            console.warn('Answer cell failure mark skipped:', error);
        }
    },

    async findEntryByNumber(projectId, entryNumber) {
        const { data, error } = await this.client()
            .from('entries')
            .select('id, entry_number, entry_name, affiliation, grade, status, checked_in')
            .eq('project_id', projectId)
            .eq('entry_number', entryNumber)
            .single();
        if (error) {
            if (error.code === 'PGRST116') {
                console.warn('[CIQ upload debug] findEntryByNumber:notFound', { projectId, entryNumber });
                return null;
            }
            console.warn('[CIQ upload debug] findEntryByNumber:error', {
                projectId,
                entryNumber,
                code: error.code || null,
                message: error.message || String(error),
            });
            throw error;
        }
        return data;
    },

    async listAnswerPages(projectId) {
        const cacheKey = `${projectId}:answer-pages`;
        const cached = this.getCachedValue(cacheKey);
        if (cached) return cached;

        const { data, error } = await this.client()
            .from('answer_pages')
            .select(`
                id,
                entry_id,
                storage_path,
                cells,
                uploaded_at,
                entries!inner(entry_number, entry_name, affiliation, grade)
            `)
            .eq('project_id', projectId);
        if (error) throw error;
        const pages = (data || []).sort((a, b) => Number(a.entries?.entry_number || 0) - Number(b.entries?.entry_number || 0));
        return this.setCachedValue(cacheKey, pages, this._answerPagesCacheMs);
    },

    async getAnswerPageByEntryNumber(projectId, entryNumber) {
        const entry = await this.findEntryByNumber(projectId, entryNumber);
        if (!entry) return null;
        const { data, error } = await this.client()
            .from('answer_pages')
            .select('id, storage_path, cells, uploaded_at')
            .eq('project_id', projectId)
            .eq('entry_id', entry.id)
            .single();
        if (error) {
            if (error.code === 'PGRST116') return null;
            throw error;
        }
        return { ...data, entry };
    },

    async getAnswerPageUrl(storagePath, expiresIn = 3600) {
        const { data, error } = await this.client()
            .storage
            .from('answer-pages')
            .createSignedUrl(storagePath, expiresIn);
        if (error) throw error;
        return data.signedUrl;
    },

    async getAnswerPageUrls(projectId, requests, expiresIn = 3600) {
        const normalized = (requests || [])
            .map((request) => ({
                key: request.key,
                path: request.storagePath,
            }))
            .filter(request => request.key && request.path);
        if (!normalized.length) return {};

        const signedUrls = {};
        const missing = [];
        const ttlMs = Math.min(this._signedUrlCacheMs, Math.max(0, expiresIn * 1000 - 60000));
        for (const request of normalized) {
            const cacheKey = `${projectId}:answer-page-url:${request.path}`;
            const cachedUrl = this.getCachedValue(cacheKey);
            if (cachedUrl) {
                signedUrls[request.key] = cachedUrl;
            } else {
                missing.push({ ...request, cacheKey });
            }
        }
        if (!missing.length) return signedUrls;

        const { data, error } = await this.client()
            .storage
            .from('answer-pages')
            .createSignedUrls(missing.map(request => request.path), expiresIn);
        if (error) throw error;

        (data || []).forEach((item, index) => {
            const request = missing[index];
            if (!request) return;
            if (item?.error) return;
            const signedUrl = item?.signedUrl || item?.signed_url || '';
            signedUrls[request.key] = signedUrl;
            if (signedUrl && ttlMs > 0) this.setCachedValue(request.cacheKey, signedUrl, ttlMs);
        });

        return signedUrls;
    },

    async getAnswerCellUrl(projectId, entryNumber, questionNumber, expiresIn = 3600) {
        const path = `${projectId}/${entryNumber}/q${questionNumber}.webp`;
        const { data, error } = await this.client()
            .storage
            .from('answer-cells')
            .createSignedUrl(path, expiresIn);
        if (error) throw error;
        return data.signedUrl;
    },

    async getAnswerCellUrls(projectId, requests, expiresIn = 3600) {
        if (!this._answerCellUrlLookupEnabled) return {};
        const normalized = (requests || [])
            .map((request) => ({
                key: request.key,
                path: request.cellPath || this.getAnswerCellPath(projectId, request.entryNumber, request.questionNumber),
            }))
            .filter(request => request.key && request.path);
        if (!normalized.length) return {};

        const signedUrls = {};
        const missing = [];
        const ttlMs = Math.min(this._signedUrlCacheMs, Math.max(0, expiresIn * 1000 - 60000));
        for (const request of normalized) {
            const cacheKey = `${projectId}:answer-cell-url:${request.path}`;
            const cachedUrl = this.getCachedValue(cacheKey);
            if (cachedUrl) {
                signedUrls[request.key] = cachedUrl;
            } else {
                missing.push({ ...request, cacheKey });
            }
        }
        if (!missing.length) return signedUrls;

        const { data, error } = await this.client()
            .storage
            .from('answer-cells')
            .createSignedUrls(missing.map(request => request.path), expiresIn);
        if (error) throw error;

        (data || []).forEach((item, index) => {
            const request = missing[index];
            if (!request) return;
            if (item?.error) return;
            const signedUrl = item?.signedUrl || item?.signed_url || '';
            signedUrls[request.key] = signedUrl;
            if (signedUrl && ttlMs > 0) this.setCachedValue(request.cacheKey, signedUrl, ttlMs);
        });

        return signedUrls;
    },

    async deleteAnswerPage(projectId, entryNumber) {
        const page = await this.getAnswerPageByEntryNumber(projectId, entryNumber);
        if (!page) return;
        this.invalidateProjectAnswerCache(projectId);
        const cellPaths = Object.keys(page.cells?.regions || {}).map(key => {
            const q = String(key).replace(/^q/, '');
            return `${projectId}/${entryNumber}/q${q}.webp`;
        });
        await this.client().storage.from('answer-pages').remove([page.storage_path]);
        if (cellPaths.length) await this.client().storage.from('answer-cells').remove(cellPaths);
        const { error } = await this.client()
            .from('answer_pages')
            .delete()
            .eq('id', page.id);
        if (error) throw error;
    },

    async getQuestionAnswerCards(projectId, questionNumber) {
        try {
            const { data, error } = await this.client()
                .rpc('list_question_answer_cards', {
                    p_project_id: projectId,
                    p_question_number: questionNumber,
                });
            if (error) throw error;
            return (data || [])
                .map((row) => {
                    const entryNumber = Number(row.entry_number);
                    return {
                        entryId: row.entry_id,
                        entryNumber,
                        displayName: row.entry_name || `No.${String(entryNumber).padStart(3, '0')}`,
                        affiliation: row.affiliation || '',
                        grade: row.grade || '',
                        pageUrl: null,
                        cellUrl: null,
                        storagePath: row.storage_path || null,
                        pageWidth: Number(row.page_width || 0) || null,
                        cellRegion: row.cell_region || null,
                        cellStatus: row.cell_status || null,
                        cellPath: row.cell_path || null,
                        cellGenerationVersion: row.cell_generation_version || null,
                    };
                })
                .filter(card => card.entryId && card.entryNumber);
        } catch (error) {
            console.warn('Question answer card RPC unavailable; falling back to answer_pages list.', error);
        }

        const pages = await this.listAnswerPages(projectId);
        const cards = pages.map((page) => {
            const entry = page.entries || {};
            const entryNumber = Number(entry.entry_number);
            const cellRegion = page.cells?.regions?.[`q${questionNumber}`] || null;
            const cellStatus = this.getCellStatus(page.cells, questionNumber);
            return {
                entryId: page.entry_id,
                entryNumber,
                displayName: entry.entry_name || `No.${String(entryNumber).padStart(3, '0')}`,
                affiliation: entry.affiliation || '',
                grade: entry.grade || '',
                pageUrl: null,
                cellUrl: null,
                storagePath: page.storage_path || null,
                pageWidth: Number(page.cells?.pageWidth || 0) || null,
                cellRegion,
                cellStatus,
                cellPath: cellStatus === 'ready' ? this.getAnswerCellPath(projectId, entryNumber, questionNumber) : null,
                cellGenerationVersion: page.cells?.cellGeneration?.version || null,
            };
        });
        return cards.filter(card => card.entryId && card.entryNumber).sort((a, b) => a.entryNumber - b.entryNumber);
    },

    loadCachedImage(imageUrl) {
        const cached = this._imageCache.get(imageUrl);
        if (cached) return cached;

        const promise = new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.decoding = 'async';
            image.onload = () => resolve(image);
            image.onerror = () => {
                this._imageCache.delete(imageUrl);
                reject(new Error('Image load failed'));
            };
            image.src = imageUrl;
        });

        this._imageCache.set(imageUrl, promise);
        while (this._imageCache.size > this._imageCacheLimit) {
            const oldestKey = this._imageCache.keys().next().value;
            this._imageCache.delete(oldestKey);
        }
        return promise;
    },

    loadCachedImageBitmap(imageUrl) {
        if (!window.createImageBitmap || !window.fetch) return null;
        const cached = this._imageBitmapCache.get(imageUrl);
        if (cached) return cached;

        const promise = fetch(imageUrl, { credentials: 'omit' })
            .then((response) => {
                if (!response.ok) throw new Error('Image fetch failed');
                return response.blob();
            })
            .then(blob => createImageBitmap(blob))
            .catch((error) => {
                this._imageBitmapCache.delete(imageUrl);
                throw error;
            });

        this._imageBitmapCache.set(imageUrl, promise);
        while (this._imageBitmapCache.size > this._imageBitmapCacheLimit) {
            const oldestKey = this._imageBitmapCache.keys().next().value;
            const oldest = this._imageBitmapCache.get(oldestKey);
            this._imageBitmapCache.delete(oldestKey);
            Promise.resolve(oldest).then(bitmap => bitmap?.close?.()).catch(() => {});
        }
        return promise;
    },

    canvasToObjectUrl(canvas, type = 'image/webp', quality = 0.64) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Image encode failed'));
                    return;
                }
                resolve(URL.createObjectURL(blob));
            }, type, quality);
        });
    },

    canvasToBlob(canvas, type = 'image/webp', quality = 0.64) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Image encode failed'));
                    return;
                }
                resolve(blob);
            }, type, quality);
        });
    },

    async cropImageRegionBlobOnMainThread(imageUrl, region, sourceWidth, quality = 0.64) {
        let image = null;
        try {
            image = await (this.loadCachedImageBitmap(imageUrl) || Promise.reject(new Error('ImageBitmap unavailable')));
        } catch (_) {
            image = await this.loadCachedImage(imageUrl);
        }
        const imageWidth = image.naturalWidth || image.width;
        const imageHeight = image.naturalHeight || image.height;
        const scale = sourceWidth ? imageWidth / sourceWidth : 1;
        const x = Math.max(0, Math.round(Number(region.x || 0) * scale));
        const y = Math.max(0, Math.round(Number(region.y || 0) * scale));
        const w = Math.max(1, Math.round(Number(region.w || 1) * scale));
        const h = Math.max(1, Math.round(Number(region.h || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(w, Math.max(1, imageWidth - x));
        canvas.height = Math.min(h, Math.max(1, imageHeight - y));
        canvas.getContext('2d').drawImage(image, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        const blob = await this.canvasToBlob(canvas, 'image/webp', quality);
        canvas.width = 0;
        canvas.height = 0;
        return blob;
    },

    async cropImageRegionOnMainThread(imageUrl, region, sourceWidth, quality = 0.64) {
        const blob = await this.cropImageRegionBlobOnMainThread(imageUrl, region, sourceWidth, quality);
        return URL.createObjectURL(blob);
    },

    async cropImageRegionBlob(imageUrl, region, sourceWidth, quality = 0.64) {
        if (!imageUrl || !region) throw new Error('Missing image region');
        const workerCrop = this.cropImageRegionBlobInWorker(imageUrl, region, sourceWidth, quality);
        if (workerCrop) {
            try {
                const blob = await workerCrop;
                this._imagePerfStats.cropWorkerSuccesses++;
                return blob;
            } catch (_) {
                this._imagePerfStats.cropWorkerFallbacks++;
                // Fall back to the main thread below.
            }
        } else {
            this._imagePerfStats.cropWorkerFallbacks++;
        }
        this._imagePerfStats.cropMainThreadCrops++;
        return this.cropImageRegionBlobOnMainThread(imageUrl, region, sourceWidth, quality);
    },

    rememberCropUrl(cropKey, objectUrl) {
        this._cropUrlCache.set(cropKey, objectUrl);
        while (this._cropUrlCache.size > this._cropUrlCacheLimit) {
            const oldestKey = this._cropUrlCache.keys().next().value;
            const oldestUrl = this._cropUrlCache.get(oldestKey);
            this._cropUrlCache.delete(oldestKey);
            if (typeof oldestUrl === 'string' && oldestUrl.startsWith('blob:')) URL.revokeObjectURL(oldestUrl);
        }
        return objectUrl;
    },

    cropImageRegion(imageUrl, region, sourceWidth, quality = 0.64) {
        if (!imageUrl || !region) return Promise.reject(new Error('Missing image region'));
        const cropKey = [
            imageUrl,
            Number(region.x || 0),
            Number(region.y || 0),
            Number(region.w || 1),
            Number(region.h || 1),
            Number(sourceWidth || 0),
            quality,
        ].join(':');
        const cachedUrl = this._cropUrlCache.get(cropKey);
        if (cachedUrl) {
            this._imagePerfStats.cropUrlHits++;
            return Promise.resolve(cachedUrl);
        }
        const pending = this._cropPromiseCache.get(cropKey);
        if (pending) {
            this._imagePerfStats.cropPromiseHits++;
            return pending;
        }
        this._imagePerfStats.cropMisses++;

        const promise = new Promise(async (resolve, reject) => {
            try {
                let objectUrl = null;
                const blob = await this.cropImageRegionBlob(imageUrl, region, sourceWidth, quality);
                objectUrl = URL.createObjectURL(blob);
                resolve(this.rememberCropUrl(cropKey, objectUrl));
            } catch (error) {
                this._imagePerfStats.cropErrors++;
                reject(error);
            }
        });
        this._cropPromiseCache.set(cropKey, promise);
        promise.finally(() => this._cropPromiseCache.delete(cropKey));
        return promise;
    },

    shouldGenerateAnswerCells(page) {
        const cells = page?.cells || {};
        const regions = cells.regions || page?.cellRegions || {};
        const generation = this.normalizeAnswerCellGeneration(cells);
        const questionKeys = Object.keys(regions).filter(key => regions[key]);
        if (!questionKeys.length) return false;
        if (generation.version !== this._answerCellVersion) return true;
        const hasMissingQuestion = questionKeys.some(key => generation.questions?.[key] !== 'ready');
        if (!hasMissingQuestion) return false;
        if (generation.status === 'not_started' || generation.status === 'partial' || generation.status === 'failed') return true;
        if (generation.status === 'processing' && this.isCellGenerationStale(generation)) return true;
        return hasMissingQuestion;
    },

    enqueueAnswerCellGeneration(projectId, pages) {
        if (!projectId) return;
        const candidates = (pages || [])
            .map((page) => {
                const rawCells = page.cells || null;
                const singleRegion = page.cellRegion && page.questionNumber ? { [`q${page.questionNumber}`]: page.cellRegion } : {};
                const pageRegions = page.cellRegions && Object.keys(page.cellRegions).length ? page.cellRegions : null;
                const cells = rawCells?.regions
                    ? rawCells
                    : {
                        regions: pageRegions || rawCells || singleRegion,
                        pageWidth: page.pageWidth || rawCells?.pageWidth || null,
                        cellGeneration: page.cellGeneration || {
                            version: page.cellGenerationVersion || null,
                            status: page.cellStatus === 'ready' ? 'partial' : 'not_started',
                            questions: page.cellStatus === 'ready' && page.questionNumber ? { [`q${page.questionNumber}`]: 'ready' } : {},
                        },
                    };
                return {
                    projectId,
                    entryId: page.entryId || page.entry_id,
                    entryNumber: Number(page.entryNumber || page.entry_number || page.entries?.entry_number || 0),
                    storagePath: page.storagePath || page.storage_path || '',
                    cells,
                    partialCellGeneration: Boolean(!rawCells?.regions && page.questionNumber),
                };
            })
            .filter(page => page.entryId && page.entryNumber && page.storagePath && this.shouldGenerateAnswerCells(page));
        for (const page of candidates) {
            const key = `${projectId}:${page.entryNumber}`;
            if (this._answerCellRunningKeys.has(key)) continue;
            if (this._answerCellQueuedKeys.has(key)) {
                const queued = this._answerCellQueue.find(item => item.key === key);
                if (queued) {
                    queued.cells = {
                        ...queued.cells,
                        regions: {
                            ...(queued.cells?.regions || {}),
                            ...(page.cells?.regions || {}),
                        },
                        pageWidth: queued.cells?.pageWidth || page.cells?.pageWidth || null,
                    };
                    queued.partialCellGeneration = queued.partialCellGeneration && page.partialCellGeneration;
                }
                continue;
            }
            this._answerCellQueuedKeys.add(key);
            this._answerCellQueue.push({ ...page, key });
        }
        this.scheduleAnswerCellQueue();
    },

    scheduleAnswerCellQueue() {
        if (this._answerCellQueueScheduled) return;
        if (!this._answerCellQueue.length) return;
        this._answerCellQueueScheduled = true;
        const run = () => {
            this._answerCellQueueScheduled = false;
            this.processAnswerCellQueue().catch(error => {
                console.warn('Answer cell generation queue failed:', error);
            });
        };
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(run, { timeout: 3000 });
        } else {
            setTimeout(run, 250);
        }
    },

    async processAnswerCellQueue() {
        const next = this._answerCellQueue.shift();
        if (!next) return;
        this._answerCellQueuedKeys.delete(next.key);
        if (this._answerCellRunningKeys.has(next.key)) {
            this.scheduleAnswerCellQueue();
            return;
        }
        this._answerCellRunningKeys.add(next.key);
        try {
            await this.generateAnswerCellsForPage(next.projectId, next);
        } catch (error) {
            console.warn('Answer cell generation skipped:', error);
        } finally {
            this._answerCellRunningKeys.delete(next.key);
            this.scheduleAnswerCellQueue();
        }
    },

    async generateAnswerCellsForPage(projectId, page) {
        const regions = page.cells?.regions || page.cellRegions || {};
        const questionKeys = Object.keys(regions).filter(key => regions[key]).sort((a, b) => Number(a.replace(/^q/, '')) - Number(b.replace(/^q/, '')));
        if (!questionKeys.length) return;

        const existingGeneration = this.normalizeAnswerCellGeneration(page.cells);
        const versionMismatch = existingGeneration.version !== this._answerCellVersion;
        const startedAt = new Date().toISOString();
        await this.updateAnswerCellGeneration(projectId, page.entryId, {
            version: this._answerCellVersion,
            status: 'processing',
            startedAt,
            failedAt: null,
            questions: versionMismatch ? {} : existingGeneration.questions,
        }).catch(error => {
            console.warn('Answer cell generation status update skipped:', error);
        });

        const pageUrls = await this.getAnswerPageUrls(projectId, [{
            key: String(page.entryId),
            storagePath: page.storagePath,
        }]);
        const pageUrl = pageUrls[String(page.entryId)];
        if (!pageUrl) throw new Error('Missing answer page URL');

        const questions = versionMismatch ? {} : { ...(existingGeneration.questions || {}) };
        const targets = questionKeys.filter(key => versionMismatch || questions[key] !== 'ready');
        const totalQuestions = page.partialCellGeneration ? 0 : questionKeys.length;
        for (let i = 0; i < targets.length; i += 2) {
            const batch = targets.slice(i, i + 2);
            await Promise.all(batch.map(async (key) => {
                const questionNumber = Number(String(key).replace(/^q/, ''));
                try {
                    const blob = await this.cropImageRegionBlob(pageUrl, regions[key], page.cells?.pageWidth || page.pageWidth || null);
                    await this.uploadAnswerCellBlob(projectId, page.entryNumber, questionNumber, blob, false);
                    questions[key] = 'ready';
                } catch (error) {
                    console.warn('Answer cell generation failed:', { entryNumber: page.entryNumber, questionNumber, error });
                    questions[key] = 'failed';
                }
            }));
        }

        const patch = this.buildCellGenerationPatch(questions, totalQuestions, { startedAt });
        await this.updateAnswerCellGeneration(projectId, page.entryId, patch).catch(error => {
            console.warn('Answer cell generation final status skipped:', error);
        });
    },

    async getModelAnswer(projectId, questionNumber) {
        const { data, error } = await this.client()
            .from('model_answers')
            .select('answer')
            .eq('project_id', projectId)
            .eq('question_number', questionNumber)
            .single();
        if (error) {
            if (error.code === 'PGRST116') return '';
            throw error;
        }
        return data?.answer || '';
    },

    async joinQuestionScorer(projectId, questionNumber) {
        const { data, error } = await this.client()
            .rpc('join_question_scorer', {
                p_project_id: projectId,
                p_question_number: questionNumber,
            })
            .single();
        if (error) {
            if (error.message?.includes('Question is full')) throw new Error('この問題は採点者が満員です。');
            throw error;
        }
        return data;
    },

    async setScoreVote(projectId, questionNumber, entryId, result) {
        const { data, error } = await this.client()
            .rpc('set_score_vote', {
                p_project_id: projectId,
                p_question_number: questionNumber,
                p_entry_id: entryId,
                p_result: result,
            })
            .single();
        if (error) throw error;
        return data;
    },

    async completeQuestionScoring(projectId, questionNumber) {
        const { data, error } = await this.client()
            .rpc('complete_question_scoring', {
                p_project_id: projectId,
                p_question_number: questionNumber,
            })
            .single();
        if (error) throw error;
        return data;
    },

    async listQuestionScorers(projectId) {
        const { data, error } = await this.client()
            .from('question_scorers')
            .select('question_number, scorer_member_id, completed_at')
            .eq('project_id', projectId);
        if (error) throw error;
        return data || [];
    },

    async getCurrentProjectMember(projectId) {
        const session = await this.getSession();
        const userId = session?.user?.id || '';
        if (!userId) return null;
        const members = await this.listProjectMembers(projectId);
        return (members || []).find(member => member.user_id === userId) || null;
    },

    async getNextScoringQuestion(projectId, options = {}) {
        const project = options.totalQuestions && options.requiredScorers
            ? null
            : await this.getProject(projectId).catch(() => null);
        const totalQuestions = Math.max(1, Number(options.totalQuestions || project?.question_count || 100));
        const requiredScorers = Math.max(1, Number(options.requiredScorers || project?.required_scorers || 3));
        const excludeQuestionNumber = Number(options.excludeQuestionNumber || 0);
        const currentMemberId = options.currentMemberId
            || (await this.getCurrentProjectMember(projectId).catch(() => null))?.id
            || '';
        const rows = await this.listQuestionScorers(projectId);

        let mineQ = 0;
        let availableQ = 0;
        for (let q = 1; q <= totalQuestions; q++) {
            if (q === excludeQuestionNumber) continue;
            const qRows = rows.filter(row => Number(row.question_number) === q);
            const scorerIds = qRows.map(row => row.scorer_member_id);
            const completedIds = qRows.filter(row => row.completed_at).map(row => row.scorer_member_id);
            const isMine = Boolean(currentMemberId && scorerIds.includes(currentMemberId));
            const myDone = Boolean(isMine && completedIds.includes(currentMemberId));
            const allDone = scorerIds.length >= requiredScorers && completedIds.length >= requiredScorers;
            const isFullForMe = scorerIds.length >= requiredScorers && !isMine;

            if (isMine && !myDone && !allDone && !mineQ) mineQ = q;
            if (!allDone && !isFullForMe && !(isMine && myDone) && !availableQ) availableQ = q;
        }

        const questionNumber = mineQ || availableQ || 0;
        return {
            questionNumber,
            reason: mineQ ? 'mine' : questionNumber ? 'available' : 'none',
            currentMemberId,
        };
    },

    async listScoreVotes(projectId) {
        const { data, error } = await this.client()
            .from('score_votes')
            .select('question_number, entry_id, scorer_member_id, result')
            .eq('project_id', projectId);
        if (error) throw error;
        return data || [];
    },

    async listFinalResults(projectId) {
        const { data, error } = await this.client()
            .from('final_results')
            .select('question_number, entry_id, result, decided_by, decided_at')
            .eq('project_id', projectId);
        if (error) throw error;
        return data || [];
    },

    async listScoreConflicts(projectId) {
        const { data, error } = await this.client()
            .rpc('list_score_conflicts', {
                p_project_id: projectId,
            });
        if (error) throw error;
        return (data || []).map((row) => {
            const q = Number(row.question_number);
            const entryNumber = Number(row.entry_number);
            return {
                q,
                entryId: row.entry_id,
                entryNumber,
                displayName: row.entry_name || `No.${String(entryNumber).padStart(3, '0')}`,
                affiliation: row.affiliation || '',
                grade: row.grade || '',
                storagePath: row.storage_path || '',
                cellRegion: row.cell_region || null,
                cellRegions: {},
                pageWidth: Number(row.page_width || 0) || null,
                cellStatus: row.cell_status || null,
                cellPath: row.cell_path || null,
                cellGenerationVersion: row.cell_generation_version || null,
                modelAnswer: row.model_answer || '',
                votes: Array.isArray(row.votes) ? row.votes : [],
                finalResult: row.final_result || null,
            };
        });
    },

    async listQuestionScoreVotes(projectId, questionNumber) {
        const { data, error } = await this.client()
            .from('score_votes')
            .select('entry_id, scorer_member_id, result')
            .eq('project_id', projectId)
            .eq('question_number', questionNumber);
        if (error) throw error;
        return data || [];
    },

    async listMyQuestionScoreVotes(projectId, questionNumber, scorerMemberId) {
        const { data, error } = await this.client()
            .from('score_votes')
            .select('entry_id, result')
            .eq('project_id', projectId)
            .eq('question_number', questionNumber)
            .eq('scorer_member_id', scorerMemberId);
        if (error) throw error;
        return data || [];
    },

    async resolveScoreConflict(projectId, questionNumber, entryId, result) {
        const { data, error } = await this.client()
            .rpc('resolve_score_conflict', {
                p_project_id: projectId,
                p_question_number: questionNumber,
                p_entry_id: entryId,
                p_result: result,
            })
            .single();
        if (error) {
            const message = error.message || '';
            if (!message.includes('ambiguous')) throw error;
            const fallback = await this.resolveScoreConflictDirect(projectId, questionNumber, entryId, result);
            return fallback;
        }
        return data;
    },

    async resolveScoreConflictDirect(projectId, questionNumber, entryId, result) {
        const sessionData = await this.getSession();
        const members = await this.listProjectMembers(projectId);
        const currentMember = members.find(member => member.user_id === sessionData?.user?.id);
        if (!currentMember || !['owner', 'admin'].includes(currentMember.role)) {
            throw new Error('要確認の確定には管理者権限が必要です。');
        }
        const { data, error } = await this.client()
            .from('final_results')
            .upsert({
                project_id: projectId,
                question_number: questionNumber,
                entry_id: entryId,
                result,
                decided_by: currentMember.id,
                decided_at: new Date().toISOString(),
            }, { onConflict: 'project_id,question_number,entry_id' })
            .select('project_id, question_number, entry_id, result, decided_by, decided_at')
            .single();
        if (error) throw error;
        return data;
    },

    async resetProjectData(projectId) {
        const pages = await this.listAnswerPages(projectId).catch(() => []);
        this.invalidateProjectAnswerCache(projectId);
        await Promise.all((pages || []).map(page => {
            const entryNumber = Number(page.entries?.entry_number || 0);
            return entryNumber ? this.deleteAnswerPage(projectId, entryNumber) : Promise.resolve();
        }));

        const { data, error } = await this.client()
            .rpc('reset_project_data', { p_project_id: projectId })
            .single();
        if (error) throw error;
        return data;
    },
};

window.CIQSupabaseAPI = CIQSupabaseAPI;
window.addEventListener('pagehide', (event) => {
    if (!event.persisted) CIQSupabaseAPI.releaseImageCaches();
}, { once: true });
