const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'index.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');

const newCSS = `
/* ================================
   AI Create Sidebar Styles
   ================================ */

.ai-create-tabs-wrapper {
  display: flex;
  background: var(--bg-secondary);
  border-radius: var(--radius-xl);
  padding: 6px;
  margin-bottom: 20px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);
}

.ai-create-tab-btn {
  flex: 1;
  padding: 10px 0;
  border-radius: var(--radius-lg);
  border: none;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--transition-normal);
  background: transparent;
  color: var(--text-tertiary);
}

.ai-create-tab-btn:hover:not(:disabled):not(.active) {
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.4);
}

.ai-create-tab-btn.active {
  background: var(--bg-card);
  color: var(--primary);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}

.ai-create-tab-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.ai-upload-box {
  border: 1.5px dashed var(--border-medium);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all var(--transition-normal);
  background: var(--bg-card);
  overflow: hidden;
  text-align: center;
  position: relative;
}

.ai-upload-box.empty {
  padding: 36px 16px;
  background: var(--bg-secondary);
}

.ai-upload-box:hover:not(.has-image) {
  border-color: var(--primary-light);
  background: var(--primary-soft);
  transform: translateY(-2px);
}

.ai-upload-box.has-image {
  padding: 0;
  border-style: solid;
  border-color: transparent;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.ai-quality-grid {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.ai-quality-btn {
  flex: 1;
  padding: 12px 4px;
  border-radius: var(--radius-lg);
  border: 1.5px solid transparent;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: all var(--transition-normal);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.ai-quality-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  background: var(--bg-hover);
}

.ai-quality-btn.active {
  background: var(--primary-soft);
  border-color: var(--primary);
  box-shadow: 0 4px 12px rgba(255, 140, 66, 0.15);
}

.ai-quality-btn.active .ai-quality-title {
  color: var(--primary);
}

.ai-quality-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-primary);
  transition: color var(--transition-fast);
}

.ai-quality-desc {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.ai-generate-btn {
  width: 100%;
  height: 48px;
  border-radius: var(--radius-xl);
  font-size: 1rem;
  font-weight: 800;
  border: none;
  cursor: pointer;
  transition: all var(--transition-normal);
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  color: #fff;
  box-shadow: 0 8px 20px rgba(255, 140, 66, 0.25);
  margin-top: 8px;
}

.ai-generate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(255, 140, 66, 0.35);
}

.ai-generate-btn:disabled {
  cursor: not-allowed;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  box-shadow: none;
  transform: none;
}
`;

cssContent += newCSS;
fs.writeFileSync(cssPath, cssContent);
console.log('AI Create CSS added');
