import React, { useEffect, useMemo, useState } from 'react';
import { useDevice, deviceService } from '../hooks/useDevice';
import { uploadGcodeToDevice } from '../services/api';
import { useProject } from '../stores/project';
import { useToast } from '../stores/toast';
import { KlipperDeviceService } from '../services/device';
import type { PrinterDevice } from '../services/device';
import DeviceManagementModal from '../components/DeviceManagementModal';
import { FluiddEmbed } from '../components/FluiddEmbed';
import { DeviceDiscoveryModal } from '../components/DeviceDiscoveryModal';
import type { DiscoveredDevice } from '../services/discoveryService';
import { getFileName } from '../utils/path';

const getSemanticState = (device: PrinterDevice): NonNullable<PrinterDevice['state']> => {
  const state = device.state;
  if (
    state === 'printing' ||
    state === 'paused' ||
    state === 'standby' ||
    state === 'error' ||
    state === 'offline' ||
    state === 'unknown'
  ) {
    return state;
  }

  if (device.status === 'offline') return 'offline';
  if (device.isPrinting) return 'printing';
  return 'standby';
};

const getStateLabel = (device: PrinterDevice) => {
  const state = getSemanticState(device);
  if (state === 'printing') return '打印中';
  if (state === 'paused') return '已暂停';
  if (state === 'offline') return '离线';
  if (state === 'error') return '错误';
  return '待机';
};

const getStatusLabel = (device: PrinterDevice) => {
  if (device.status === 'offline') return '离线';
  if (device.status === 'unverified') return '未验证';
  return '在线';
};

const getStateTone = (state: NonNullable<PrinterDevice['state']>) => {
  if (state === 'printing') return 'hot';
  if (state === 'paused') return 'warning';
  if (state === 'offline' || state === 'error') return 'cold';
  return 'stable';
};

const getDeviceEndpoint = (device: PrinterDevice) => (
  device.location || device.moonrakerUrl || device.host || '未配置地址'
);

const formatTemp = (current: number, target: number) => `${Math.round(current)}°/${Math.round(target)}°`;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const getDeviceErrorMessage = (error: unknown, fallback: string) => {
  if (!isRecord(error) || !isRecord(error.response)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  const data = error.response.data;
  if (!isRecord(data)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  if (typeof data.message === 'string' && data.message.trim()) return data.message;
  if (typeof data.detail === 'string' && data.detail.trim()) return data.detail;
  if (isRecord(data.detail) && typeof data.detail.message === 'string' && data.detail.message.trim()) {
    return data.detail.message;
  }

  return error instanceof Error && error.message ? error.message : fallback;
};

const DeviceTelemetry: React.FC<{ device: PrinterDevice }> = ({ device }) => {
  const semanticState = getSemanticState(device);
  const stateTone = getStateTone(semanticState);
  const progress = Math.max(0, Math.min(100, Math.round(device.progress ?? 0)));
  const isActive = semanticState === 'printing' || semanticState === 'paused';
  const printName = device.printName || (semanticState === 'offline' ? '设备离线' : '当前无进行中的作业');
  const layerValue = device.totalLayers && device.totalLayers > 0
    ? `${device.currentLayer ?? 0}/${device.totalLayers}`
    : '—';
  const remainingValue = device.timeRemaining && device.timeRemaining !== '--'
    ? device.timeRemaining
    : '—';
  const elapsedValue = device.timeElapsed && device.timeElapsed !== '--'
    ? device.timeElapsed
    : '—';
  const filamentValue = device.filamentUsed || '—';
  const warningText = device.warningMessage || (device.errorMessage ? device.errorMessage : '');

  return (
    <div className="device-telemetry-shell">
      <div className="device-primary-metrics">
        <div className={`device-job-block ${stateTone}`}>
          <div className="device-job-meta">
            <span className="device-section-label">当前任务</span>
            <div className="device-print-name">{printName}</div>
          </div>
          <div className="device-progress-meta">
            <span className="device-progress-value">{progress}%</span>
            <span className="device-progress-caption">完成度</span>
          </div>
          <div className="device-progress-bar">
            <div className="device-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="device-telemetry-grid">
          <div className="device-telemetry-item">
            <span className="device-telemetry-label">喷嘴</span>
            <strong>{typeof device.nozzleTemp === 'number' && typeof device.nozzleTarget === 'number' ? formatTemp(device.nozzleTemp, device.nozzleTarget) : '—'}</strong>
          </div>
          <div className="device-telemetry-item">
            <span className="device-telemetry-label">热床</span>
            <strong>{typeof device.bedTemp === 'number' && typeof device.bedTarget === 'number' ? formatTemp(device.bedTemp, device.bedTarget) : '—'}</strong>
          </div>
          <div className="device-telemetry-item">
            <span className="device-telemetry-label">层数</span>
            <strong>{layerValue}</strong>
          </div>
          <div className="device-telemetry-item">
            <span className="device-telemetry-label">耗材</span>
            <strong>{filamentValue}</strong>
          </div>
        </div>
      </div>

      <div className="device-context-panel">
        <div className="device-context-strip">
          <div className="device-context-chip">
            <span className="device-context-chip-label">剩余</span>
            <strong>{remainingValue}</strong>
          </div>
          <div className="device-context-chip">
            <span className="device-context-chip-label">已运行</span>
            <strong>{elapsedValue}</strong>
          </div>
          <div className="device-context-chip">
            <span className="device-context-chip-label">状态</span>
            <strong>{isActive ? '任务活跃' : semanticState === 'offline' ? '不可用' : '可接单'}</strong>
          </div>
        </div>

        <div className={`device-note ${stateTone}`}>
          {semanticState === 'printing' && '打印中，可上传文件到队列'}
          {semanticState === 'paused' && '任务已暂停，可在控制中心查看详情'}
          {semanticState === 'offline' && '设备离线'}
          {(semanticState === 'standby' || semanticState === 'unknown' || !semanticState) && '设备空闲，可上传文件'}
          {semanticState === 'error' && (warningText || '设备异常，请检查控制中心')}
        </div>
      </div>
    </div>
  );
};

const FleetSummaryStrip: React.FC<{
  devices: PrinterDevice[];
}> = ({ devices }) => {
  const summary = useMemo(() => {
    const counts = devices.reduce(
      (acc, device) => {
        const semanticState = getSemanticState(device);
        acc.total += 1;
        if (device.status === 'offline' || semanticState === 'offline') acc.offline += 1;
        else acc.online += 1;
        if (semanticState === 'printing' || semanticState === 'paused') acc.active += 1;
        if (semanticState === 'error') acc.error += 1;
        return acc;
      },
      { total: 0, online: 0, offline: 0, active: 0, error: 0 },
    );

    return [
      { label: '设备总数', value: `${counts.total} 台`, tone: 'stable' },
      { label: '在线设备', value: `${counts.online} 台`, tone: counts.online > 0 ? 'good' : 'stable' },
      { label: '打印中', value: `${counts.active} 台`, tone: counts.active > 0 ? 'hot' : 'stable' },
      { label: '异常提醒', value: `${counts.error + counts.offline} 台`, tone: counts.error + counts.offline > 0 ? 'danger' : 'stable' },
    ];
  }, [devices]);

  return (
    <div className="fleet-summary-strip">
      {summary.map((item) => (
        <div key={item.label} className={`fleet-summary-card ${item.tone}`}>
          <span className="fleet-summary-label">{item.label}</span>
          <strong className="fleet-summary-value">{item.value}</strong>
        </div>
      ))}
    </div>
  );
};

const DeviceControl: React.FC = () => {
  const project = useProject();
  const [showModal, setShowModal] = useState(false);
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [editingDevice, setEditingDevice] = useState<PrinterDevice | undefined>();
  const [uploadingDeviceId, setUploadingDeviceId] = useState<string | null>(null);
  const [fluiddModalOpen, setFluiddModalOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<PrinterDevice | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'add' | 'filters' | 'help' | null>(null);
  const { showToast } = useToast();
  const { devices, loading, error, refreshDevices } = useDevice('');

  const readyFilename = project.gcodeResult?.output_path ? getFileName(project.gcodeResult.output_path) : null;

  const filteredDevices = useMemo(() => {
    return devices.filter(device => {
      const state = getSemanticState(device);
      if (activeTab === 'online' && device.status === 'offline') return false;
      if (activeTab === 'offline' && device.status !== 'offline') return false;
      if (activeTab === 'printing' && state !== 'printing') return false;
      if (activeTab === 'error' && state !== 'error') return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          device.name.toLowerCase().includes(query) ||
          (device.moonrakerUrl && device.moonrakerUrl.toLowerCase().includes(query)) ||
          (device.host && device.host.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [devices, activeTab, searchQuery]);

  const handleUploadToDevice = async (deviceId: string, startPrint = false) => {
    if (!readyFilename) return;
    setUploadingDeviceId(deviceId);
    try {
      const res = await uploadGcodeToDevice(deviceId, readyFilename, startPrint, {
        model_id: project.modelId,
        model_name: project.modelName || project.sourceFile?.name || readyFilename,
      });
      if (res.success) {
        showToast(startPrint ? 'G-code 已上传并开始打印' : 'G-code 已上传到设备', 'success');
      }
    } catch (err: unknown) {
      showToast(getDeviceErrorMessage(err, '上传失败'), 'error');
    } finally {
      setUploadingDeviceId(null);
    }
  };

  const openControlCenter = (device: PrinterDevice) => {
    const fluiddUrl = device.fluiddUrl || device.moonrakerUrl?.replace(':7125', '');
    if (!fluiddUrl && !device.moonrakerUrl) {
      showToast('该设备未配置控制中心地址', 'error');
      return;
    }
    setSelectedDevice(device);
    setFluiddModalOpen(true);
  };

  const handleAddDevice = () => {
    setEditingDevice(undefined);
    setShowModal(true);
  };

  const handleEditDevice = (device: PrinterDevice) => {
    setEditingDevice(device);
    setShowModal(true);
  };

  const handleSaveDevice = async (name: string, host: string) => {
    try {
      if (deviceService instanceof KlipperDeviceService) {
        const newDevice = await deviceService.addDevice(name, host);
        await refreshDevices();
        showToast('设备添加成功', 'success');

        if (newDevice.fluiddUrl) {
          setSelectedDevice(newDevice);
          setFluiddModalOpen(true);
        }
      }
    } catch (error: unknown) {
      showToast(getDeviceErrorMessage(error, '添加设备失败'), 'error');
      throw error;
    }
  };

  const handleUpdateDevice = async (id: string, name?: string, host?: string) => {
    try {
      if (deviceService instanceof KlipperDeviceService) {
        await deviceService.updateDevice(id, name, host);
        await refreshDevices();
        showToast('设备更新成功', 'success');
      }
    } catch (error: unknown) {
      showToast(getDeviceErrorMessage(error, '更新设备失败'), 'error');
      throw error;
    }
  };

  const handleDeleteDevice = async (id: string) => {
    try {
      if (deviceService instanceof KlipperDeviceService) {
        await deviceService.deleteDevice(id);
        await refreshDevices();
        showToast('设备删除成功', 'success');
      }
    } catch (error: unknown) {
      showToast(getDeviceErrorMessage(error, '删除设备失败'), 'error');
      throw error;
    }
  };

  const handleAddDiscoveredDevice = async (device: DiscoveredDevice) => {
    try {
      if (deviceService instanceof KlipperDeviceService) {
        const newDevice = await deviceService.addDevice(device.name, device.moonraker_url || device.ip);
        await refreshDevices();
        showToast(`已添加设备: ${device.name}`, 'success');
        if (newDevice.fluiddUrl) {
          setSelectedDevice(newDevice);
          setFluiddModalOpen(true);
        }
      }
    } catch (error: unknown) {
      showToast(getDeviceErrorMessage(error, '添加设备失败'), 'error');
    }
  };

  const canManageDevices = deviceService instanceof KlipperDeviceService;

  useEffect(() => {
    document.body.classList.toggle('device-mobile-panel-open', mobilePanel !== null);
    return () => document.body.classList.remove('device-mobile-panel-open');
  }, [mobilePanel]);

  return (
    <div className={`device-dashboard-page page-enter ${mobilePanel ? `mobile-panel-${mobilePanel}` : ''}`}>
      <div className="route-shell__rail route-shell__rail--wide device-dashboard-rail">
        {mobilePanel && (
          <div className="mobile-panel-backdrop device-mobile-backdrop" aria-hidden="true" onClick={() => setMobilePanel(null)} />
        )}
        <div className="page-header device-dashboard-header">
          <div>
            <h1 className="page-title">打印机管理</h1>
            <p className="page-subtitle">查看所有打印机的实时状态和作业进度</p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary" onClick={() => setShowDiscoveryModal(true)}>
              🔍 扫描网络
            </button>
            <button className="btn btn-primary" onClick={handleAddDevice}>+ 添加设备</button>
          </div>
        </div>

        {!loading && !error && (
          <div className="device-mobile-command-bar" aria-label="Device mobile actions">
            <button type="button" onClick={() => setMobilePanel('add')}>添加</button>
            <button type="button" onClick={() => setMobilePanel('filters')}>筛选</button>
            <button type="button" onClick={() => setMobilePanel('help')}>帮助</button>
          </div>
        )}

        {!loading && !error && (
          <FleetSummaryStrip
            devices={devices}
          />
        )}

        {/* Add Device Methods Section */}
        {!loading && !error && (
          <div className="add-device-methods-section animate-fade-in-up">
            <div className="mobile-panel-head device-mobile-panel-head">
              <div>
                <strong>添加打印机</strong>
                <span>扫描、手动添加或绑定本地设备</span>
              </div>
              <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
            </div>
            <h2 className="add-device-methods-title">
              添加打印机 <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: '12px' }}>选择一种方式连接你的打印设备</span>
            </h2>
            <div className="add-device-methods-grid">
              <div className="add-device-card recommended" onClick={() => setShowDiscoveryModal(true)}>
                <div className="add-device-card-badge">推荐</div>
                <div className="add-device-card-icon">🔍</div>
                <div className="add-device-card-content">
                  <h3>扫描局域网</h3>
                  <p>自动发现同一网络下的打印机</p>
                </div>
              </div>
              <div className="add-device-card" onClick={handleAddDevice}>
                <div className="add-device-card-icon">🌐</div>
                <div className="add-device-card-content">
                  <h3>手动添加 IP</h3>
                  <p>输入打印机 IP 地址进行连接</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Device List Toolbar */}
        {!loading && !error && (
          <div className="device-list-toolbar animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            <div className="mobile-panel-head device-mobile-panel-head">
              <div>
                <strong>筛选设备</strong>
                <span>状态标签、搜索和刷新</span>
              </div>
              <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>设备列表</div>
              <div className="device-list-tabs">
                <button className={`device-list-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>全部</button>
                <button className={`device-list-tab ${activeTab === 'online' ? 'active' : ''}`} onClick={() => setActiveTab('online')}>在线</button>
                <button className={`device-list-tab ${activeTab === 'offline' ? 'active' : ''}`} onClick={() => setActiveTab('offline')}>离线</button>
                <button className={`device-list-tab ${activeTab === 'printing' ? 'active' : ''}`} onClick={() => setActiveTab('printing')}>打印中</button>
                <button className={`device-list-tab ${activeTab === 'error' ? 'active' : ''}`} onClick={() => setActiveTab('error')}>异常</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input
                type="text"
                className="device-list-search"
                placeholder="搜索设备名称或 IP..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <button className="btn btn-secondary" onClick={refreshDevices}>🔄 刷新</button>
            </div>
          </div>
        )}

        {loading && (
          <div className="empty-state device-dashboard-state">
            <div className="empty-state-icon" style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>⚙️</div>
            <p>加载设备中...</p>
          </div>
        )}

        {error && (
          <div className="device-dashboard-state device-dashboard-state--error">
            <div className="alert alert-error">
              <span>⚠️</span> 加载失败: {error}
            </div>
          </div>
        )}

        {!loading && !error && filteredDevices.length === 0 ? (
          <div className="compact-empty-state animate-fade-in-up" style={{ animationDelay: '0.2s', minHeight: '220px', padding: '24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.8 }}>🖨️</div>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 600 }}>
              {searchQuery || activeTab !== 'all' ? '没有找到符合条件的设备' : '暂无已添加设备'}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginBottom: '20px' }}>
              你可以扫描局域网或手动添加打印机
            </p>
            <div className="device-empty-actions" style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-primary" onClick={() => setShowDiscoveryModal(true)}>
                扫描网络
              </button>
              <button className="btn btn-secondary" onClick={handleAddDevice}>手动添加</button>
              <button className="btn btn-secondary" onClick={() => {
                document.getElementById('help-section')?.scrollIntoView({ behavior: 'smooth' });
              }}>查看连接帮助</button>
            </div>
          </div>
        ) : (
          !loading && !error && (
            <div className={`device-grid device-dashboard-grid ${filteredDevices.length === 1 ? 'single-device' : ''} animate-fade-in-up`} style={{ animationDelay: '0.2s' }}>
              {filteredDevices.map((device) => {
                const semanticState = getSemanticState(device);
                const canUpload = Boolean(readyFilename) && device.status !== 'offline';
                const isBusy = semanticState === 'printing' || semanticState === 'paused';

                return (
                  <article
                    key={device.id}
                    className={`device-card ${semanticState}`}
                  >
                  <div className="device-card-top device-card-header-row">
                    <div className="device-card-identity">
                      <div className="device-name-row">
                        <div className="device-name">{device.name}</div>
                        <div className="device-status-badge">
                          <span className={`status-dot ${semanticState === 'paused' ? 'printing' : device.status}`} />
                          {getStateLabel(device)} · {getStatusLabel(device)}
                        </div>
                      </div>
                      <div className="device-meta-row">
                        <span className="device-location">{getDeviceEndpoint(device)}</span>
                        {device.fluiddUrl && <span className="device-meta-pill">Fluidd</span>}
                        {device.klippyState && <span className="device-meta-pill">{device.klippyState}</span>}
                        {isBusy && <span className="device-meta-pill busy">任务占用</span>}
                      </div>
                    </div>
                  </div>

                  <DeviceTelemetry device={device} />

                  <div className="device-actions-panel">
                    <div className="device-actions device-actions-primary">
                      <button
                        className="btn btn-secondary"
                        onClick={() => openControlCenter(device)}
                        disabled={device.status === 'offline'}
                      >
                        打开控制中心
                      </button>
                      {canUpload && (
                        <button
                          className="btn btn-primary"
                          onClick={() => handleUploadToDevice(device.id, false)}
                          disabled={uploadingDeviceId === device.id}
                        >
                          {uploadingDeviceId === device.id ? '上传中...' : '上传文件'}
                        </button>
                      )}
                      {canUpload && (
                        <button
                          className="btn btn-success"
                          onClick={() => handleUploadToDevice(device.id, true)}
                          disabled={uploadingDeviceId === device.id}
                        >
                          {uploadingDeviceId === device.id ? '处理中...' : '上传并开始'}
                        </button>
                      )}
                    </div>

                    {canManageDevices && (
                      <div className="device-actions device-actions-secondary">
                        <button className="btn btn-secondary btn-sm" onClick={() => handleEditDevice(device)}>
                          编辑设备
                        </button>
                      </div>
                    )}
                  </div>
                  </article>
                );
              })}
            </div>
          )
        )}

        {/* Help Section */}
        {!loading && !error && (
          <div id="help-section" className="help-section-card animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            <div className="mobile-panel-head device-mobile-panel-head">
              <div>
                <strong>连接帮助</strong>
                <span>网络、电源、IP 和支持型号检查</span>
              </div>
              <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
            </div>
            <h2 className="help-section-title">连接遇到问题？</h2>
            <div className="help-section-grid">
              <div className="help-item">
                <div className="help-item-icon">📡</div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>同一局域网</div>
                  确认电脑和打印机连接到同一网络
                </div>
              </div>
              <div className="help-item">
                <div className="help-item-icon">🔌</div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>检查电源</div>
                  确认打印机已开机并允许联网
                </div>
              </div>
              <div className="help-item">
                <div className="help-item-icon">⌨️</div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>手动添加 IP</div>
                  扫描不到时可以输入 IP 地址
                </div>
              </div>
              <div className="help-item" style={{ cursor: 'pointer' }} onClick={() => showToast('正在跳转设备支持列表...', 'info')}>
                <div className="help-item-icon">📋</div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>支持型号</div>
                  <div style={{ color: 'var(--primary)' }}>查看支持的打印机型号 &rarr;</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <DeviceManagementModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handleSaveDevice}
          onUpdate={handleUpdateDevice}
          onDelete={handleDeleteDevice}
          editingDevice={editingDevice}
        />
      )}

      {fluiddModalOpen && selectedDevice && (
        <FluiddEmbed
          moonrakerUrl={selectedDevice.moonrakerUrl || ''}
          fluiddUrl={selectedDevice.fluiddUrl}
          isOpen={fluiddModalOpen}
          onClose={() => setFluiddModalOpen(false)}
        />
      )}

      <DeviceDiscoveryModal
        isOpen={showDiscoveryModal}
        onClose={() => setShowDiscoveryModal(false)}
        onAddDevice={handleAddDiscoveredDevice}
      />
    </div>
  );
};

export default DeviceControl;
