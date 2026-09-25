import re
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "deploy-server.sh"
SOURCE = SCRIPT.read_text(encoding="utf-8")


def bash_function(name: str) -> str:
    match = re.search(rf"^{re.escape(name)}\(\) \{{\r?\n(?P<body>.*?)(?:\r?\n)^\}}", SOURCE, re.M | re.S)
    assert match, f"{name}() not found"
    return match.group("body")


def assert_ordered(text: str, *needles: str) -> None:
    cursor = -1
    for needle in needles:
        next_index = text.find(needle, cursor + 1)
        assert next_index != -1, f"{needle!r} not found after offset {cursor}"
        cursor = next_index


def test_python_selection_allows_supported_linux_versions_and_preserves_explicit_choice():
    assert 'PYTHON_BIN="python3"' in SOURCE
    assert 'PYTHON_BIN_CANDIDATES=("python3.12" "python3.11" "python3.10" "python3")' in SOURCE
    assert "sys.version_info >= (3, 10)" in bash_function("python_is_compatible")
    assert_ordered(
        SOURCE,
        "--python-bin)",
        'PYTHON_BIN="${2:?Missing value for --python-bin}"',
        'PYTHON_BIN_EXPLICIT="yes"',
    )

    install_base_packages = bash_function("install_base_packages")
    assert 'if [[ "$PYTHON_BIN_EXPLICIT" == "no" ]]; then' in install_base_packages
    assert 'for candidate in "${PYTHON_BIN_CANDIDATES[@]}"; do' in install_base_packages
    assert 'python_is_compatible "$PYTHON_BIN" || die "Python 3.10+ is required for backend builds: $PYTHON_BIN"' in install_base_packages
    assert "3.14" not in SOURCE


def test_backend_env_is_readable_by_systemd_service_user_only():
    assert re.search(r"^service_user_name\(\) \{", SOURCE, re.M)
    assert not re.search(r"^service_user\(\) \{", SOURCE, re.M)

    secure_backend_env = bash_function("secure_backend_env")
    assert 'user_name="$(service_user_name)"' in secure_backend_env
    assert 'run chown "root:${user_name}" "$env_file"' in secure_backend_env
    assert 'run chmod 640 "$env_file"' in secure_backend_env

    ensure_backend_env = bash_function("ensure_backend_env")
    assert ensure_backend_env.count("secure_backend_env") == 2


def test_runtime_dirs_and_systemd_use_the_service_user_and_backend_venv():
    prepare_runtime_dirs = bash_function("prepare_runtime_dirs")
    assert 'web_user="$(service_user_name)"' in prepare_runtime_dirs
    assert "ensure_service_user" in prepare_runtime_dirs
    assert 'run chown -R "${web_user}:${web_user}" "$DATA_DIR"' in prepare_runtime_dirs

    write_systemd_service = bash_function("write_systemd_service")
    assert 'service_user="$(service_user_name)"' in write_systemd_service
    assert 'service_group="$service_user"' in write_systemd_service
    assert "ensure_service_user" in write_systemd_service
    assert "User=${service_user}" in write_systemd_service
    assert "Group=${service_group}" in write_systemd_service
    assert "EnvironmentFile=${APP_DIR}/backend/.env" in write_systemd_service
    assert "ExecStart=${APP_DIR}/backend/.venv/bin/python -m uvicorn main:app" in write_systemd_service


def test_sqlite_migration_runs_after_backend_build_with_backend_venv_python():
    run_sqlite_migration = bash_function("run_sqlite_migration")
    assert 'local backend_python="$APP_DIR/backend/.venv/bin/python"' in run_sqlite_migration
    assert 'run "$backend_python" "$APP_DIR/scripts/migrate_sqlite_to_mysql.py"' in run_sqlite_migration

    assert_ordered(
        bash_function("main"),
        "prepare_runtime_dirs",
        "ensure_backend_env",
        "build_backend",
        "run_sqlite_migration",
        "build_frontend",
    )


def test_frontend_build_uses_low_memory_node_options():
    build_frontend = bash_function("build_frontend")
    assert 'FRONTEND_BUILD_NODE_OPTIONS="${FRONTEND_BUILD_NODE_OPTIONS:---max-old-space-size=768}"' in SOURCE
    assert 'run env NODE_OPTIONS="$FRONTEND_BUILD_NODE_OPTIONS" npm run build' in build_frontend
