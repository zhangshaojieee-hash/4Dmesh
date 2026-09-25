"""
MakerWorld 创客学堂 - 本地隔离启动入口
用法: python run.py
"""

import os
import socket
import subprocess
import time
import webbrowser
import sys
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
BACKEND_VENV = os.path.join(BACKEND_DIR, ".venv")
BACKEND_UVICORN = os.path.join(BACKEND_VENV, "bin", "uvicorn")
BACKEND_UVICORN_WIN = os.path.join(BACKEND_VENV, "Scripts", "uvicorn.exe")
BACKEND_PYTHON = os.path.join(BACKEND_VENV, "bin", "python")
BACKEND_PYTHON_WIN = os.path.join(BACKEND_VENV, "Scripts", "python.exe")


def _python_is_compatible(command):
    try:
        completed = subprocess.run(
            [*command, "-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return False
    return completed.returncode == 0


def _backend_command():
    reload_args = ["--reload"] if os.environ.get("BACKEND_RELOAD") == "1" else []
    backend_python = os.environ.get("BACKEND_PYTHON", "").strip()
    if backend_python and _python_is_compatible([backend_python]):
        return [backend_python, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if os.path.isfile(BACKEND_PYTHON_WIN) and _python_is_compatible([BACKEND_PYTHON_WIN]):
        return [BACKEND_PYTHON_WIN, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if os.path.isfile(BACKEND_PYTHON) and _python_is_compatible([BACKEND_PYTHON]):
        return [BACKEND_PYTHON, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if os.path.isfile(BACKEND_UVICORN_WIN):
        return [BACKEND_UVICORN_WIN, "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if os.path.isfile(BACKEND_UVICORN):
        return [BACKEND_UVICORN, "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if sys.executable and _python_is_compatible([sys.executable]):
        return [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if shutil.which("python3.12") and _python_is_compatible(["python3.12"]):
        return ["python3.12", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if shutil.which("python3.11") and _python_is_compatible(["python3.11"]):
        return ["python3.11", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if shutil.which("python3.10") and _python_is_compatible(["python3.10"]):
        return ["python3.10", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if shutil.which("python3") and _python_is_compatible(["python3"]):
        return ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    if os.name == "nt" and shutil.which("py") and _python_is_compatible(["py", "-3"]):
        return ["py", "-3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", *reload_args]
    raise SystemExit("No usable Python 3.10+ interpreter found for the backend. Set BACKEND_PYTHON or install Python 3.10+ / backend/.venv.")


def _frontend_command():
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
    if not npm:
        raise SystemExit("npm not found; please install Node.js and make sure npm is on PATH")
    return [npm, "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]


def _port_in_use(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex(("127.0.0.1", port)) == 0
    except OSError:
        return False


def _ensure_ports_available() -> None:
    occupied = [str(port) for port in (8000, 5173) if _port_in_use(port)]
    if not occupied:
        return
    print("Ports already in use: %s" % ", ".join(occupied))
    if os.name == "nt":
        print(
            "Check processes: Get-NetTCPConnection -LocalPort %s | Select-Object LocalPort,OwningProcess"
            % ",".join(occupied)
        )
        print("Stop a process: Stop-Process -Id <PID>")
    else:
        print("Check processes: lsof -i :%s" % ",:".join(occupied))
        print("Stop a process: kill <PID>")
    raise SystemExit(1)
    print("端口已被占用: %s" % ", ".join(occupied))
    print("请先停止旧服务后再运行: ps -ef | grep -E 'run.py|uvicorn|vite'")
    print("确认无误后可执行: kill <进程号>")
    raise SystemExit(1)


def _stop_process(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def main():
    _ensure_ports_available()
    backend_cmd = _backend_command()
    frontend_cmd = _frontend_command()
    backend = subprocess.Popen(backend_cmd, cwd=BACKEND_DIR)
    frontend = subprocess.Popen(frontend_cmd, cwd=FRONTEND_DIR)

    print("后端: http://localhost:8000")
    print("前端: http://localhost:5173")
    print("API文档: http://localhost:8000/docs")
    print("Backend interpreter: %s" % backend_cmd[0])
    print("按 Ctrl+C 停止所有服务")

    time.sleep(5)
    if os.environ.get("NO_BROWSER") != "1":
        try:
            webbrowser.open("http://localhost:5173")
        except Exception:
            pass

    try:
        while True:
            backend_code = backend.poll()
            frontend_code = frontend.poll()

            if backend_code is not None:
                print(f"\n后端进程已退出，退出码: {backend_code}，正在停止前端...")
                _stop_process(frontend)
                raise SystemExit(backend_code)

            if frontend_code is not None:
                print(f"\n前端进程已退出，退出码: {frontend_code}，正在停止后端...")
                _stop_process(backend)
                raise SystemExit(frontend_code)

            time.sleep(1)
    except KeyboardInterrupt:
        print("\n正在停止服务...")
        _stop_process(backend)
        _stop_process(frontend)
        print("已停止")


if __name__ == "__main__":
    main()
