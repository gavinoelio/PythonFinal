# PythonFinal 局域网联机原型

《深空乱斗 Dark Campaign》的多人连接基础工程。由一台电脑运行 Python 服务，同一 Wi-Fi 或局域网内的其他设备通过浏览器加入。当前只实现联机大厅，尚未实现棋盘、舰船、战斗或回合规则。

## 当前功能

- 创建六位房间号，最多四名玩家加入。
- 实时同步玩家列表、在线状态和准备状态。
- 发送联机测试信号，房间内所有在线玩家收到同一记录。
- 关闭、刷新页面、浏览器后退或主动返回大厅时退出房间，释放座位。
- 主动离开释放座位；房主离开后由下一名玩家接任。
- 每名玩家有独立的操作凭证，其他玩家收到的房间状态不包含该凭证；离开后立即失效。

## 启动服务

需要 Python 3.8 或以上。当前本机使用 Python 3.8.6 测试；新环境可使用 Python 3.12。网页不需要安装 Node.js 或编译。

Windows PowerShell：

```powershell
cd D:\AIWorks\PythonFinal
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

已安装依赖后，后续只需执行最后一行。不需要激活虚拟环境。

macOS / Linux：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py
```

默认端口为 8000。如果被占用，可以运行 `python run.py --port 8001`（使用对应虚拟环境的 Python）。

## 多人联机步骤

1. 所有人连接同一 Wi-Fi，或连接到可以互相访问的同一局域网。
2. 只需一台电脑运行服务，并保持终端窗口打开。
3. 服务器启动时会打印本机地址和局域网候选地址。选择当前 Wi-Fi 网卡的 IPv4 地址；可以用 Windows 的 `ipconfig` 核对。VPN 和虚拟网卡地址通常不适用。
4. 每个人在浏览器打开相同的局域网地址，例如 `http://192.168.1.20:8000`。这里的 IP 只是示例，要换成服务电脑的实际地址。
5. 一人输入昵称并创建房间，将六位房间号告诉其他人。其余人输入昵称和房间号加入。
6. 所有人点击“准备”，再由任一人发送联机测试信号；其他屏幕应该同步更新。

其他设备不能用 `127.0.0.1`、`localhost` 或 `0.0.0.0` 代替服务器的局域网 IP。队友作为玩家只需要浏览器，无需下载代码或安装 Python。

如果本机能打开而其他设备不能打开，先核对实际 IP、端口和 Wi-Fi。访客网络、学校网络可能隔离设备，可换允许设备互通的路由器。Windows 防火墙若拦截服务，需要你允许 Python 在可信的专用网络上接收入站连接；无需关闭整个防火墙。本工程不会自动修改防火墙。

## 开发与测试

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

测试覆盖四人同步、满房、身份校验、断线退出、连接替换、离开释放座位和房主交接。GitHub Actions 会在推送和 Pull Request 时运行测试。

```text
app/main.py          FastAPI 路由、房间状态、WebSocket
app/static/          浏览器网页、样式、交互代码
run.py               启动入口和局域网地址提示
tests/               联机行为测试
CONTRIBUTING.md      团队协作约定
```

## 实现约定与边界

HTTP 用于创建和加入房间，WebSocket 用于身份校验、准备、测试信号、离开和状态推送。服务器生成玩家身份与凭证，并按房间串行处理状态变更。

WebSocket 地址为 `/ws/{room_code}`，连接后第一条消息携带 `player_id` 和 `token`。后续命令包括 `set_ready`、`test_signal`、`ping` 和 `leave`；服务器推送 `room_state`、`pong` 或 `error`。所有浏览器根据服务器状态更新页面。

房间保存在内存中，只运行一个服务进程，不要开启多个 worker。服务器重启后房间全部清空，最多保留 128 个房间。玩家关闭、刷新页面或后退到大厅时直接退出，离开者的操作凭证立即失效，不保留离线席位。房主离开后交接给下一名玩家；最后一人离开后删除房间。

操作凭证仅存于当前页面内存，不自动重连。同一浏览器的新标签页可以模拟不同玩家。页面离开时通过 beacon 请求退出，同时关闭 WebSocket；服务器检测到断开也会移除玩家。浏览器崩溃或网络突然中断时，退出需等待服务器检测，当前心跳等待上限为 45 秒。已创建身份但始终未连接 WebSocket 的席位在 20 秒后释放。

本版本定位于可信局域网中的课程原型，采用 HTTP，没有账号系统或公网部署配置。GitHub 仓库用于共同编辑代码，不会代替运行中的 Python 服务器。还需要在真实的第二台设备上完成一次联机验收。
