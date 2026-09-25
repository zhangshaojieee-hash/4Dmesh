import React from 'react';
import { Link } from 'react-router-dom';

const NotFound: React.FC = () => {
  return (
    <div className="page-enter not-found-page">
      <div className="not-found-panel">
        <div className="not-found-code">404</div>
        <h2>页面不存在</h2>
        <p>你访问的页面可能已被移除或地址有误</p>
        <div className="not-found-actions">
          <Link to="/" className="btn btn-primary">返回首页</Link>
          <Link to="/models" className="btn btn-secondary">浏览模型库</Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
