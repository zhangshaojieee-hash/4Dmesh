import { useState } from 'react';
import { discoveryService } from '../services/discoveryService';
import type { DiscoveredDevice } from '../services/discoveryService';

interface DeviceDiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddDevice: (device: DiscoveredDevice) => void;
}

export function DeviceDiscoveryModal({ isOpen, onClose, onAddDevice }: DeviceDiscoveryModalProps) {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subnet, setSubnet] = useState('192.168.1.0/24');
  const [scanMethod, setScanMethod] = useState<'subnet' | 'mdns'>('mdns');

  if (!isOpen) return null;

  const handleScan = async () => {
    setLoading(true);
    setError(null);
    setDevices([]);
    
    try {
      const result = scanMethod === 'subnet'
        ? await discoveryService.scanSubnet(subnet)
        : await discoveryService.scanMDNS();
      
      setDevices(result);
      
      if (result.length === 0) {
        setError('未发现任何打印机。请确保打印机已开机并连接到同一网络。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDevice = (device: DiscoveredDevice) => {
    onAddDevice(device);
    onClose();
  };

  return (
    <div className="device-discovery-overlay">
      <div className="device-discovery-modal">
        <div className="device-discovery-header">
          <h2>发现打印机</h2>
          <button
            onClick={onClose}
            className="device-discovery-close"
            aria-label="关闭发现打印机弹窗"
          >
            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="device-discovery-controls">
          <div className="device-discovery-methods">
            <button
              onClick={() => setScanMethod('mdns')}
              className={`device-discovery-method ${scanMethod === 'mdns' ? 'active' : ''}`}
            >
              mDNS 扫描（推荐）
            </button>
            <button
              onClick={() => setScanMethod('subnet')}
              className={`device-discovery-method ${scanMethod === 'subnet' ? 'active' : ''}`}
            >
              子网扫描
            </button>
          </div>

          {scanMethod === 'subnet' && (
            <div className="device-discovery-subnet">
              <label>
                子网 CIDR
              </label>
              <input
                type="text"
                value={subnet}
                onChange={(e) => setSubnet(e.target.value)}
                placeholder="192.168.1.0/24"
                disabled={loading}
                className="device-discovery-input"
              />
              <p>
                例如：192.168.1.0/24 或 192.168.0.0/24
              </p>
            </div>
          )}

          <button
            onClick={handleScan}
            disabled={loading}
            className="device-discovery-scan"
          >
            {loading ? (
              <span className="device-discovery-loading">
                <svg className="device-discovery-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                扫描中...
              </span>
            ) : (
              '开始扫描'
            )}
          </button>
        </div>

        <div className="device-discovery-body">
          {error && (
            <div className="device-discovery-error">
              {error}
            </div>
          )}

          {devices.length > 0 && (
            <div className="device-discovery-results">
              <p className="device-discovery-count">
                发现 {devices.length} 台打印机
              </p>
              {devices.map((device) => (
                <div
                  key={device.ip}
                  className="device-discovery-card"
                >
                  <div className="device-discovery-card-head">
                    <div>
                      <h3>{device.name}</h3>
                      <p>IP: {device.ip}</p>
                      {device.hostname && device.hostname !== device.ip && (
                        <p className="device-discovery-muted">主机名: {device.hostname}</p>
                      )}
                    </div>
                    <span className="device-discovery-online">
                      在线
                    </span>
                  </div>
                  
                  <p className="device-discovery-url">
                    Moonraker: {device.moonraker_url}
                  </p>

                  {device.printer_info && (
                    <div className="device-discovery-info">
                      {device.printer_info.software_version && (
                        <p>版本: {device.printer_info.software_version}</p>
                      )}
                      {device.printer_info.cpu_info && (
                        <p>CPU: {device.printer_info.cpu_info}</p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => handleAddDevice(device)}
                    className="device-discovery-add"
                  >
                    添加此设备
                  </button>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && devices.length === 0 && (
            <div className="device-discovery-empty">
              <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p>点击"开始扫描"发现网络中的打印机</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
