const fs = require('fs');
const cssPath = 'g:/4D-print/frontend/src/index.css';

let css = fs.readFileSync(cssPath, 'utf8');

// Replace the existing radius variables and add text variables
const targetBlock = `  /* 圆角 - 更柔和现代 */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-2xl: 32px;
  --radius-full: 9999px;`;

const newBlock = `  /* 圆角体系 (Radius) */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-2xl: 24px;
  --radius-full: 9999px;
  
  /* 文字排版体系 (Typography) */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;`;

if (css.includes('/* 圆角 - 更柔和现代 */')) {
  // Try exactly matching target block by doing a regex replacement to handle line endings
  css = css.replace(/\/\*\s*圆角 - 更柔和现代\s*\*\/[\s\S]*?--radius-full:\s*9999px;/, newBlock);
} else {
  // fallback insert before `/* 间距 */`
  css = css.replace('  /* 间距 */', newBlock + '\n\n  /* 间距 */');
}

fs.writeFileSync(cssPath, css);
console.log('Variables added to :root');
