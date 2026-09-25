import axios from 'axios';

export interface DiscoveredDevice {
  ip: string;
  hostname?: string;
  moonraker_url: string;
  name: string;
  status: 'online' | 'offline';
  printer_info?: {
    hostname?: string;
    software_version?: string;
    cpu_info?: string;
  };
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const normalizedApiBase = API_BASE.replace(/\/+$/, '');
const DISCOVERY_BASE = normalizedApiBase.endsWith('/api') ? normalizedApiBase : `${normalizedApiBase}/api`;

export const discoveryService = {
  async scanSubnet(subnet: string = '192.168.1.0/24'): Promise<DiscoveredDevice[]> {
    try {
      const response = await axios.post(
        `${DISCOVERY_BASE}/discovery/scan-subnet`,
        null,
        { 
          params: { subnet },
          timeout: 35000
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('扫描超时 - 网络可能较慢或不可达');
        }
        throw new Error(error.response?.data?.detail || '扫描失败');
      }
      throw error;
    }
  },

  async scanMDNS(): Promise<DiscoveredDevice[]> {
    try {
      const response = await axios.post(
        `${DISCOVERY_BASE}/discovery/scan-mdns`,
        {},
        { timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(error.response?.data?.detail || 'mDNS 扫描失败');
      }
      throw error;
    }
  },

  async verifyDevice(url: string): Promise<DiscoveredDevice | null> {
    try {
      const response = await axios.post(
        `${DISCOVERY_BASE}/discovery/verify`,
        null,
        { 
          params: { url },
          timeout: 5000
        }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          return null;
        }
        throw new Error(error.response?.data?.detail || '验证失败');
      }
      throw error;
    }
  }
};
