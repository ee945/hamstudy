#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""项目配置的唯一入口：改端口只需要动项目根 .env 一个文件。

优先级：shell 环境变量 > .env > 内置默认值。
PB_PORT / SITE_PORT / LISTEN_ADDR / SERVER_NAME 是端口与监听地址的
唯一来源，PB_URL / SITE_URL 由端口派生（仍可显式设置，用于特殊场景）。
SITE_PORT 允许 80/443（nginx 由 root 启动），PB_PORT 限制 1024–32767。

消费者：
  hamstudy                 -> ports 子命令取两个端口
  tools/pb_admin.py        -> .env 载入后按 PB_PORT 派生 PB_URL
  tools/_env.mjs           -> .env 载入后按 PB_PORT/SITE_PORT 派生地址
  nginx / systemd 配置     -> render 生成，sync 在端口变化时同步本机 nginx

命令：
  python3 tools/config.py ports    输出 PB_PORT=xxx / SITE_PORT=xxx（仅数字，供 shell eval）
  python3 tools/config.py show     打印解析结果（不含任何凭据）
  python3 tools/config.py render   生成 deploy/nginx.generated.conf 与 pocketbase.generated.service
  python3 tools/config.py sync     render + 必要时同步本机 nginx 并 reload
  python3 tools/config.py sync --dry-run   只报告将改动什么，不写任何文件
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(ROOT, ".env")
DEPLOY = os.path.join(ROOT, "deploy")
APP = os.path.basename(ROOT)

# 仅作「完全没有 .env」时的安全兜底：回环 + 非特权端口，避免误对公网开放。
# 公网部署一律 cp .env.example .env（默认 80 / 0.0.0.0），不依赖这里的值。
DEFAULTS = {
    "PB_PORT": "8199",
    "SITE_PORT": "8091",
    "LISTEN_ADDR": "127.0.0.1",
    "SERVER_NAME": "_",
    "SERVICE_USER": "www-data",
}

# nginx 的平台标准安装位置（不含任何机器私有路径）。文件名跟随项目目录名，
# 这样同一台机器上并存多个站点时不会互相覆盖。非标准安装（含 macOS
# Homebrew）一律在 .env 里用 NGINX_CONF 显式指定绝对路径。
NGINX_CANDIDATES = [
    f"/etc/nginx/conf.d/{APP}.conf",
    f"/etc/nginx/sites-enabled/{APP}.conf",
    f"/usr/local/etc/nginx/servers/{APP}.conf",
]


def load():
    """零依赖读 .env；已由 shell 传入的变量优先。返回配置字典。"""
    cfg = dict(DEFAULTS)
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
                    v = v[1:-1]
                if k:
                    cfg[k] = v
    # shell 环境变量最高优先级
    for k in list(cfg) + ["PB_URL", "SITE_URL", "NGINX_CONF", "NGINX_SYNC"]:
        if k in os.environ:
            cfg[k] = os.environ[k]
    return cfg


def _port(cfg, key, allow_privileged=False):
    """PB_PORT 限制在 1024–32767（非 root 运行）；SITE_PORT 允许 80/443。"""
    val = str(cfg.get(key, "")).strip()
    lo, hi = (1, 65535) if allow_privileged else (1024, 32767)
    if not re.fullmatch(r"\d{1,5}", val) or not (lo <= int(val) <= hi):
        sys.exit(f"[配置错误] .env 中 {key}={val!r} 不是合法端口，请用 {lo}–{hi} 之间的整数")
    return val


def _listen_addr(cfg):
    """只允许 IP / 通配符形态，避免把任意内容注入 nginx 配置。"""
    val = str(cfg.get("LISTEN_ADDR", "127.0.0.1")).strip()
    if not re.fullmatch(r"[0-9A-Za-z.:]+", val):
        sys.exit(f"[配置错误] .env 中 LISTEN_ADDR={val!r} 非法（只允许 IP 地址或 0.0.0.0）")
    return val


def urls(cfg):
    """PB_URL / SITE_URL 未显式给出时，由端口派生。"""
    pb_port = _port(cfg, "PB_PORT")
    site_port = _port(cfg, "SITE_PORT", allow_privileged=True)
    return {
        "PB_PORT": pb_port,
        "SITE_PORT": site_port,
        "LISTEN_ADDR": _listen_addr(cfg),
        "PB_URL": cfg.get("PB_URL") or f"http://127.0.0.1:{pb_port}",
        "SITE_URL": cfg.get("SITE_URL") or f"http://127.0.0.1:{site_port}",
        "SERVER_NAME": cfg.get("SERVER_NAME", "_"),
        "SERVICE_USER": cfg.get("SERVICE_USER", "www-data"),
    }


def nginx_conf_path(cfg=None):
    """优先用 .env / shell 的 NGINX_CONF，其次探测标准安装路径。"""
    c = cfg if cfg is not None else load()
    explicit = (c.get("NGINX_CONF") or "").strip()
    if explicit:
        return explicit
    for p in NGINX_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def render(cfg, out=True):
    """用 .env 的值渲染两份部署配置。out=False 时只返回内容，不写文件。"""
    u = urls(cfg)
    repl = {
        "__DEPLOY_ROOT__": ROOT,
        "__SITE_PORT__": u["SITE_PORT"],
        "__PB_PORT__": u["PB_PORT"],
        "__LISTEN_ADDR__": u["LISTEN_ADDR"],
        "__SERVER_NAME__": u["SERVER_NAME"],
        "__SERVICE_USER__": u["SERVICE_USER"],
    }
    pairs = [
        ("nginx.conf.example", "nginx.generated.conf"),
        ("pocketbase.service.example", "pocketbase.generated.service"),
    ]
    result = {}
    for src, dst in pairs:
        fp = os.path.join(DEPLOY, src)
        if not os.path.exists(fp):
            sys.exit(f"[配置错误] 缺少模板 {fp}")
        with open(fp, encoding="utf-8") as f:
            text = f.read()
        for k, v in repl.items():
            text = text.replace(k, v)
        result[dst] = text
        if out:
            with open(os.path.join(DEPLOY, dst), "w", encoding="utf-8") as f:
                f.write(text)
    return result


def sync(cfg, dry=False):
    """端口变化时同步本机 nginx 配置：只改端口数字，保留其余手工定制。

    云主机上若本机没有这份 nginx 配置，则只生成文件供复制，不报错。
    """
    logs = []
    generated = render(cfg, out=not dry)
    for name in generated:
        logs.append(("将生成" if dry else "已生成") + f" deploy/{name}")

    path = nginx_conf_path(cfg)
    if not path or not os.path.exists(path):
        logs.append("未检测到本机 nginx 站点配置，已生成文件供自行部署")
        return logs, False

    with open(path, encoding="utf-8") as f:
        before = f.read()
    u = urls(cfg)

    # 只替换模板生成的 listen / proxy_pass 行；带 ssl、http2、[::] 等
    # 额外参数的 listen 不会被匹配（certbot 接管 443 后不会被改写）。
    after = re.sub(
        r"(proxy_pass\s+http://127\.0\.0\.1:)\d+(/)",
        lambda m: f"{m.group(1)}{u['PB_PORT']}{m.group(2)}", before)
    after = re.sub(
        r"(?m)^(\s*listen\s+)(?:[0-9.]+:)?\d+(\s*;)",
        lambda m: f"{m.group(1)}{u['LISTEN_ADDR']}:{u['SITE_PORT']}{m.group(2)}", after)

    if after == before:
        logs.append(f"nginx 配置端口已与 .env 一致（PB {u['PB_PORT']} / 站点 {u['SITE_PORT']}），未改动")
        return logs, False

    logs.append(f"检测到端口不一致，将更新 {path}")
    if dry:
        for n, line in enumerate(after.splitlines(), 1):
            if "proxy_pass" in line or re.search(r"^\s*listen\s", line):
                logs.append(f"  → 第 {n} 行: {line.strip()}")
        logs.append("(--dry-run，未写入、未 reload)")
        return logs, True

    # nginx -t 校验通过才 reload；失败立刻恢复原文件
    with open(path, "w", encoding="utf-8") as f:
        f.write(after)
    try:
        check = subprocess.run(["nginx", "-t"], capture_output=True, text=True, timeout=20)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        with open(path, "w", encoding="utf-8") as f:
            f.write(before)
        logs.append(f"nginx -t 无法执行（{e}），已恢复原配置")
        return logs, False
    if check.returncode != 0:
        with open(path, "w", encoding="utf-8") as f:
            f.write(before)
        detail = (check.stderr or check.stdout or "").strip().splitlines()
        logs.append("nginx -t 未通过，已恢复原配置：" + (detail[-1] if detail else "无输出"))
        return logs, False

    try:
        rl = subprocess.run(["nginx", "-s", "reload"], capture_output=True, text=True, timeout=20)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logs.append(f"配置已更新，但 reload 未执行（{e}）；启动 nginx 后生效")
        return logs, True
    if rl.returncode != 0:
        logs.append("配置已更新，但 reload 失败（nginx 可能未运行）；启动 nginx 后生效")
        return logs, True
    logs.append(f"nginx 已 reload → /pb/ 指向 127.0.0.1:{u['PB_PORT']}")
    return logs, True


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "show"
    dry = "--dry-run" in sys.argv
    cfg = load()
    u = urls(cfg)

    if cmd == "ports":
        # 只输出纯数字，hamstudy 可直接 eval
        print(f"PB_PORT={u['PB_PORT']}")
        print(f"SITE_PORT={u['SITE_PORT']}")
    elif cmd == "show":
        print(f"配置文件: {ENV_FILE}")
        print(f"PB_PORT   = {u['PB_PORT']}   (PocketBase 仅监听 127.0.0.1)")
        print(f"SITE_PORT = {u['SITE_PORT']}   (nginx 对外)")
        print(f"LISTEN_ADDR = {u['LISTEN_ADDR']}   (nginx 监听地址)")
        print(f"SERVER_NAME = {u['SERVER_NAME']}")
        print(f"SERVICE_USER = {u['SERVICE_USER']}   (systemd 单元)")
        print(f"PB_URL    = {u['PB_URL']}")
        print(f"SITE_URL  = {u['SITE_URL']}")
        print(f"nginx 配置 = {nginx_conf_path(cfg) or '(本机未检测到，用 NGINX_CONF 指定)'}")
    elif cmd == "render":
        for name in render(cfg):
            print(f"已生成 deploy/{name}")
    elif cmd == "sync":
        logs, _ = sync(cfg, dry=dry)
        for line in logs:
            print(line)
    else:
        sys.exit(f"未知子命令 {cmd!r}，可用：ports / show / render / sync")


if __name__ == "__main__":
    main()
