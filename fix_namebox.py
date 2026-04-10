import re

with open('saiten.html', 'r', encoding='utf-8') as f:
    content = f.read()

old_layout = r"        // 4\. 名前・所属・学年枠 \(Bottom Right\).*?doc\.text\(\"氏名\", nameBoxX \+ 22, nameBoxY \+ 14\);"

new_layout = """        // 4. 名前・所属・学年枠 (Bottom Right)
        const nameBoxX = 90;
        const nameBoxY = bottomY + 5;
        const boxW = 105;
        doc.rect(nameBoxX, nameBoxY, boxW, 26, 'S');
        
        // 区切り線 (左から: 学年ラベル10mm、学年枠15mm、所属ラベル10mm、所属枠35mm、氏名ラベル10mm、氏名枠残り)
        const L1 = 10;
        const L2 = 25;
        const L3 = 35;
        const L4 = 70;
        const L5 = 80;
        
        doc.line(nameBoxX + L1, nameBoxY, nameBoxX + L1, nameBoxY + 26, 'S');
        doc.line(nameBoxX + L2, nameBoxY, nameBoxX + L2, nameBoxY + 26, 'S');
        doc.line(nameBoxX + L3, nameBoxY, nameBoxX + L3, nameBoxY + 26, 'S');
        doc.line(nameBoxX + L4, nameBoxY, nameBoxX + L4, nameBoxY + 26, 'S');
        doc.line(nameBoxX + L5, nameBoxY, nameBoxX + L5, nameBoxY + 26, 'S');

        // ラベル
        doc.setFontSize(8);
        doc.text("学年", nameBoxX + L1/2, nameBoxY + 13, { align: 'center', baseline: 'middle' });
        doc.text("所属", nameBoxX + L2 + (L3-L2)/2, nameBoxY + 13, { align: 'center', baseline: 'middle' });
        doc.text("氏名", nameBoxX + L4 + (L5-L4)/2, nameBoxY + 13, { align: 'center', baseline: 'middle' });
"""

content = re.sub(old_layout, new_layout, content, flags=re.DOTALL)

with open('saiten.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed namebox layout.")
