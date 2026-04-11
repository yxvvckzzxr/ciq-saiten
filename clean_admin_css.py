import re
with open('admin.html', 'r') as f:
    content = f.read()

# We want to replace the whole <style>...</style> with only what's specific to admin.html
# Specific things: .stats, .progress-overview, .po-cell, .answer-item, .ans-preview, .modal, .toast

new_style = """<style>
        .top-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
        .tabs { display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 1px solid var(--glass-border); overflow-x: auto; padding-bottom: 4px; }
        .tab-btn { padding: 10px 16px; background: transparent; border: none; color: var(--text-muted); font-size: 14px; font-weight: 600; cursor: pointer; border-radius: 8px 8px 0 0; transition: all 0.2s; white-space: nowrap; }
        .tab-btn.active { color: var(--primary); background: rgba(59, 130, 246, 0.1); border-bottom: 2px solid var(--primary); }
        .tab-btn:hover:not(.active) { color: var(--text-main); background: rgba(255,255,255,0.05); }
        .tab-content { display: none; }
        .tab-content.active { display: block; animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

        .section { margin-bottom: 24px; }
        .section h2 { font-size: 16px; color: var(--text-main); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }

        .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; margin-bottom: 20px; }
        .stat-card { text-align: center; padding: 20px; }
        .stat-num { font-size: 32px; font-weight: 800; color: var(--primary); background: linear-gradient(135deg, #60a5fa, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .stat-label { font-size: 12px; color: var(--text-muted); margin-top: 8px; font-weight: 600; text-transform: uppercase; }

        .progress-overview { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
        .po-cell { aspect-ratio: 1; border-radius: 4px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 9px; color: var(--text-muted); font-weight: bold; border: 1px solid transparent; transition: all 0.2s; }
        .po-cell:hover { transform: scale(1.1); z-index: 10; box-shadow: var(--shadow-sm); }
        .po-cell.done { background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: rgba(16, 185, 129, 0.4); }
        .po-cell.conflict { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-color: rgba(245, 158, 11, 0.4); }
        .po-cell.confirmed { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border-color: rgba(59, 130, 246, 0.4); }
        .po-cell.inprogress { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border-color: rgba(148, 163, 184, 0.4); }

        .answer-item { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); margin-bottom: 8px; }
        .ans-preview { width: 120px; height: 36px; object-fit: contain; cursor: pointer; border-radius: 4px; background: white; transition: transform 0.2s; }
        .ans-preview:hover { transform: scale(1.05); }

        .toast { position: fixed; bottom: 20px; right: 20px; padding: 12px 24px; border-radius: 8px; background: rgba(16, 185, 129, 0.9); backdrop-filter: blur(8px); color: white; font-weight: 600; font-size: 14px; z-index: 9999; box-shadow: 0 10px 25px rgba(0,0,0,0.3); opacity: 0; pointer-events: none; transition: opacity 0.3s, transform 0.3s; transform: translateY(10px); }
        .toast.show { opacity: 1; pointer-events: auto; transform: translateY(0); }
    </style>"""

content = re.sub(r'<style>.*?</style>', new_style, content, flags=re.DOTALL)

# Add generic container classes
content = content.replace('<div class="section">', '<div class="section glass-panel">')

with open('admin.html', 'w') as f:
    f.write(content)

