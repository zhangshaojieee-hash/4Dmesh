import React, { useState, useEffect } from 'react';
import { deviceService } from '../hooks/useDevice';
import { KlipperDeviceService } from '../services/device';

type ApiError = {
  response?: {
    data?: {
      message?: string;
      detail?: string | { message?: string };
    };
  };
  message?: string;
};

const getApiErrorMessage = (error: unknown, fallback: string) => {
  const apiError = error as ApiError;
  const detail = apiError.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  return (
    apiError.response?.data?.message ||
    detail?.message ||
    apiError.message ||
    fallback
  );
};

interface DeviceConfig {
  id: string;
  name: string;
  host?: string;
  moonrakerUrl?: string;
  fluiddUrl?: string;
}

interface DeviceManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, host: string) => Promise<void>;
  onUpdate: (id: string, name?: string, host?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  editingDevice?: DeviceConfig;
}

const DeviceManagementModal: React.FC<DeviceManagementModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onUpdate,
  onDelete,
  editingDevice,
}) => {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'warning' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving'>('idle');

  useEffect(() => {
    if (editingDevice) {
      setName(editingDevice.name);
      setHost(editingDevice.moonrakerUrl || editingDevice.host || '');
    } else {
      setName('');
      setHost('');
    }
    setTestStatus('idle');
    setTestMessage('');
    setSaveStatus('idle');
  }, [editingDevice, isOpen]);

  useEffect(() => {
    setTestStatus('idle');
    setTestMessage('');
  }, [host]);

  const handleTestConnection = async () => {
    if (!host.trim()) return;
    
    setTestStatus('testing');
    setTestMessage('');
    
    try {
      if (deviceService instanceof KlipperDeviceService) {
        const result = await deviceService.verifyDevice(host.trim());
        
        if (result.success) {
          if (result.warningCode) {
            setTestStatus('warning');
            setTestMessage(result.warningMessage || result.message);
          } else {
            setTestStatus('success');
            setTestMessage(result.message);
          }
        } else {
          setTestStatus('error');
          setTestMessage(result.message);
        }
      }
    } catch (error: unknown) {
      setTestStatus('error');
      setTestMessage(getApiErrorMessage(error, '无法连接到设备'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim() || !host.trim()) return;
    
    setSaveStatus('saving');
    
    try {
      if (editingDevice) {
        await onUpdate(editingDevice.id, name.trim(), host.trim());
      } else {
        await onSave(name.trim(), host.trim());
      }
      onClose();
    } catch (error: unknown) {
      setTestStatus('error');
      setTestMessage(getApiErrorMessage(error, '保存失败'));
    } finally {
      setSaveStatus('idle');
    }
  };

  const handleDelete = () => {
    if (editingDevice && confirm(`确定删除设备 "${editingDevice.name}" 吗？`)) {
      onDelete(editingDevice.id);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content animate-panel-in" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">
          {editingDevice ? '编辑设备' : '添加设备'}
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">设备名称</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: Klipper Printer 1"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">打印机 IP / Host</label>
            <div className="form-input-group">
              <input
                type="text"
                className="form-input"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                required
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleTestConnection}
                disabled={testStatus === 'testing' || !host.trim()}
              >
                {testStatus === 'testing' ? '测试中...' : '测试连接'}
              </button>
            </div>
            {testStatus !== 'idle' && testStatus !== 'testing' && (
              <p className={`connection-status ${testStatus}`}>{testMessage}</p>
            )}
            <p className="form-hint">输入打印机的 IP 地址或主机名</p>
          </div>

          <div className="modal-actions">
            {editingDevice && (
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                删除
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? '保存中...' : (editingDevice ? '保存' : '添加')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeviceManagementModal;
