"use strict";
const $ = (id) => document.getElementById(id);
const storageKey = "pythonfinal.session.v1";
let session = null, socket = null, retryTimer = null, heartbeat = null;
let latest = null, intentional = false, retryCount = 0;
try { session = JSON.parse(sessionStorage.getItem(storageKey)); } catch (_) {}
if (!session || typeof session.room_code !== "string" || typeof session.token !== "string" || typeof session.player_id !== "string") session = null;
function notice(message, error = false) {
  $("notice").textContent = message; $("notice").classList.toggle("error", error);
}
function setConnected(connected) { $("ready").disabled = !connected; $("signal").disabled = !connected; }
function log(message) {
  const li = document.createElement("li"); li.textContent = new Date().toLocaleTimeString() + " · " + message;
  $("events").prepend(li); while ($("events").children.length > 20) $("events").lastElementChild.remove();
}
function reset() {
  intentional = true; clearTimeout(retryTimer); clearInterval(heartbeat);
  if (socket) socket.close(); socket = null; session = null; latest = null;
  sessionStorage.removeItem(storageKey);
  document.body.classList.remove("in-room");
  $("entry").hidden = false; $("lobby").hidden = true; $("events").replaceChildren();
}
function render(state) {
  latest = state; $("players").replaceChildren();
  for (let i = 0; i < state.capacity; i++) {
    const player = state.players[i];
    const card = document.createElement("div"); card.className = "player";
    card.dataset.slot = "0" + (i + 1) + " / CHANNEL";
    const icon = document.createElement("div"); icon.className = "ship-icon"; icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"), status = document.createElement("span");
    status.className = "player-status";
    if (player) {
      name.textContent = player.name + (player.id === session.player_id ? "（你）" : "") + (player.host ? " · 房主" : "");
      status.textContent = !player.connected ? "暂时断线 · 保留座位" : player.ready ? "已连接 · 已准备" : "已连接 · 等待准备";
      card.classList.toggle("is-ready", player.connected && player.ready);
      card.classList.toggle("is-self", player.id === session.player_id);
    } else { name.textContent = "等待指挥官"; status.textContent = "频道待接入"; card.classList.add("is-empty"); }
    card.append(icon, name, status); $("players").append(card);
  }
  const self = state.players.find((p) => p.id === session.player_id);
  $("ready").textContent = self && self.ready ? "取消准备" : "准备";
  const allReady = state.players.length >= 2 && state.players.every((p) => p.connected && p.ready);
  $("readiness").textContent = allReady ? "所有人已准备，联机验证完成。游戏功能将在后续接入。" : "已入座 " + state.players.length + "/4 · 至少两人连接并准备，可验证多人状态同步。";
  if (state.event) log(state.event);
}
function connect() {
  intentional = false; $("entry").hidden = true; $("lobby").hidden = false;
  document.body.classList.add("in-room");
  $("room-code").textContent = session.room_code; $("address").textContent = location.origin;
  setConnected(false); notice("正在连接房间…");
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + encodeURIComponent(session.room_code));
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    ws.send(JSON.stringify({player_id: session.player_id, token: session.token}));
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: "ping"})); }, 15000);
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return;
    const data = JSON.parse(event.data);
    if (data.type === "room_state") { retryCount = 0; setConnected(true); notice("已连接 · 房间状态实时同步"); render(data); }
    else if (data.type === "error") notice(data.message, true);
  };
  ws.onclose = (event) => {
    if (socket !== ws) return;
    clearInterval(heartbeat); setConnected(false);
    if (intentional) return;
    if ([4401,4001,1008].includes(event.code)) {
      reset(); notice(event.code === 4001 ? "此座位已在另一个连接打开，请重新加入。" : "房间或身份已失效，请重新创建或加入。", true); return;
    }
    notice("连接已断开，正在自动重连…", true);
    retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retryCount++, 10000));
  };
  ws.onerror = () => notice("无法连接服务器，请确认服务仍在运行。", true);
}
async function enter(path) {
  const name = $("name").value.trim();
  if (!name) { notice("请输入昵称。", true); $("name").focus(); return; }
  $("create").disabled = $("join").disabled = true;
  try {
    const response = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name})});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "请检查昵称和房间号。");
    session = data; sessionStorage.setItem(storageKey, JSON.stringify(session)); connect();
  } catch (error) { notice(error.message || "连接失败。", true); }
  finally { $("create").disabled = $("join").disabled = false; }
}
function send(data) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
$("create").onclick = () => enter("/api/rooms");
$("join").onclick = () => {
  const code = $("code").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { notice("请输入六位字母或数字房间号。", true); return; }
  enter("/api/rooms/" + code + "/join");
};
$("ready").onclick = () => {
  const self = latest && latest.players.find((p) => p.id === session.player_id);
  if (self) send({type: "set_ready", ready: !self.ready});
};
$("signal").onclick = () => send({type: "test_signal"});
$("leave").onclick = () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) { notice("请等待重连后再离开，以便服务器释放座位。", true); return; }
  intentional = true;
  socket.onclose = () => { reset(); notice("已离开房间。"); };
  send({type: "leave"});
};
setConnected(false); if (session) connect();
