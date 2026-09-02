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

## 死活監視（HEALTHCHECK_URL）

この Worker は黙って壊れうる（cron が飛ばない・`public_project_settings` の anon grant が
将来のマイグレーションで外れる・鍵を作り直す・Worker ごと消える）。Cloudflare は cron の
失敗を通知しないため、**成功したら外部の死活監視サービスに ping を送り、ping が途絶えたら
向こうからメールが来る**構成にしている（dead man's switch）。Worker ごと死んでも検知できる。

- 成功時: `HEALTHCHECK_URL` に POST
- 失敗時: `HEALTHCHECK_URL/fail` に POST（猶予を待たず即通知）
- 監視側が落ちていても keepalive 本体の判定には影響しない

### 設定手順

1. https://healthchecks.io/ で無料アカウントを作る（無料枠 20 チェック）。
2. チェックを 1 つ作り、以下を設定する。
   - Name: `ciq-supabase-keepalive`
   - Period: **1 day**
   - Grace Time: **12 hours**
   - 1 日 2 回 ping するので、36 時間 ping が無ければ通知が来る。
     Supabase の停止猶予 7 日に対して 5 日以上の余裕がある。
3. 表示された Ping URL（`https://hc-ping.com/<uuid>`）を Secret に入れる。

```bash
cd cloudflare/keepalive && npx wrangler secret put HEALTHCHECK_URL
```

4. 動作確認。公開 URL を 1 回叩き、healthchecks.io 側のチェックが緑になれば繋がっている。

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://ciq-supabase-keepalive.chromquiz.workers.dev
```

**Ping URL は `wrangler.toml` に書かないこと。** このリポジトリは public で、
Ping URL は叩けば生存扱いにできる capability URL のため、公開すると第三者に障害を
隠蔽されうる。必ず Secret を使う。

## 停止してしまった場合

Worker が動いていても Supabase 側の障害などで 7 日空くことはありうる。
停止した場合は Supabase ダッシュボードの対象プロジェクトで Restore を押す。復帰には数分かかる。
死活監視を設定していれば異常はメールで飛んでくるが、**大会前日には念のため手動で 1 回
Worker の URL を叩いて 200 を確認しておくこと**（監視自体の設定漏れを拾うため）。

なお cron は Cloudflare 内部から `scheduled` ハンドラを直接呼ぶため、公開 URL やその証明書には依存しない。
公開 URL が落ちていても keepalive 自体は動く（逆に、公開 URL が 200 でも cron の発火確認にはならない）。
subdomain を作り直した直後は証明書発行に数分かかり、その間 TLS handshake failure になる。

## 前提が変わったとき

- Supabase プロジェクトを作り直したら `wrangler.toml` の `SUPABASE_URL` と
  `SUPABASE_PUBLISHABLE_KEY` を更新する（`js/supabase_config.js` と同じ値）。
- `public_project_settings` の anon grant を外した場合は `KEEPALIVE_PATH` の向き先を変える。
  200 以外が返るようになると keepalive は無意味になるので、grant を触るときは合わせて確認する。
- 有料プラン（Pro）に上げた場合は一時停止自体が無くなるので、この Worker は不要になる。
