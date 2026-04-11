import re
with open('question.html', 'r') as f:
    content = f.read()

new_style = """<style>
        .fixed-header { position: fixed; top: 0; left: 0; right: 0; background: rgba(15, 36, 64, 0.9); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.1); padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; z-index: 100; box-shadow: var(--shadow-md); }
        .q-badge { background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 6px 16px; border-radius: var(--radius-pill); font-weight: 800; font-size: 16px; border: 1px solid rgba(59, 130, 246, 0.4); }
        .answer-badge { font-size: 24px; font-weight: bold; letter-spacing: 2px; }
        .progress-text { color: var(--text-muted); font-size: 13px; font-weight: 600; }

        .answer-grid { margin-top: 80px; padding: 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; padding-bottom: 60px; }
        .answer-card { background: rgba(30, 41, 59, 0.6); backdrop-filter: blur(8px); border: 2px solid transparent; border-radius: 12px; padding: 12px; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); text-align: center; display: flex; flex-direction: column; justify-content: space-between; height: 100%; box-shadow: var(--shadow-sm); }
        .answer-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); background: rgba(30, 41, 59, 0.8); }
        .answer-card.correct { border-color: rgba(16, 185, 129, 0.6); background: rgba(16, 185, 129, 0.1); }
        .answer-card.wrong { border-color: rgba(239, 68, 68, 0.6); background: rgba(239, 68, 68, 0.1); }
        .answer-card.hold { border-color: rgba(245, 158, 11, 0.6); background: rgba(245, 158, 11, 0.1); }
        .answer-card img { width: 100%; height: 80px; object-fit: contain; border-radius: 6px; background: white; margin-bottom: 12px; }
        .entry-num { font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
        .answer-card.selected { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5), 0 0 20px rgba(59, 130, 246, 0.3); transform: scale(1.02); z-index: 10; border-color: #3b82f6; }

        .loading { grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--text-muted); font-size: 16px; font-weight: 600; }

        .shortcut-bar { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px); border-top: 1px solid rgba(255,255,255,0.1); padding: 12px 20px; display: flex; gap: 24px; justify-content: center; font-size: 13px; color: var(--text-muted); z-index: 100; font-weight: 600; }
        .shortcut-bar kbd { background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 6px; font-family: monospace; font-size: 12px; margin-right: 6px; color: white; border: 1px solid rgba(255,255,255,0.2); }

        .mobile-action-bar { display: none; position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px); border-top: 2px solid var(--primary); padding: 12px 16px; gap: 12px; z-index: 100; }
        .mobile-action-bar .btn { flex: 1; padding: 16px; font-size: 20px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; color: white !important; }
        .mobile-action-bar .btn span { font-size: 12px; font-weight: 800; }
        @media (hover: none) and (pointer: coarse) {
            .shortcut-bar { display: none; }
            .mobile-action-bar { display: flex; }
            .answer-grid { padding-bottom: 120px; }
        }

        .preview-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.9); backdrop-filter:blur(10px); z-index:1000; display:none; overflow-y:auto; padding:24px; }
        .preview-overlay.show { display:block; animation: fadeIn 0.3s; }
        .preview-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
        
        .preview-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; }
        .preview-grid .pv-item { background:var(--glass-bg); border-radius:12px; padding:12px; text-align:center; border: 1px solid var(--glass-border); }
        .preview-grid .pv-item img { width:100%; background:white; border-radius:6px; cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>'), auto; }
        .preview-grid .pv-item .pv-label { font-size:12px; color:var(--text-muted); margin-top:8px; font-weight:600; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    </style>"""

content = re.sub(r'<style>.*?</style>', new_style, content, flags=re.DOTALL)

with open('question.html', 'w') as f:
    f.write(content)

