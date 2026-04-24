// share_card.js — SNS共有用の成績カード画像をCanvasで生成する

const ShareCard = (() => {
    const W = 1200, H = 630;

    const C = {
        bg: '#eef0f4',
        bgLine: '#d8dce3',
        accent: '#2563eb',
        dark: '#1a1f2e',
        darkSub: '#2a3040',
        white: '#ffffff',
        textMain: '#1e293b',
        textSub: '#64748b',
    };

    // 平行四辺形の頂点計算（skew = 左方向オフセット）
    function paraPath(ctx, x, y, w, h, skew) {
        ctx.beginPath();
        ctx.moveTo(x + skew, y);
        ctx.lineTo(x + w + skew, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
    }

    function drawBackground(ctx) {
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, W, H);

        // 斜線パターン（左上）
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        for (let i = -200; i < 300; i += 18) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 200, 200);
            ctx.stroke();
        }
        // 斜線パターン（右下）
        for (let i = 900; i < 1400; i += 18) {
            ctx.beginPath();
            ctx.moveTo(i, 430);
            ctx.lineTo(i + 200, 630);
            ctx.stroke();
        }
        ctx.restore();

        // ドットパターン（中央寄り）
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = C.dark;
        for (let x = 350; x < 850; x += 18) {
            for (let y = 180; y < 420; y += 18) {
                ctx.beginPath();
                ctx.arc(x, y, 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();

        // サーキットライン
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(200, 350); ctx.lineTo(550, 350); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(700, 480); ctx.lineTo(1050, 480); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(480, 200); ctx.lineTo(480, 520); ctx.stroke();
        ctx.restore();

        // 太い青アクセント（右上）
        ctx.save();
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        ctx.moveTo(W - 200, 0); ctx.lineTo(W, 0);
        ctx.lineTo(W, 70); ctx.lineTo(W - 140, 0);
        ctx.fill();
        // 左下
        ctx.beginPath();
        ctx.moveTo(0, H - 70); ctx.lineTo(70, H);
        ctx.lineTo(0, H);
        ctx.fill();
        ctx.restore();
    }

    function drawTitleBanner(ctx, projectName) {
        const bannerY = 28;
        const bannerH = 85;
        const skew = 20;

        // バナー背景（平行四辺形）
        ctx.save();
        paraPath(ctx, 60, bannerY, W - 160, bannerH, skew);
        const grad = ctx.createLinearGradient(0, bannerY, W, bannerY);
        grad.addColorStop(0, C.dark);
        grad.addColorStop(1, C.darkSub);
        ctx.fillStyle = grad;
        ctx.fill();

        // 上辺の青ライン
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(60 + skew, bannerY);
        ctx.lineTo(W - 160 + 60 + skew, bannerY);
        ctx.stroke();
        ctx.restore();

        // 三本線マーク
        ctx.save();
        ctx.fillStyle = C.accent;
        const lx = 95;
        for (let i = 0; i < 3; i++) {
            ctx.fillRect(lx + i * 8, bannerY + 26, 4, bannerH - 52);
        }
        ctx.restore();

        // テキスト
        const centerX = W / 2 + 10;
        const textY = bannerY + bannerH / 2 + 1;
        const suffix = ' に参加しました!!';

        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 38px "Inter", "Noto Sans JP", sans-serif';

        const match = projectName.match(/^(.+?the\s*)(\d+\w*)(.*)/i);
        if (match) {
            const part1 = match[1];
            const part2 = match[2];
            const part3 = match[3] + suffix;

            ctx.font = 'bold 38px "Inter", "Noto Sans JP", sans-serif';
            const w1 = ctx.measureText(part1).width;
            ctx.font = 'bold 46px "Inter", "Noto Sans JP", sans-serif';
            const w2 = ctx.measureText(part2).width;
            ctx.font = 'bold 38px "Inter", "Noto Sans JP", sans-serif';
            const w3 = ctx.measureText(part3).width;
            const totalW = w1 + w2 + w3;
            let x = centerX - totalW / 2;

            ctx.textAlign = 'left';
            ctx.font = 'bold 38px "Inter", "Noto Sans JP", sans-serif';
            ctx.fillStyle = C.white;
            ctx.fillText(part1, x, textY);
            x += w1;

            // 数字部分 — 明るい水色で目立たせる
            ctx.font = 'bold 46px "Inter", "Noto Sans JP", sans-serif';
            ctx.fillStyle = '#60a5fa';
            ctx.fillText(part2, x, textY);
            x += w2;

            ctx.font = 'bold 38px "Inter", "Noto Sans JP", sans-serif';
            ctx.fillStyle = C.white;
            ctx.fillText(part3, x, textY);
        } else {
            ctx.textAlign = 'center';
            ctx.fillStyle = C.white;
            ctx.fillText(projectName + suffix, centerX, textY);
        }
        ctx.restore();
    }

    function drawCard(ctx, x, y, w, h, label, value, options = {}) {
        const headerH = 34;
        const skew = 12;

        // カード本体（平行四辺形・白）
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = C.white;
        paraPath(ctx, x, y, w, h, skew);
        ctx.fill();
        ctx.restore();

        // ヘッダーバー — カード本体の上部を切り取った平行四辺形
        ctx.save();
        const hGrad = ctx.createLinearGradient(x, y, x + w, y);
        hGrad.addColorStop(0, C.dark);
        hGrad.addColorStop(1, C.darkSub);
        ctx.fillStyle = hGrad;
        // カード本体と同じ傾斜を使う（skewは高さに比例して減少）
        const topSkew = skew;
        const botSkew = skew * (1 - headerH / h);
        ctx.beginPath();
        ctx.moveTo(x + topSkew, y);              // 左上
        ctx.lineTo(x + w + topSkew, y);           // 右上
        ctx.lineTo(x + w + botSkew, y + headerH); // 右下
        ctx.lineTo(x + botSkew, y + headerH);     // 左下
        ctx.closePath();
        ctx.fill();

        // 青いアクセントバー（ヘッダー内）
        ctx.fillStyle = C.accent;
        ctx.fillRect(x + topSkew + 8, y + 7, 4, headerH - 14);

        // ヘッダーテキスト
        ctx.fillStyle = C.white;
        ctx.font = 'bold 13px "Inter", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + topSkew + 20, y + headerH / 2);
        ctx.restore();

        // 右下コーナー（青い三角）
        ctx.save();
        ctx.fillStyle = C.accent;
        const cs = 18;
        ctx.beginPath();
        ctx.moveTo(x + w, y + h);
        ctx.lineTo(x + w - cs, y + h);
        ctx.lineTo(x + w, y + h - cs);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // 左下コーナーライン
        ctx.save();
        ctx.strokeStyle = C.bgLine;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y + h - 14);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x + 14, y + h);
        ctx.stroke();
        ctx.restore();

        // 値テキスト
        const bodyCenter = y + headerH + (h - headerH) / 2;
        const cardCenterX = x + w / 2 + skew / 2;
        ctx.save();
        ctx.textBaseline = 'middle';
        const fontSize = options.fontSize || 80;
        ctx.font = `800 ${fontSize}px "Inter", sans-serif`;
        ctx.fillStyle = C.textMain;

        if (options.suffix) {
            // 値+単位を横並びでセンタリング
            const valW = ctx.measureText(value).width;
            const suffixFont = `600 ${Math.round(fontSize * 0.32)}px "Inter", sans-serif`;
            ctx.save();
            ctx.font = suffixFont;
            const sufW = ctx.measureText(options.suffix).width;
            ctx.restore();
            const totalW = valW + 6 + sufW;
            const startX = cardCenterX - totalW / 2;

            ctx.font = `800 ${fontSize}px "Inter", sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(value, startX, bodyCenter);

            ctx.font = suffixFont;
            ctx.fillStyle = C.textSub;
            ctx.fillText(options.suffix, startX + valW + 6, bodyCenter + fontSize * 0.18);
        } else {
            ctx.textAlign = 'center';
            ctx.fillText(value, cardCenterX, bodyCenter);
        }
        ctx.restore();
    }

    async function generate({ projectName, rank, score, streaks = [] }) {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        try { await document.fonts.ready; } catch(e) {}

        drawBackground(ctx);
        drawTitleBanner(ctx, projectName || 'CIQ');

        // カードレイアウト
        const cardTop = 140;
        const gap = 20;
        const mainW = 390;
        const mainH = 380;
        const sideW = 190;
        const sideH = (mainH - gap) / 2;

        const totalW = mainW * 2 + sideW + gap * 2;
        const sx = (W - totalW) / 2;

        // RANK
        const rankStr = String(rank || '-');
        drawCard(ctx, sx, cardTop, mainW, mainH, 'RANK', rankStr, {
            fontSize: rankStr.length > 4 ? 64 : 86,
        });

        // SCORE
        const scoreStr = String(score ?? '-');
        drawCard(ctx, sx + mainW + gap, cardTop, mainW, mainH, 'SCORE', scoreStr, {
            fontSize: scoreStr.length > 4 ? 64 : 86,
            suffix: 'pts',
        });

        // STREAK 1
        drawCard(ctx, sx + (mainW + gap) * 2, cardTop, sideW, sideH, 'STREAK 1', String(streaks[0] ?? '-'), {
            fontSize: 52,
        });

        // STREAK 2
        drawCard(ctx, sx + (mainW + gap) * 2, cardTop + sideH + gap, sideW, sideH, 'STREAK 2', String(streaks[1] ?? '-'), {
            fontSize: 52,
        });

        // CIQ ウォーターマーク（小さめ・さりげなく）
        ctx.save();
        ctx.globalAlpha = 0.04;
        ctx.font = 'bold 80px "Inter", sans-serif';
        ctx.fillStyle = C.dark;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('CIQ', W - 30, H - 12);
        ctx.restore();

        return new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/png');
        });
    }

    return { generate };
})();
