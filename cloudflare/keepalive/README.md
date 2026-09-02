# Supabase keepalive Worker

Supabase Free プランは **7 日間リクエストが無いとプロジェクトを一時停止**する。
停止すると復帰はダッシュボードからの手動操作になるため、大会当日に落ちている事故を防ぐ目的で
Cloudflare Workers の Cron Trigger から定期的にリクエストを投げる。

- 頻度: 1 日 2 回（12:00 / 00:00 JST）。7 日に対して 14 回なので数回失敗しても停止しない。
- 叩く先: `public_project_settings` を 1 行 select。anon に grant 済みの公開ビューで PII は通らない。
- 費用: Workers 無料枠内（年間 730 リクエスト程度）。

## デプロイ

```bash
cd cloudflare/keepalive && npx wrangler deploy
```

初回は `npx wrangler login` でブラウザ認証が入る。

## 動作確認

cron を待たずに確認する方法が 2 つある。

1. 公開 URL を叩く。`ok` が返れば疎通している。

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://ciq-supabase-keepalive.chromquiz.workers.dev
```

2. ログを見る。

```bash
cd cloudflare/keepalive && npx wrangler tail
```

cron の発火自体を確認するなら Cloudflare ダッシュボードの
Workers &rarr; ciq-supabase-keepalive &rarr; Settings &rarr; Trigger Events で次回実行時刻を見る。

## 停止してしまった場合

Worker が動いていても Supabase 側の障害などで 7 日空くことはありうる。
停止した場合は Supabase ダッシュボードの対象プロジェクトで Restore を押す。復帰には数分かかる。
**大会前日には手動で 1 回 Worker の URL を叩いて 200 を確認しておくこと。**

なお cron は Cloudflare 内部から `scheduled` ハンドラを直接呼ぶため、公開 URL やその証明書には依存しない。
公開 URL が落ちていても keepalive 自体は動く（逆に、公開 URL が 200 でも cron の発火確認にはならない）。
subdomain を作り直した直後は証明書発行に数分かかり、その間 TLS handshake failure になる。

## 前提が変わったとき

- Supabase プロジェクトを作り直したら `wrangler.toml` の `SUPABASE_URL` と
  `SUPABASE_PUBLISHABLE_KEY` を更新する（`js/supabase_config.js` と同じ値）。
- `public_project_settings` の anon grant を外した場合は `KEEPALIVE_PATH` の向き先を変える。
  200 以外が返るようになると keepalive は無意味になるので、grant を触るときは合わせて確認する。
- 有料プラン（Pro）に上げた場合は一時停止自体が無くなるので、この Worker は不要になる。
