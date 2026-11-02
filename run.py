"""Start the LAN server and print candidate URLs for teammates."""
import argparse
import socket

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="PythonFinal 局域网联机大厅")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    print("\n本机浏览器：http://127.0.0.1:%s" % args.port)
    addresses = set(socket.gethostbyname_ex(socket.gethostname())[2])
    for address in sorted(addresses):
        if not address.startswith("127."):
            print("局域网候选地址：http://%s:%s" % (address, args.port))
    print("请选当前 Wi-Fi 的 IPv4 地址；VPN/虚拟网卡地址可能不可用。")
    print("保持此窗口运行。按 Ctrl+C 停止后，内存中的房间会清空。\n")
    uvicorn.run("app.main:app", host="0.0.0.0", port=args.port, workers=1,
                ws_max_size=4096, ws_max_queue=16)


if __name__ == "__main__":
    main()
