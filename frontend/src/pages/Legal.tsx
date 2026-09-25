import React from 'react';

type LegalPageProps = {
  type: 'terms' | 'privacy';
};

const content = {
  terms: {
    title: '用户协议',
    intro: '本协议用于说明你在使用创客学堂模型库、AI 创作、G-code 编辑和设备控制等功能时的基本权利与责任。',
    sections: [
      ['账号与使用', '请使用真实、有效的信息注册和登录账号，并妥善保管账号凭据。你需要对账号下的上传、编辑、打印和设备管理行为负责。'],
      ['内容与模型', '你上传或生成的模型应当拥有合法使用权，不得包含侵权、违法或危害设备安全的内容。平台可在必要时移除违规内容或限制相关功能。'],
      ['设备与打印风险', '设备控制、切片和打印过程可能涉及高温、运动部件和材料风险。请在确认设备状态、材料参数和 G-code 内容后再执行打印。'],
      ['服务调整', '平台可能根据功能迭代、维护或安全需要调整部分服务。重要调整会在合理范围内通过页面提示或公告说明。'],
    ],
  },
  privacy: {
    title: '隐私政策',
    intro: '本政策说明创客学堂如何处理你在注册、上传模型、生成内容、保存项目和管理设备时产生的信息。',
    sections: [
      ['收集的信息', '我们会处理账号资料、邮箱验证码、手机号、模型文件、项目配置、设备连接信息以及必要的操作日志，用于提供和维护核心功能。'],
      ['信息用途', '相关信息用于身份验证、模型管理、AI 生成、切片处理、设备连接、问题排查和安全审计，不会用于与产品功能无关的目的。'],
      ['数据保护', '我们会采用合理的访问控制和安全措施保护数据。请不要在模型描述、文件名或提示词中提交敏感个人信息。'],
      ['你的选择', '你可以在账号和项目功能中管理自己的资料、模型和项目。涉及账号删除或数据导出时，可通过平台后续提供的支持渠道处理。'],
    ],
  },
} as const;

const Legal: React.FC<LegalPageProps> = ({ type }) => {
  const page = content[type];

  return (
    <div className="legal-page page-enter">
      <div className="route-shell__rail route-shell__rail--readable legal-document-rail">
        <header className="legal-hero">
          <p className="legal-eyebrow">创客学堂</p>
          <h1>{page.title}</h1>
          <p>{page.intro}</p>
        </header>
        <div className="legal-sections">
          {page.sections.map(([title, body]) => (
            <section key={title} className="legal-section">
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Legal;
