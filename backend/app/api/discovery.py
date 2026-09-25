"""
网络设备发现 API
支持 mDNS 和子网扫描两种方式发现 Moonraker 打印机
"""
import asyncio
import socket
import ipaddress
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


class DiscoveredDevice(BaseModel):
    """发现的设备信息"""
    ip: str
    hostname: Optional[str] = None
    moonraker_url: str
    name: str
    status: str
    printer_info: Optional[dict] = None


async def _check_moonraker_port(ip: str, port: int = 7125, timeout: float = 1.0) -> bool:
    """快速 TCP 端口检查，不进行完整 HTTP 请求"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port),
            timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except (asyncio.TimeoutError, OSError, ConnectionRefusedError):
        return False


async def _verify_moonraker(url: str, timeout: float = 2.0) -> Optional[dict]:
    """验证 Moonraker 是否真实运行并获取打印机信息"""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{url}/printer/info")
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", {})
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
        return None


async def _get_hostname(ip: str) -> Optional[str]:
    """反向 DNS 查询（非阻塞）"""
    try:
        loop = asyncio.get_event_loop()
        hostname = await loop.run_in_executor(
            None, 
            lambda: socket.gethostbyaddr(ip)[0]
        )
        return hostname
    except (socket.gaierror, OSError):
        pass
    return None


async def _scan_subnet(subnet: str, timeout: float = 0.5) -> List[str]:
    """扫描子网中开放 7125 端口的设备，返回响应的 IP 列表"""
    try:
        network = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的子网 CIDR 格式")
    
    # 限制扫描范围为 /24 网络，防止 DoS
    if network.num_addresses > 256:
        raise HTTPException(status_code=400, detail="子网范围过大（最大 /24）")
    
    tasks = [
        _check_moonraker_port(str(ip), timeout=timeout)
        for ip in network.hosts()
    ]
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    responsive_ips = [
        str(ip) for ip, result in zip(network.hosts(), results)
        if result is True
    ]
    return responsive_ips


@router.post("/scan-subnet", response_model=List[DiscoveredDevice])
async def scan_subnet(subnet: str = "192.168.1.0/24") -> List[DiscoveredDevice]:
    """
    扫描本地子网中的 Moonraker 实例
    
    安全限制：仅接受 /24 或更小的子网，防止 DoS
    超时：每个 IP 0.5s，总计最多 30s
    """
    try:
        # 阶段 1: 快速端口扫描（每个 IP 0.5s 超时）
        responsive_ips = await asyncio.wait_for(
            _scan_subnet(subnet, timeout=0.5),
            timeout=30.0
        )
        
        if not responsive_ips:
            return []
        
        # 阶段 2: 验证 Moonraker + 获取主机名（并行）
        verification_tasks = [
            asyncio.gather(
                _verify_moonraker(f"http://{ip}:7125", timeout=2.0),
                _get_hostname(ip)
            )
            for ip in responsive_ips
        ]
        
        results = await asyncio.gather(*verification_tasks, return_exceptions=True)
        
        devices = []
        for ip, result in zip(responsive_ips, results):
            if isinstance(result, tuple):
                moonraker_data, hostname = result
                if isinstance(moonraker_data, dict) and moonraker_data:
                    devices.append(DiscoveredDevice(
                        ip=ip,
                        hostname=hostname or ip,
                        moonraker_url=f"http://{ip}:7125",
                        name=moonraker_data.get("hostname", f"Printer {ip}"),
                        status="online",
                        printer_info=moonraker_data
                    ))
        
        return devices
    
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="扫描超时 - 网络可能较慢")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"扫描失败: {str(e)}")


@router.post("/scan-mdns", response_model=List[DiscoveredDevice])
async def scan_mdns() -> List[DiscoveredDevice]:
    """
    通过 mDNS 发现 Moonraker（需要 zeroconf 库）
    比子网扫描更可靠，遵守网络边界
    """
    try:
        from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="mDNS 发现不可用。请安装: pip install zeroconf"
        )
    
    devices: List[DiscoveredDevice] = []
    discovered_services = []
    
    class MoonrakerListener(ServiceListener):
        """Moonraker mDNS 服务监听器"""
        
        def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
            """当发现新服务时调用"""
            info = zc.get_service_info(type_, name)
            if info:
                discovered_services.append((type_, name, info))
        
        def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
            pass
        
        def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
            pass
    
    zeroconf = Zeroconf()
    listener = MoonrakerListener()
    
    # 扫描多种服务类型
    service_types = [
        "_moonraker._tcp.local.",
        "_http._tcp.local.",
    ]
    
    browsers = [
        ServiceBrowser(zeroconf, service_type, listener)
        for service_type in service_types
    ]
    
    # 等待 mDNS 发现（通常 2-5 秒）
    await asyncio.sleep(3)
    
    # 处理发现的服务
    for service_type, name, info in discovered_services:
        if info.parsed_addresses():
            ip = info.parsed_addresses()[0]
            port = info.port or 7125
            
            # 验证是否为 Moonraker
            moonraker_data = await _verify_moonraker(f"http://{ip}:{port}", timeout=2.0)
            if moonraker_data:
                devices.append(DiscoveredDevice(
                    ip=ip,
                    hostname=info.server.rstrip('.'),
                    moonraker_url=f"http://{ip}:{port}",
                    name=moonraker_data.get("hostname", name.split('.')[0]),
                    status="online",
                    printer_info=moonraker_data
                ))
    
    zeroconf.close()
    
    return devices


@router.post("/verify", response_model=DiscoveredDevice)
async def verify_device(url: str) -> DiscoveredDevice:
    """
    验证单个 Moonraker 实例
    用于测试手动输入的 IP
    """
    try:
        # 解析 URL
        from urllib.parse import urlparse
        parsed = urlparse(url if url.startswith('http') else f'http://{url}')
        ip = parsed.hostname or 'unknown'
        port = parsed.port or 7125
        
        # 验证 Moonraker
        moonraker_url = f"http://{ip}:{port}"
        moonraker_data = await _verify_moonraker(moonraker_url, timeout=3.0)
        
        if not moonraker_data:
            raise HTTPException(status_code=404, detail="无法连接到 Moonraker")
        
        # 获取主机名
        hostname = await _get_hostname(ip)
        
        return DiscoveredDevice(
            ip=ip,
            hostname=hostname or ip,
            moonraker_url=moonraker_url,
            name=moonraker_data.get("hostname", f"Printer {ip}"),
            status="online",
            printer_info=moonraker_data
        )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"验证失败: {str(e)}")
