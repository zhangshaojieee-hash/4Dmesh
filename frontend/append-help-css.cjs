const fs = require('fs');
const cssPath = 'g:/4D-print/frontend/src/index.css';

const newCss = `

/* Help Section */
.help-section-card {
  background: var(--bg-card);
  border: 1px solid rgba(230, 230, 230, 0.8);
  border-radius: 18px;
  padding: 24px;
  margin-top: 24px;
}
.help-section-title {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 20px;
}
.help-section-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.help-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: var(--bg-page);
  border-radius: 12px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.5;
  transition: all 0.2s;
}
.help-item:hover {
  background: #FFF0E6;
  transform: translateY(-1px);
}
.help-item-icon {
  font-size: 1.4rem;
  line-height: 1;
}
`;

fs.appendFileSync(cssPath, newCss);
console.log('Appended Help Section CSS to index.css');
