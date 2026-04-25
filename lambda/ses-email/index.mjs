// CIQ Email Notification — AWS Lambda + SES
// デプロイ先: AWS Lambda (Node.js 20.x ランタイム)
// トリガー: API Gateway (HTTP API) POST /send-email
//
// 環境変数:
//   SES_FROM_ADDRESS  — 検証済みの送信元メールアドレス (例: ciq.info@gmail.com)
//   API_SECRET_KEY    — フロントエンドからの呼び出し認証用シークレット
//   AWS_REGION        — SESリージョン (デフォルト: ap-northeast-1)

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "ap-northeast-1" });
const FROM = process.env.SES_FROM_ADDRESS;
const API_KEY = process.env.API_SECRET_KEY;

// ── QRコード画像URL生成 ──────────────────────────
function qrUrl(data, size = 200) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

// ── テンプレート ──────────────────────────────────

const templates = {
  // エントリー完了通知（HTML + QRコード）
  entry_confirmation: ({ projectName, entryNumber, password, uuid, familyName, firstName, status, editUrl }) => ({
    subject: `【${projectName}】エントリー受付完了（No.${entryNumber}）`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:24px;text-align:center;">
          <h1 style="color:white;font-size:20px;margin:0;">エントリー受付完了</h1>
          <p style="color:#94a3b8;font-size:13px;margin:8px 0 0;">${projectName}</p>
        </div>
        <div style="padding:24px;">
          <p style="color:#334155;font-size:14px;margin:0 0 16px;">
            ${familyName} ${firstName} 様<br>
            エントリーを受け付けました。${status === 'waitlist' ? '<br><strong style="color:#f59e0b;">※ 定員超過のためキャンセル待ちです</strong>' : ''}
          </p>

          <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="color:#64748b;padding:6px 0;">受付番号</td>
                <td style="text-align:right;font-weight:700;color:#1e293b;font-size:18px;">${entryNumber}</td>
              </tr>
              <tr>
                <td style="color:#64748b;padding:6px 0;">パスワード</td>
                <td style="text-align:right;font-weight:700;color:#1e293b;font-family:monospace;font-size:16px;letter-spacing:2px;">${password}</td>
              </tr>
            </table>
          </div>

          <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px;">
            <p style="color:#64748b;font-size:12px;margin:0 0 12px;">当日受付用QRコード</p>
            <img src="${qrUrl(uuid)}" alt="QR Code" width="200" height="200" style="border-radius:8px;" />
            <p style="color:#94a3b8;font-size:11px;margin:12px 0 0;">当日このQRコードを受付でご提示ください</p>
          </div>

          ${editUrl ? `<div style="text-align:center;margin-bottom:16px;">
            <a href="${editUrl}" style="display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;">エントリー内容を編集する</a>
          </div>` : ''}

          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;font-size:12px;color:#9a3412;">
            <strong>⚠️ 重要:</strong> パスワードは成績照合・キャンセル時に必要です。このメールを保管してください。
          </div>
        </div>
        <div style="background:#f1f5f9;padding:12px;text-align:center;font-size:11px;color:#94a3b8;">
          CIQ — このメールは自動送信されています
        </div>
      </div>
    `,
    text: [
      `${familyName} ${firstName} 様`,
      ``,
      `${projectName} へのエントリーを受け付けました。`,
      ``,
      `受付番号: ${entryNumber}`,
      `パスワード: ${password}`,
      status === 'waitlist' ? `状態: キャンセル待ち` : `状態: 登録完了`,
      ``,
      `※ パスワードは成績照合・キャンセル時に必要です。`,
      `※ QRコードはHTML対応メーラーで表示されます。`,
      ``,
      `CIQ — このメールは自動送信されています。`,
    ].filter(Boolean).join('\n'),
  }),

  // キャンセル完了通知
  entry_cancelled: ({ projectName, entryNumber }) => ({
    subject: `【${projectName}】エントリーキャンセル完了（No.${entryNumber}）`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#7f1d1d,#991b1b);padding:24px;text-align:center;">
          <h1 style="color:white;font-size:20px;margin:0;">キャンセル完了</h1>
          <p style="color:#fca5a5;font-size:13px;margin:8px 0 0;">${projectName}</p>
        </div>
        <div style="padding:24px;">
          <p style="color:#334155;font-size:14px;">受付番号 ${entryNumber} のエントリーをキャンセルしました。</p>
          <p style="color:#64748b;font-size:13px;">ご利用ありがとうございました。</p>
        </div>
        <div style="background:#f1f5f9;padding:12px;text-align:center;font-size:11px;color:#94a3b8;">
          CIQ — このメールは自動送信されています
        </div>
      </div>
    `,
    text: [
      `${projectName} のエントリーをキャンセルしました。`,
      `受付番号: ${entryNumber}`,
      ``,
      `ご利用ありがとうございました。`,
      `CIQ — このメールは自動送信されています。`,
    ].join('\n'),
  }),
};

// ── HMAC署名ユーティリティ（認証コード検証用）──────
import { createHmac } from "crypto";

function signCode(code, email, expiresAt) {
  const payload = `${code}:${email.toLowerCase()}:${expiresAt}`;
  return createHmac('sha256', API_KEY).update(payload).digest('hex');
}

// ── レート制限（メールアドレスごと、Lambdaインスタンス内） ──
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 2 * 60 * 1000; // 2分間隔
function checkRateLimit(email) {
  const key = email.toLowerCase();
  const now = Date.now();
  const last = rateLimitMap.get(key);
  if (last && now - last < RATE_LIMIT_MS) return false;
  rateLimitMap.set(key, now);
  // 古いエントリをクリーンアップ（メモリ肥大化防止）
  if (rateLimitMap.size > 1000) {
    for (const [k, t] of rateLimitMap) {
      if (now - t > RATE_LIMIT_MS) rateLimitMap.delete(k);
    }
  }
  return true;
}

// ── 許可Origin ──
const ALLOWED_ORIGINS = [
  'https://chromquiz.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

// ── ハンドラー ──────────────────────────────────

export const handler = async (event) => {
  const origin = event.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // CORS preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Origin検証（preflight以外）
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Origin not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // API Key 認証
    const reqKey = event.headers?.["x-api-key"] || body.apiKey;
    if (reqKey !== API_KEY) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Forbidden" }) };
    }

    const { type, to, data } = body;

    // レート制限チェック（メール送信系のみ）
    if ((type === 'send_verification' || templates[type]) && to) {
      if (!checkRateLimit(to)) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many requests. Please wait." }) };
      }
    }

    // ── メール認証コード送信 ──
    if (type === 'send_verification') {
      if (!to) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'to' field" }) };
      }
      const code = String(Math.floor(100000 + Math.random() * 900000)); // 6桁
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10分有効
      const signature = signCode(code, to, expiresAt);

      const projectName = data?.projectName || 'CIQ';

      await ses.send(new SendEmailCommand({
        Source: FROM,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: `【${projectName}】メール認証コード`, Charset: "UTF-8" },
          Body: {
            Html: { Data: `
              <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:24px;text-align:center;">
                  <h1 style="color:white;font-size:20px;margin:0;">メール認証コード</h1>
                  <p style="color:#94a3b8;font-size:13px;margin:8px 0 0;">${projectName}</p>
                </div>
                <div style="padding:24px;text-align:center;">
                  <p style="color:#334155;font-size:14px;margin:0 0 16px;">エントリーフォームに以下のコードを入力してください。</p>
                  <div style="background:white;border:2px solid #3b82f6;border-radius:12px;padding:20px;margin-bottom:16px;">
                    <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#1e293b;font-family:monospace;">${code}</span>
                  </div>
                  <p style="color:#94a3b8;font-size:12px;">このコードは10分間有効です。</p>
                </div>
                <div style="background:#f1f5f9;padding:12px;text-align:center;font-size:11px;color:#94a3b8;">
                  CIQ — このメールは自動送信されています
                </div>
              </div>
            `, Charset: "UTF-8" },
            Text: { Data: `認証コード: ${code}\nこのコードは10分間有効です。`, Charset: "UTF-8" },
          },
        },
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, signature, expiresAt }) };
    }

    // ── メール認証コード検証 ──
    if (type === 'verify_code') {
      const { code, signature, expiresAt } = data || {};
      if (!to || !code || !signature || !expiresAt) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };
      }
      if (Date.now() > expiresAt) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Code expired", verified: false }) };
      }
      const expected = signCode(code, to, expiresAt);
      const verified = expected === signature;
      return { statusCode: 200, headers, body: JSON.stringify({ verified }) };
    }

    // ── 通常のテンプレートメール送信 ──
    if (!type || !to || !data) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields: type, to, data" }) };
    }

    const templateFn = templates[type];
    if (!templateFn) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown template type: ${type}` }) };
    }

    const result = templateFn(data);

    const emailBody = {};
    if (result.html) {
      emailBody.Html = { Data: result.html, Charset: "UTF-8" };
    }
    if (result.text) {
      emailBody.Text = { Data: result.text, Charset: "UTF-8" };
    }

    const command = new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: result.subject, Charset: "UTF-8" },
        Body: emailBody,
      },
    });

    await ses.send(command);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error("SES send error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
