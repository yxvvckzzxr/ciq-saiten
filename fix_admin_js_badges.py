import re
with open('js/admin.js', 'r') as f:
    content = f.read()

# Fix badge colors for entry list
old_stat = """const statText = v.status === 'canceled' ? '<span style="color:#ef5350">ｷｬﾝｾﾙ</span>'
                        : v.checkedIn ? '<span style="color:#4caf50">受付済</span>' : '未受付';"""
new_stat = """const statText = v.status === 'canceled' ? '<span class="badge danger">ｷｬﾝｾﾙ</span>'
                        : v.checkedIn ? '<span class="badge success">受付済</span>' : '<span class="badge muted">未受付</span>';"""
content = content.replace(old_stat, new_stat)

# Fix inline styles on td padding and borders
content = re.sub(r'style="padding:8px;border:1px solid #444(.*?)"', '', content)
content = re.sub(r'style="padding:10px;border-bottom:1px solid #444(.*?)"', '', content)

with open('js/admin.js', 'w') as f:
    f.write(content)
