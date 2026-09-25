# moonraker_client.py
import json
import asyncio
import websockets
from PyQt5.QtCore import QThread, pyqtSignal


class MoonrakerClient(QThread):
    log_signal = pyqtSignal(str)
    connection_signal = pyqtSignal(bool, str)
    temperature_signal = pyqtSignal(float, float, float, float)
    position_signal = pyqtSignal(float, float, float)
    state_signal = pyqtSignal(str, float)
    gcode_response_signal = pyqtSignal(str)
    file_list_signal = pyqtSignal(list)

    def __init__(self):
        super().__init__()
        self.host = ""
        self.port = 80
        self.is_running = True
        self.websocket = None
        self.loop = None
        self._req_id = 1000

    def set_connection(self, host, port=80):
        """前端调用此方法设置目标 IP"""
        self.host = host
        self.port = port

    def stop(self):
        """安全停止线程"""
        self.is_running = False
        if self.loop:
            self.loop.stop()

    def run(self):
        self.is_running = True
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._connect_and_listen())

    async def _connect_and_listen(self):
        if not self.host:
            self.log_signal.emit("⚠️ 请先输入 IP 地址")
            return

        ws_url = f"ws://{self.host}:{self.port}/websocket"
        origin = f"http://{self.host}"

        self.connection_signal.emit(False, f"正在连接 {self.host}...")

        try:
            async with websockets.connect(ws_url, origin=origin) as ws:
                self.websocket = ws
                self.connection_signal.emit(True, "🟢 已连接")
                self.log_signal.emit(f"[+] 成功连接至 {self.host}")

                # 订阅请求
                sub_req = {
                    "jsonrpc": "2.0",
                    "method": "printer.objects.subscribe",
                    "params": {"objects": {
                        "toolhead": ["position", "status"],
                        "extruder": ["temperature", "target"],
                        "heater_bed": ["temperature", "target"],
                        "print_stats": ["state"],
                        "display_status": ["progress"]
                    }},
                    "id": self.get_next_id()
                }
                await ws.send(json.dumps(sub_req))
                self.request_file_list()

                while self.is_running:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    if data.get("method") == "notify_ping": continue

                    if "error" in data:
                        self.log_signal.emit(f"⚠️ 报错: {data['error'].get('message')}")
                        continue

                    if data.get("method") == "notify_gcode_response":
                        self.gcode_response_signal.emit(data["params"][0])
                        continue

                    if data.get("method") == "notify_status_update" or (
                            data.get("id") == sub_req["id"] and "result" in data):
                        status_data = data["params"][0] if "params" in data else data["result"].get("status", {})
                        self._parse_and_emit_status(status_data)

                    if "result" in data and isinstance(data["result"], list) and len(data["result"]) > 0:
                        if "filename" in data["result"][0]:
                            self.file_list_signal.emit([f["filename"] for f in data["result"]])

        except Exception as e:
            self.connection_signal.emit(False, "🔴 连接失败")
            self.log_signal.emit(f"[-] 错误: {e}")

    def _parse_and_emit_status(self, data):
        if "extruder" in data or "heater_bed" in data:
            ext = data.get("extruder", {});
            bed = data.get("heater_bed", {})
            self.temperature_signal.emit(
                float(ext.get("temperature", 0) or 0), float(ext.get("target", 0) or 0),
                float(bed.get("temperature", 0) or 0), float(bed.get("target", 0) or 0)
            )
        if "toolhead" in data and "position" in data["toolhead"]:
            p = data["toolhead"]["position"]
            self.position_signal.emit(p[0], p[1], p[2])
        if "print_stats" in data or "display_status" in data:
            s = data.get("print_stats", {}).get("state", "")
            p = data.get("display_status", {}).get("progress", -1.0)
            self.state_signal.emit(s, p)

    def get_next_id(self):
        self._req_id += 1
        return self._req_id

    def send_gcode(self, script):
        if not self.websocket or not self.loop: return
        req = {"jsonrpc": "2.0", "method": "printer.gcode.script", "params": {"script": script},
               "id": self.get_next_id()}
        asyncio.run_coroutine_threadsafe(self.websocket.send(json.dumps(req)), self.loop)

    def request_file_list(self):
        if not self.websocket or not self.loop: return
        req = {"jsonrpc": "2.0", "method": "server.files.list", "params": {"root": "gcodes"}, "id": self.get_next_id()}
        asyncio.run_coroutine_threadsafe(self.websocket.send(json.dumps(req)), self.loop)