import glob, re

files = glob.glob("*.html")

link_tag = '<link rel="stylesheet" href="css/design_system.css">'

for f in files:
    with open(f, 'r') as file:
        content = file.read()
    
    if link_tag not in content:
        # Insert link tag before </head>
        content = content.replace("</head>", f"  {link_tag}\n</head>")
    
    # Remove all the inline styles we previously injected globally
    content = re.sub(r'body\s*{[^}]*}', '', content)
    
    # Remove the massive block of global style I added via script earlier
    # To keep it clean, let's just strip out everything from @import url to table td
    block_to_remove = r"@import url\('https://fonts.googleapis.com.*?table td \{ border-color: rgba\(255, 255, 255, 0.1\) !important; \}"
    content = re.sub(block_to_remove, '', content, flags=re.DOTALL)

    with open(f, 'w') as file:
        file.write(content)
        print(f"Cleaned styles in {f}")

