import apiClient from './api';

const DEVICE_BASE = '/devices';

export interface PrinterDevice {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'unverified';
  isPrinting: boolean;
  state?: 'printing' | 'paused' | 'standby' | 'error' | 'offline' | 'unknown';
  host?: string;
  fluiddUrl?: string;
  moonrakerUrl?: string;
  location?: string;
  warningCode?: string;
  warningMessage?: string;
  klippyState?: string;
  klippyConnected?: boolean;
  errorMessage?: string;
  nozzleTemp?: number;
  nozzleTarget?: number;
  bedTemp?: number;
  bedTarget?: number;
  progress?: number;
  currentLayer?: number;
  totalLayers?: number;
  timeElapsed?: string;
  timeRemaining?: string;
  filamentUsed?: string;
  printName?: string;
}

export interface PrinterStatus {
  nozzleTemp: number;
  nozzleTarget: number;
  bedTemp: number;
  bedTarget: number;
  progress: number;
  currentLayer: number;
  totalLayers: number;
  timeElapsed: string;
  timeRemaining: string;
  filamentUsed: string;
  printName: string;
  state?: string;
  warningCode?: string;
  warningMessage?: string;
  klippyState?: string;
  klippyConnected?: boolean;
  errorMessage?: string;
}

type BackendDevice = {
  id: string | number;
  name: string;
  status?: string;
  state?: PrinterDevice['state'];
  host?: string;
  fluiddUrl?: string;
  fluidd_url?: string;
  moonrakerUrl?: string;
  moonraker_url?: string;
  location?: string;
  warningCode?: string;
  warningMessage?: string;
  klippyState?: string;
  klippyConnected?: boolean;
  errorMessage?: string;
  nozzleTemp?: number;
  nozzleTarget?: number;
  bedTemp?: number;
  bedTarget?: number;
  progress?: number;
  currentLayer?: number;
  totalLayers?: number;
  timeElapsed?: string;
  timeRemaining?: string;
  filamentUsed?: string;
  printName?: string;
};

export interface DeviceVerifyResponse {
  success: boolean;
  verified: boolean;
  reasonCode: string;
  message: string;
  warningCode?: string;
  warningMessage?: string;
  host?: string;
  moonrakerUrl?: string;
  fluiddUrl?: string;
  moonrakerVersion?: string;
  klippyState?: string;
  klippyConnected?: boolean;
}

export interface DeviceService {
  listDevices(): Promise<PrinterDevice[]>;
  getStatus(deviceId: string): Promise<PrinterStatus>;
  sendCommand(deviceId: string, command: 'pause' | 'resume' | 'stop' | 'beep'): Promise<void>;
  setNozzleTemp(deviceId: string, temp: number): Promise<void>;
  setBedTemp(deviceId: string, temp: number): Promise<void>;
  verifyDevice?(host: string): Promise<DeviceVerifyResponse>;
  addDevice?(name: string, host: string): Promise<PrinterDevice>;
  updateDevice?(id: string, name?: string, host?: string): Promise<PrinterDevice>;
  deleteDevice?(id: string): Promise<void>;
}

// ─── Mock implementation (for development / demo) ───

const MOCK_DEVICES: PrinterDevice[] = [
  { id: 'device1', name: 'Bambu Lab X1C', status: 'online', isPrinting: false, state: 'standby', fluiddUrl: 'http://192.168.1.100', moonrakerUrl: 'http://192.168.1.100:7125', location: '工作台 A' },
  { id: 'device2', name: '创客工坊 P1P', status: 'online', isPrinting: false, state: 'standby', fluiddUrl: 'http://192.168.1.101', moonrakerUrl: 'http://192.168.1.101:7125', location: '工作台 B' },
  { id: 'device3', name: '备用打印机', status: 'offline', isPrinting: false, state: 'offline', fluiddUrl: 'http://192.168.1.102', moonrakerUrl: 'http://192.168.1.102:7125', location: '储藏区' },
];

const BASE_STATUS: Record<string, PrinterStatus> = {
  device1: {
    nozzleTemp: 200,
    nozzleTarget: 215,
    bedTemp: 55,
    bedTarget: 60,
    progress: 45,
    currentLayer: 67,
    totalLayers: 149,
    timeElapsed: '4h 30m',
    timeRemaining: '2h 15m',
    filamentUsed: '50.5g',
    printName: '大师挑战赛：抽奖机',
  },
  device2: {
    nozzleTemp: 34,
    nozzleTarget: 0,
    bedTemp: 30,
    bedTarget: 0,
    progress: 0,
    currentLayer: 0,
    totalLayers: 0,
    timeElapsed: '0h 00m',
    timeRemaining: '--',
    filamentUsed: '0.0g',
    printName: '待机中',
  },
  device3: {
    nozzleTemp: 28,
    nozzleTarget: 0,
    bedTemp: 27,
    bedTarget: 0,
    progress: 0,
    currentLayer: 0,
    totalLayers: 0,
    timeElapsed: '--',
    timeRemaining: '--',
    filamentUsed: '0.0g',
    printName: '设备离线',
  },
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const withJitter = (value: number, amount: number): number => {
  const offset = (Math.random() - 0.5) * amount * 2;
  return value + offset;
};

export class MockDeviceService implements DeviceService {
  async listDevices(): Promise<PrinterDevice[]> {
    return Promise.resolve(MOCK_DEVICES.map((device) => ({ ...device })));
  }

  async getStatus(deviceId: string): Promise<PrinterStatus> {
    const base = BASE_STATUS[deviceId] ?? BASE_STATUS.device1;

    return Promise.resolve({
      ...base,
      nozzleTemp: Math.round(clamp(withJitter(base.nozzleTemp, 3), 0, 300)),
      bedTemp: Math.round(clamp(withJitter(base.bedTemp, 2), 0, 120)),
      progress: Number(clamp(withJitter(base.progress, 1.2), 0, 100).toFixed(1)),
      currentLayer: base.totalLayers > 0 ? clamp(Math.round(withJitter(base.currentLayer, 1)), 0, base.totalLayers) : 0,
    });
  }

  async sendCommand(deviceId: string, command: 'pause' | 'resume' | 'stop' | 'beep'): Promise<void> {
    void deviceId; void command;
    return Promise.resolve();
  }

  async setNozzleTemp(deviceId: string, temp: number): Promise<void> {
    void deviceId;
    void temp;
    return Promise.resolve();
  }

  async setBedTemp(deviceId: string, temp: number): Promise<void> {
    void deviceId;
    void temp;
    return Promise.resolve();
  }
}

// ─── Klipper / Moonraker implementation (real hardware) ───

export class KlipperDeviceService implements DeviceService {
  async verifyDevice(host: string): Promise<DeviceVerifyResponse> {
    const { data } = await apiClient.post(`${DEVICE_BASE}/verify`, { host });
    return data;
  }

  async addDevice(name: string, host: string): Promise<PrinterDevice> {
    const { data } = await apiClient.post(DEVICE_BASE, { name, host });
    return this.mapBackendDevice(data);
  }

  async updateDevice(id: string, name?: string, host?: string): Promise<PrinterDevice> {
    const { data } = await apiClient.put(`${DEVICE_BASE}/${id}`, { name, host });
    return this.mapBackendDevice(data);
  }

  async deleteDevice(id: string): Promise<void> {
    await apiClient.delete(`${DEVICE_BASE}/${id}`);
  }

  async listDevices(): Promise<PrinterDevice[]> {
    const { data } = await apiClient.get(DEVICE_BASE);
    const items = Array.isArray(data) ? data : (Array.isArray(data?.devices) ? data.devices : []);
    return (items as BackendDevice[]).map((d) => this.mapBackendDevice(d));
  }

  async getStatus(deviceId: string): Promise<PrinterStatus> {
    const { data } = await apiClient.get(`${DEVICE_BASE}/${deviceId}/status`);
    return {
      nozzleTemp: data.nozzleTemp || 0,
      nozzleTarget: data.nozzleTarget || 0,
      bedTemp: data.bedTemp || 0,
      bedTarget: data.bedTarget || 0,
      progress: data.progress || 0,
      currentLayer: data.currentLayer || 0,
      totalLayers: data.totalLayers || 0,
      timeElapsed: data.timeElapsed || '0h 00m',
      timeRemaining: data.timeRemaining || '--',
      filamentUsed: data.filamentUsed || '0.0m',
      printName: data.printName || '待机中',
      state: data.state || 'unknown',
      warningCode: data.warningCode,
      warningMessage: data.warningMessage,
      klippyState: data.klippyState,
      klippyConnected: data.klippyConnected,
      errorMessage: data.errorMessage,
    };
  }

  async sendCommand(deviceId: string, command: 'pause' | 'resume' | 'stop' | 'beep'): Promise<void> {
    await apiClient.post(`${DEVICE_BASE}/${deviceId}/command/${command}`);
  }

  async setNozzleTemp(deviceId: string, temp: number): Promise<void> {
    await apiClient.post(`${DEVICE_BASE}/${deviceId}/nozzle-temp`, { temp });
  }

  async setBedTemp(deviceId: string, temp: number): Promise<void> {
    await apiClient.post(`${DEVICE_BASE}/${deviceId}/bed-temp`, { temp });
  }

  private mapBackendDevice(d: BackendDevice): PrinterDevice {
    const isPrinting = d.state === 'printing';
    const status = d.status === 'offline' ? 'offline' : 'online';
    
    return {
      id: String(d.id),
      name: d.name,
      status,
      isPrinting,
      state: d.state || (status === 'offline' ? 'offline' : 'standby'),
      host: d.host,
      fluiddUrl: d.fluiddUrl || d.fluidd_url,
      moonrakerUrl: d.moonrakerUrl || d.moonraker_url,
      location: d.location,
      warningCode: d.warningCode,
      warningMessage: d.warningMessage,
      klippyState: d.klippyState,
      klippyConnected: d.klippyConnected,
      errorMessage: d.errorMessage,
      nozzleTemp: d.nozzleTemp,
      nozzleTarget: d.nozzleTarget,
      bedTemp: d.bedTemp,
      bedTarget: d.bedTarget,
      progress: d.progress,
      currentLayer: d.currentLayer,
      totalLayers: d.totalLayers,
      timeElapsed: d.timeElapsed,
      timeRemaining: d.timeRemaining,
      filamentUsed: d.filamentUsed,
      printName: d.printName,
    };
  }
}

// ─── Factory: auto-select based on env ───

export function createDeviceService(): DeviceService {
  const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const isLocalDev = import.meta.env.DEV || isLocalHost;
  const useMock = isLocalDev && (
    import.meta.env.VITE_USE_KLIPPER === 'false' ||
    import.meta.env.VITE_DEVICE_SERVICE_MODE === 'mock'
  );
  return useMock ? new MockDeviceService() : new KlipperDeviceService();
}
