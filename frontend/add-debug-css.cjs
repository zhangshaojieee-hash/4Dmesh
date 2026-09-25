const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'index.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');

// Append debug styles
cssContent += `
.market-model-body {
  border: 5px solid red !important;
  background: yellow !important;
  min-height: 100px !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
}

.market-model-meta {
  border: 5px solid blue !important;
  min-height: 50px !important;
}
`;

fs.writeFileSync(cssPath, cssContent);
console.log('Debug CSS added');
