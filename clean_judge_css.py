import re
with open('judge.html', 'r') as f:
    content = f.read()

new_style = """<style>
        .header-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .header-right { display: flex; align-items: center; gap: 12px; }
        
        .scorer-badge { background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid rgba(59, 130, 246, 0.4); }
        .admin-bar { display: none; }
        
        .q-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
        .q-card { background: rgba(30, 41, 59, 0.6); backdrop-filter: blur(8px); border-radius: 12px; padding: 16px; text-align: center; border: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; height: 100%; }
        .q-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); background: rgba(30, 41, 59, 0.8); }
        
        .q-num { font-size: 20px; font-weight: 800; color: var(--text-main); margin-bottom: 12px; }
        .q-scorers { font-size: 11px; color: var(--text-muted); min-height: 44px; margin-bottom: 12px; line-height: 1.4; display: flex; align-items: center; justify-content: center; }
        .q-status { padding: 6px 0; border-radius: 6px; font-size: 12px; font-weight: 600; margin-top: auto; }
        
        .q-card.mine { border-color: rgba(59, 130, 246, 0.5); box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); }
        .q-card.locked { opacity: 0.6; cursor: not-allowed; }
        .q-card.done { border-color: rgba(16, 185, 129, 0.4); }
        
        .status-open { background: rgba(255,255,255,0.05); color: var(--text-muted); }
        .status-inprogress { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
        .status-done { background: rgba(16, 185, 129, 0.2); color: #34d399; }
        .status-locked { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    </style>"""

content = re.sub(r'<style>.*?</style>', new_style, content, flags=re.DOTALL)
content = content.replace('<h1>', '<h1 id="project-title">')

with open('judge.html', 'w') as f:
    f.write(content)

