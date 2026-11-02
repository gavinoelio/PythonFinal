# PythonFinal 局域网联机原型

《深空乱斗 Dark Campaign》的多人连接基础工程。由一台电脑运行 Python 服务，同一 Wi-Fi 或局域网内的其他设备通过浏览器加入。当前只实现联机大厅，尚未实现棋盘、舰船、战斗或回合规则。

## 当前功能

- 创建六位房间号，最多四名玩家加入。
- 实时同步玩家列表、在线状态和准备状态。
- 发送联机测试信号，房间内所有在线玩家收到同一记录。
- 刷新页面恢复当前座位，短暂断线后自动重连。
- 主动离开释放座位；房主离开后由下一名玩家接任。
- 每名玩家有独立的重连凭证，其他玩家收到的房间状态不包含该凭证。

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

测试覆盖四人同步、满房、身份校验、断线重连、连接替换、离开释放座位和房主交接。GitHub Actions 会在推送和 Pull Request 时运行测试。

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

房间保存在内存中，只运行一个服务进程，不要开启多个 worker。服务器重启后房间全部清空；完全断开且六小时未活动的房间会在创建新房间时回收，最多保留 128 个房间。暂时断线的玩家仍占座，刷新同一标签页可以恢复；关闭标签页后身份不保证保留，当前没有踢人或账号找回功能。

这里使用 `sessionStorage` 保存重连凭证，同一浏览器的独立标签页可以模拟不同玩家。复制现有标签页可能继承其身份，建议另开新标签页手动输入网址，或使用不同浏览器。使用不同地址（例如 localhost 与局域网 IP）访问时也不会共享浏览器身份。

本版本定位于可信局域网中的课程原型，采用 HTTP，没有账号系统或公网部署配置。GitHub 仓库用于共同编辑代码，不会代替运行中的 Python 服务器。还需要在真实的第二台设备上完成一次联机验收。
