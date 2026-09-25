const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'index.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');

// Add .market-model-meta
const newCSS = `
.market-model-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.market-model-meta .market-model-author {
  margin-top: 0;
  display: flex;
  align-items: center;
}

.market-model-meta .market-model-stats {
  margin-top: 0;
  gap: 10px;
}
`;

cssContent += newCSS;
fs.writeFileSync(cssPath, cssContent);
console.log('Model meta CSS added');
