import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDeviceService } from '../services/device';
import type { DeviceService, PrinterDevice, PrinterStatus } from '../services/device';

const deviceService: DeviceService = createDeviceService();

const POLLING_INTERVAL = 5000;

export { deviceService };

export function useDevice(deviceId: string) {
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [nozzleTargetOverride, setNozzleTargetOverride] = useState<number | null>(null);
  const [bedTargetOverride, setBedTargetOverride] = useState<number | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const listedDevices = await deviceService.listDevices();
      setDevices(listedDevices);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取设备列表失败');
    } finally {
      if (!deviceId) setLoading(false);
    }
  }, [deviceId]);

  const refreshStatus = useCallback(async () => {
    if (!deviceId) {
      return;
    }

    try {
      const nextStatus = await deviceService.getStatus(deviceId);
      setStatus(nextStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取设备状态失败');
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await refreshDevices();
    };

    void run();

    if (deviceId) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(() => {
      void run();
    }, POLLING_INTERVAL);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshDevices, deviceId]);

  useEffect(() => {
    if (!deviceId) {
      setStatus(null);
      setNozzleTargetOverride(null);
      setBedTargetOverride(null);
      return;
    }

    setLoading(true);
    setNozzleTargetOverride(null);
    setBedTargetOverride(null);
    void refreshStatus();

    const timer = window.setInterval(() => {
      void refreshStatus();
    }, POLLING_INTERVAL);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshStatus, deviceId]);

  const sendCommand = useCallback(
    async (command: 'pause' | 'resume' | 'stop' | 'beep') => {
      try {
        await deviceService.sendCommand(deviceId, command);
        if (command === 'pause' || command === 'resume' || command === 'stop') {
          setDevices((prev) =>
            prev.map((device) =>
              device.id === deviceId
                ? {
                    ...device,
                    isPrinting: command === 'resume',
                  }
                : device,
            ),
          );
        }

        if (command === 'stop') {
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  progress: 0,
                  currentLayer: 0,
                  timeRemaining: '--',
                }
              : prev,
          );
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发送控制指令失败');
      }
    },
    [deviceId],
  );

  const setNozzleTemp = useCallback(
    async (temp: number) => {
      try {
        await deviceService.setNozzleTemp(deviceId, temp);
        setNozzleTargetOverride(temp);
        setStatus((prev) => (prev ? { ...prev, nozzleTemp: temp, nozzleTarget: temp } : prev));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '设置喷嘴温度失败');
      }
    },
    [deviceId],
  );

  const setBedTemp = useCallback(
    async (temp: number) => {
      try {
        await deviceService.setBedTemp(deviceId, temp);
        setBedTargetOverride(temp);
        setStatus((prev) => (prev ? { ...prev, bedTemp: temp, bedTarget: temp } : prev));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '设置热床温度失败');
      }
    },
    [deviceId],
  );

  const mergedStatus = useMemo(() => {
    if (!status) {
      return null;
    }

    return {
      ...status,
      nozzleTarget: nozzleTargetOverride ?? status.nozzleTarget,
      bedTarget: bedTargetOverride ?? status.bedTarget,
    };
  }, [status, nozzleTargetOverride, bedTargetOverride]);

  return {
    status: mergedStatus,
    devices,
    loading,
    error,
    sendCommand,
    setNozzleTemp,
    setBedTemp,
    refreshStatus,
    refreshDevices,
  };
}
