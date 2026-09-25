const fs = require('fs');
const cssPath = 'g:/4D-print/frontend/src/index.css';

const newCss = `

/* ================================
   打印机管理页新增样式 (DeviceControl)
   ================================ */

.add-device-section {
  margin-bottom: 24px;
}
.add-device-section h2 {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 16px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.add-device-section h2 span {
  font-size: 0.85rem;
  color: var(--text-tertiary);
  font-weight: 500;
}
.add-device-methods-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.add-device-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid rgba(230, 230, 230, 0.8);
  border-radius: 18px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 140px;
}
.add-device-card:hover {
  border-color: rgba(255, 140, 66, 0.5);
  box-shadow: 0 8px 24px rgba(255, 140, 66, 0.08);
  transform: translateY(-2px);
}
.add-device-card.recommended {
  border-color: rgba(255, 140, 66, 0.4);
  background: linear-gradient(180deg, #fffcf9 0%, #fff 100%);
}
.add-device-card-badge {
  position: absolute;
  top: -10px;
  right: 20px;
  background: var(--primary);
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(255, 140, 66, 0.25);
}
.add-device-card-icon {
  font-size: 1.8rem;
  margin-bottom: 12px;
  line-height: 1;
}
.add-device-card-content h3 {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}
.add-device-card-content p {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
  margin: 0;
}

.device-list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  background: var(--bg-card);
  padding: 12px 20px;
  border-radius: 18px;
  border: 1px solid rgba(230, 230, 230, 0.8);
}
.device-list-tabs {
  display: flex;
  gap: 8px;
  background: var(--bg-page);
  padding: 4px;
  border-radius: 12px;
}
.device-list-tab {
  border: none;
  background: transparent;
  padding: 6px 16px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}
.device-list-tab:hover {
  color: var(--text-primary);
}
.device-list-tab.active {
  background: white;
  color: var(--primary);
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}
.device-list-search {
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 8px 16px;
  font-size: 0.85rem;
  width: 240px;
  outline: none;
  transition: all 0.2s;
  background: var(--bg-page);
}
.device-list-search:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(255, 140, 66, 0.1);
}

.compact-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: var(--bg-card);
  border: 1px dashed var(--border-light);
  border-radius: 18px;
  padding: 40px;
}
`;

fs.appendFileSync(cssPath, newCss);
console.log('Appended CSS to index.css');
