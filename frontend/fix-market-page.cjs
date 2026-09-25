const fs = require('fs');
const cssPath = 'g:/4D-print/frontend/src/index.css';

let css = fs.readFileSync(cssPath, 'utf8');

// Replace .market-page width
css = css.replace(
  /\.market-page\s*\{\s*width:\s*min\(100%,\s*calc\(100vw\s*-\s*\(var\(--page-gutter\)\s*\*\s*2\)\)\);\s*min-width:\s*0;\s*margin:\s*0\s*auto;/g,
  `.market-page {
  width: min(calc(100% - (var(--page-gutter) * 2)), var(--content-workbench-max-width));
  min-width: 0;
  margin-inline: auto;`
);

fs.writeFileSync(cssPath, css);
console.log('Fixed market-page layout');
