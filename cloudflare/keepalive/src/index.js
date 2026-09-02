// Supabase Free プランは 7 日間リクエストが無いとプロジェクトを一時停止する。
// 公開ビューを 1 行読むだけの無害なリクエストを 1 日 2 回投げて停止を防ぐ。
// 読む先は anon に grant 済みの public_project_settings で、PII は一切通らない。
//
// この Worker 自体が黙って壊れる（cron が飛ばない・grant が外れる・鍵が変わる）と
// 誰も気づけないため、結果を死活監視サービスへ通知する。通知が途絶えると向こうから
// メールが来る = Worker ごと死んだ場合も検知できる。
// HEALTHCHECK_URL が未設定なら通知はスキップし、keepalive だけが動く。

const MAX_ATTEMPTS = 2;

async function pingSupabase(env) {
    const url = `${env.SUPABASE_URL}${env.KEEPALIVE_PATH}`;
    const headers = {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
    };

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, { headers });
            if (response.ok) {
                console.log(`keepalive ok (attempt ${attempt}, status ${response.status})`);
                return { ok: true, status: response.status };
            }
            lastError = `status ${response.status}`;
        } catch (error) {
            lastError = error.message;
        }
        console.log(`keepalive attempt ${attempt} failed: ${lastError}`);
    }

    console.error(`keepalive failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
    return { ok: false, error: lastError };
}

// 死活監視への通知。監視側が落ちていても keepalive の判定には影響させない。
async function reportHealth(env, result) {
    if (!env.HEALTHCHECK_URL) return;

    const url = result.ok ? env.HEALTHCHECK_URL : `${env.HEALTHCHECK_URL}/fail`;
    try {
        const response = await fetch(url, { method: 'POST' });
        console.log(`healthcheck reported ${result.ok ? 'ok' : 'fail'} (status ${response.status})`);
    } catch (error) {
        console.error(`healthcheck report failed: ${error.message}`);
    }
}

async function runKeepalive(env) {
    const result = await pingSupabase(env);
    await reportHealth(env, result);
    return result;
}

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runKeepalive(env));
    },

    // 手動確認用。cron を待たずにブラウザで叩いて動作を確かめられる。
    // 入力を一切受け取らず固定の read を投げるだけなので、公開されていても害はない。
    async fetch(request, env) {
        const result = await runKeepalive(env);
        return new Response(result.ok ? 'ok\n' : `failed: ${result.error}\n`, {
            status: result.ok ? 200 : 502,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    },
};
