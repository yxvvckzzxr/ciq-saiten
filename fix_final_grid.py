import re

with open('saiten.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Grid margin top and max grid height
content = re.sub(
    r'const gridMarginTop = 20;\n\s*const gridSpaceWidth = pageWidth - gridMarginX \* 2;\n\s*const colWidth = gridSpaceWidth \/ qCols;\n\s*const rows = Math\.ceil\(qCount \/ qCols\);\n\s*const maxGridHeight = 240;',
    r'const gridMarginTop = 5;\n        const gridSpaceWidth = pageWidth - gridMarginX * 2;\n        const colWidth = gridSpaceWidth / qCols;\n        const rows = Math.ceil(qCount / qCols);\n        const maxGridHeight = 255;',
    content
)

# 2. Update Bottom Box Layout
old_layout = r"        // 3\. 統合下部ボックス枠 \(Bottom full-width box\).*?doc\.text\(\"氏名\", \(L7 \+ L8\)\/2, boxY \+ boxH\/2, \{ align: \'center\', baseline: \'middle\' \}\);"

new_layout = """        // 縦書きテキスト描画用ヘルパー関数
        function drawVerticalText(doc, str, x, centerY) {
            const chars = str.split('');
            const spacing = 3.5;
            const startY = centerY - ((chars.length - 1) * spacing) / 2;
            chars.forEach((c, i) => {
                doc.text(c, x, startY + i * spacing, { align: 'center', baseline: 'middle' });
            });
        }

        // 3. 統合下部ボックス枠 (Bottom full-width box)
        // 上のグリッドが maxGridHeight = 255 まで拡張されたため、開始位置を下げる
        const boxX = 15;
        const boxY = gridMarginTop + maxGridHeight + 5; // 5+255+5 = 265
        const boxW = 180;
        const boxH = 26;
        
        doc.rect(boxX, boxY, boxW, boxH, 'S');

        // 各種区切り線 (横幅と用途)
        const L1 = boxX + 6;   // 受付番号ラベル (6mm幅)
        const L2 = boxX + 13;  // 手書き枠 (7mm幅)
        const L3 = boxX + 57;  // マークシート枠 (44mm幅)
        const L4 = L3 + 6;     // 学年ラベル (6mm幅)
        const L5 = L4 + 18;    // 学年枠 (18mm幅)
        const L6 = L5 + 6;     // 所属ラベル (6mm幅)
        const L7 = L6 + 40;    // 所属枠 (40mm幅)
        const L8 = L7 + 6;     // 氏名ラベル (6mm幅) ...残り氏名枠(62mm幅)
        
        [L1, L2, L3, L4, L5, L6, L7, L8].forEach(lx => {
            doc.line(lx, boxY, lx, boxY + boxH, 'S');
        });

        const rowH = boxH / 3;
        // マーカーシート部分の横線 (3桁の分離)
        doc.line(L1, boxY + rowH, L3, boxY + rowH, 'S');
        doc.line(L1, boxY + rowH*2, L3, boxY + rowH*2, 'S');

        // ラベル描画 (すべて縦書き・中央揃え)
        doc.setFontSize(8);
        drawVerticalText(doc, "受付番号", boxX + 3, boxY + boxH/2);
        drawVerticalText(doc, "学年", L3 + 3, boxY + boxH/2);
        drawVerticalText(doc, "所属", L5 + 3, boxY + boxH/2);
        drawVerticalText(doc, "氏名", L7 + 3, boxY + boxH/2);

        // マークシートのバブル配置
        const bubbleW = 3.2;
        const bubbleH = 5.0;
        
        for (let row = 0; row < 3; row++) {
          const cy = boxY + row * rowH + rowH / 2;
          for (let col = 0; col < 10; col++) {
            const cx = L2 + 2.5 + col * 4.2;
            doc.ellipse(cx + bubbleW/2, cy, bubbleW/2, bubbleH/2, 'S');
            doc.text(col.toString(), cx + bubbleW/2, cy, { align: 'center', baseline: 'middle' });
            
            // scoring.html は cell.row を 桁数(0-2)、cell.col を 値(0-9) とみなす
            config.markCells.push({ x: cx, y: cy-bubbleH/2, w: bubbleW, h: bubbleH, row: row, col: col });
          }
        }"""

content = re.sub(old_layout, new_layout, content, flags=re.DOTALL)

with open('saiten.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Vertical text and grid extension applied.")
