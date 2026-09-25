const fs = require('fs');
const cssPath = 'g:/4D-print/frontend/src/index.css';
let css = fs.readFileSync(cssPath, 'utf8');

const target1 = `.user-identity-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 56px;
  padding: 6px 8px 6px 6px;
  color: var(--text-primary);
  background: #f8f9fb;
  border: 1px solid rgba(232, 235, 237, 0.92);
  border-radius: 18px;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
}

.user-identity-card:hover {
  background: var(--primary-soft);
  border-color: rgba(255, 140, 66, 0.16);
  box-shadow: 0 10px 20px rgba(255, 140, 66, 0.12);
  transform: translateY(-1px);
}`;

const replace1 = `.user-identity-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 56px;
  padding: 6px 8px 6px 6px;
  color: var(--text-primary);
  background: #f8f9fb;
  border: 1px solid rgba(232, 235, 237, 0.92);
  border-radius: 18px;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
}

.user-identity-card:hover {
  background: var(--primary-soft);
  border-color: rgba(255, 140, 66, 0.4);
  box-shadow: 0 10px 20px rgba(255, 140, 66, 0.12);
  transform: translateY(-1px);
}

.user-identity-card:hover .user-identity-arrow {
  color: var(--primary);
}

.user-identity-card.active {
  background: var(--primary-soft);
  border-color: rgba(255, 140, 66, 0.4);
  box-shadow: 0 10px 20px rgba(255, 140, 66, 0.12);
}

.user-identity-card.active .user-identity-arrow {
  transform: rotate(180deg);
  color: var(--primary);
}

.user-identity-arrow {
  color: var(--text-tertiary);
  transition: transform 0.2s, color 0.2s;
}`;

const target2 = `.user-dropdown {
  position: absolute;
  bottom: calc(100% + 12px);
  top: auto;
  right: 0;
  background: white;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  border: 1px solid var(--border-light);
  min-width: 200px;
  z-index: 1000;
  overflow: hidden;
}

.user-dropdown-info {
  padding: 16px;
  border-bottom: 1px solid #F0F0F0;
}

.user-dropdown-info-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.user-dropdown-info-email {
  font-size: 0.8rem;
  color: #999;
  margin-top: 2px;
}

.user-dropdown-menu {
  padding: 8px 0;
}

.user-dropdown-item {
  display: block;
  padding: 10px 16px;
  color: #333;
  text-decoration: none;
  font-size: 0.9rem;
  transition: background var(--transition-fast);
}

.user-dropdown-item:hover {
  background: #F8F9FA;
}

.user-dropdown-divider {
  border-top: 1px solid #F0F0F0;
  padding: 8px 0;
}

.user-dropdown-logout {
  display: block;
  width: 100%;
  padding: 10px 16px;
  background: none;
  border: none;
  text-align: left;
  color: #e74c3c;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.user-dropdown-logout:hover {
  background: #FFF5F5;
}`;

const replace2 = `.user-dropdown {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 0;
  right: 0;
  background: white;
  border-radius: 18px;
  box-shadow: 0 8px 30px rgba(80, 50, 20, 0.08);
  border: 1px solid #F0E7DC;
  width: auto;
  z-index: 1000;
  overflow: hidden;
}

.user-dropdown-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 18px 16px;
  background: #FAF8F5;
}

.user-dropdown-info-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2f3b52 0%, #59657c 100%);
  color: white;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}

.user-dropdown-info-text {
  flex: 1;
  min-width: 0;
}

.user-dropdown-info-name {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-dropdown-info-email {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-dropdown-profile-link {
  width: 100%;
  margin-top: 10px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--primary);
  text-decoration: none;
}

.user-dropdown-profile-link:hover {
  text-decoration: underline;
}

.user-dropdown-group {
  padding: 6px 0;
}

.user-dropdown-group-title {
  padding: 6px 16px 2px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #a39c95;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.user-dropdown-item {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 6px 16px;
  color: var(--text-primary);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 600;
  transition: background 0.2s, color 0.2s;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.user-dropdown-item:hover {
  background: #FFF0E6;
  color: var(--primary-dark);
}

.user-dropdown-divider {
  height: 1px;
  background: #F0E7DC;
  margin: 4px 0;
}

.user-dropdown-logout {
  color: #e74c3c;
}

.user-dropdown-logout:hover {
  background: #FFF5F5;
  color: #c0392b;
}

.user-dropdown-item.admin-item {
  color: var(--primary);
}`;

css = css.replace(target1, replace1);
css = css.replace(target2, replace2);
fs.writeFileSync(cssPath, css);
console.log('done');
