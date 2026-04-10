import re

with open('saiten.html', 'r', encoding='utf-8') as f:
    content = f.read()

old_layout = r"        const markSheetX = 35;\n        const markSheetY = bottomY \+ 8;.*?    doc\.text\(\"所属\", nameBoxX \+ \(boxW\*2\)\/3 \+ 2, nameBoxY \+ 4\);"

new_layout = """        const markSheetX = 15;
        const markSheetY = bottomY + 8;
        const bubbleW = 3.5;
        const bubbleH = 5.5;
        
        doc.setFontSize(8);
        for (let row = 0; row < 3; row++) {
          // 手書き枠 (左側)
          const boxY = markSheetY + row * (bubbleH + 2.5);
          doc.rect(markSheetX, boxY, 6, 6, 'S');

          for (let col = 0; col < 10; col++) {
            const cx = markSheetX + 10 + col * (bubbleW + 2.5);
            const cy = boxY;
            
            doc.ellipse(cx + bubbleW/2, cy + bubbleH/2, bubbleW/2, bubbleH/2, 'S');
            doc.text(col.toString(), cx + bubbleW/2, cy + bubbleH/2, { align: 'center', baseline: 'middle' });
            
            // scoring.html は cell.row を 桁数(0-2)、cell.col を 値(0-9) とみなす
            // ここでは描画の row が 桁数、col が 値 となる
            config.markCells.push({ x: cx, y: cy, w: bubbleW, h: bubbleH, row: row, col: col });
          }
        }

        // 4. 名前・所属・学年枠 (Bottom Right)
        const nameBoxX = 90;
        const nameBoxY = bottomY + 5;
        const boxW = 105;
        doc.rect(nameBoxX, nameBoxY, boxW, 26, 'S');
        // 区切り線
        doc.line(nameBoxX + 15, nameBoxY, nameBoxX + 15, nameBoxY + 26, 'S');
        doc.line(nameBoxX + boxW/2 + 5, nameBoxY, nameBoxX + boxW/2 + 5, nameBoxY + 26, 'S');
        doc.line(nameBoxX + boxW/2 + 20, nameBoxY, nameBoxX + boxW/2 + 20, nameBoxY + 26, 'S');

        // ラベル
        doc.setFontSize(8);
        doc.text("学年", nameBoxX + 7.5, nameBoxY + 4, { align: 'center', baseline: 'middle' });
        doc.text("組", nameBoxX + 7.5, nameBoxY + 16, { align: 'center', baseline: 'middle' }); // Added optional class/group label space below
        doc.text("所属", nameBoxX + boxW/2 + 12.5, nameBoxY + 12, { align: 'center', baseline: 'middle' });

        doc.setFontSize(14);
        doc.text("氏名", nameBoxX + 22, nameBoxY + 14);
"""

content = re.sub(old_layout, new_layout, content, flags=re.DOTALL)

with open('saiten.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed layout.")
