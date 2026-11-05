"use strict";
const GameUI = (() => {
  const root = () => document.getElementById("game-view");
  const labels = {attack: "攻击舰", scout: "探测舰", mothership: "母舰"};
  let room = null, game = null, me = null, emit = null, selected = null, mode = "selected";
  let draft = null, targetGear = null, roleDraft = ["", "", "", "", ""], timer = null;
  let lastPhase = null, lastTurn = null, toastUntil = 0, pendingKey = "";
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, fn, disabled = false, cls = "secondary") {
    const node = el("button", cls, text); node.disabled = disabled; node.onclick = fn; return node;
  }
  function svg(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function shipImage(fleet, number, cls = "") {
    const image = el("img", cls);
    image.src = `/static/assets/${fleet}-${number}.png`;
    image.alt = number + "号舰船"; image.draggable = false;
    return image;
  }
  function error(message) {
    const modal = document.getElementById("game-alert");
    document.getElementById("game-alert-text").textContent = message;
    if (!modal.open) modal.showModal();
  }
  document.getElementById("close-alert").onclick = () => document.getElementById("game-alert").close();
  function reset() {
    clearTimeout(timer); selected = null; draft = null; targetGear = null; mode = "selected";
    roleDraft = ["", "", "", "", ""]; lastPhase = null; lastTurn = null; pendingKey = "";
    root().replaceChildren();
  }
  function myself() { return game.crews.find((c) => c.id === me); }
  function current() { return game.crews.find((c) => c.id === game.current_player); }
  function captain(crew) { return crew.name.endsWith("舰长") ? crew.name : crew.name + "舰长"; }
  function color(crew) { return game.fleets[crew.fleet]?.color || "#79e4f3"; }
  function busy() { return Date.now() / 1000 < Math.max(game.busy_until, game.battle_starts_at); }
  function canAct() { return game.current_player === me && !busy(); }
  function myShip() { return myself().ships.find((s) => s.number === selected); }
  function command(message) { emit(message); }
  function header(title, subtitle) {
    const node = el("div", "game-heading");
    const block = el("div"); block.append(el("span", "eyebrow", "DARK CAMPAIGN / " + room.room_code), el("h2", "", title), el("p", "hint", subtitle));
    node.append(block, el("span", "phase-badge", game.phase === "battle" ? "ROUND " + String(game.round).padStart(2, "0") : "PREPARATION"));
    return node;
  }
  function fleetSelection() {
    root().append(header("选择你的舰队", "每支舰队只能由一名指挥官带领。选择会实时展示给队友。"));
    const grid = el("div", "fleet-grid");
    for (const [key, fleet] of Object.entries(game.fleets)) {
      const card = button("", () => command({type: "choose_fleet", fleet: key}), false, "fleet-card");
      card.setAttribute("aria-label", "选择" + fleet.name); card.style.setProperty("--fleet", fleet.color);
      card.classList.toggle("chosen", myself().fleet === key);
      card.append(el("span", "eyebrow", "FLEET / " + key.toUpperCase()), el("h3", "", fleet.name));
      const silhouettes = el("div", "fleet-ships");
      for (let n = 1; n <= 5; n++) { const symbol = el("span", "fleet-ship"); symbol.append(shipImage(key, n), el("small", "", String(n))); silhouettes.append(symbol); }
      card.append(silhouettes);
      const names = game.crews.filter((c) => c.fleet === key);
      const tokens = el("div", "name-tokens");
      for (const crew of names) tokens.append(el("span", "name-token", crew.name + (crew.id === me ? "（你）" : "")));
      if (!names.length) tokens.append(el("span", "hint", "等待指挥官选择"));
      card.append(tokens); grid.append(card);
    }
    root().append(grid);
    const values = game.crews.map((c) => c.fleet).filter(Boolean);
    const duplicate = new Set(values).size !== values.length;
    const host = room.players.find((p) => p.host)?.id === me;
    const proceed = button(host ? "进入对局" : "等待房主进入对局", () => {
      if (duplicate) error("舰队只能有一名指挥官");
      else command({type: "begin_deployment"});
    }, !host || (!game.fleet_valid && !duplicate), "proceed " + (duplicate ? "invalid" : game.fleet_valid ? "valid" : ""));
    root().append(proceed);
  }
  function point(column, radius, offset = 0) {
    const angle = ((column - .5) * 15 - 90 + offset) * Math.PI / 180;
    return {x: 400 + Math.cos(angle) * radius, y: 400 + Math.sin(angle) * radius};
  }
  const radii = {A: [248, 330], B: [160, 242], C: [72, 154]};
  function locationOf(ship) { return point(ship.column, (radii[ship.ring][0] + radii[ship.ring][1]) / 2); }
  function chooseCell(column, ring) {
    if (!canAct()) return;
    if (game.phase === "placement" && selected && !myShip().ring) {
      draft = {column, ring, direction: 1}; draw();
    } else if (game.phase === "battle" && mode === "shift") {
      const ship = myShip();
      if (column === ship.column && Math.abs("ABC".indexOf(ring) - "ABC".indexOf(ship.ring)) === 1) {
        command({type: "shift", ship: selected, ring}); mode = "selected";
      }
    }
  }
  function board() {
    const container = el("div", "board-canvas");
    container.classList.toggle("shifting", mode === "shift");
    const map = svg("svg", {viewBox: "0 0 800 800", "aria-label": "24列三圈棋盘", role: "group"});
    for (const ring of "ABC") {
      const [inner, outer] = radii[ring];
      for (let col = 1; col <= 24; col++) {
        const start = col - 1, end = col;
        const a = point(start + .5, outer, .35), b = point(end + .5, outer, -.35);
        const c = point(end + .5, inner, -.35), d = point(start + .5, inner, .35);
        const path = svg("path", {d: `M${a.x} ${a.y} A${outer} ${outer} 0 0 1 ${b.x} ${b.y} L${c.x} ${c.y} A${inner} ${inner} 0 0 0 ${d.x} ${d.y}Z`,
          class: "map-cell", id: `cell-${col}-${ring}`, role: "button", tabindex: "0", "aria-label": `${col}${ring}`});
        if (mode === "shift" && myShip()) {
          const active = col === myShip().column && Math.abs("ABC".indexOf(ring) - "ABC".indexOf(myShip().ring)) === 1;
          path.classList.add(active ? "shift-target" : "dim-cell");
        }
        path.onclick = () => chooseCell(col, ring);
        path.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chooseCell(col, ring); } };
        path.ondragover = (e) => { if (game.phase === "placement" && canAct()) e.preventDefault(); };
        path.ondrop = (e) => {
          e.preventDefault();
          const number = Number(e.dataTransfer.getData("text/plain"));
          if (myself().ships.some((s) => s.number === number && !s.ring)) { selected = number; chooseCell(col, ring); }
        };
        map.append(path);
        const mid = point(col, (inner + outer) / 2);
        const label = svg("text", {x: mid.x, y: mid.y + 4, class: "cell-label", "text-anchor": "middle"}); label.textContent = col + ring; map.append(label);
      }
    }
    map.append(svg("circle", {cx: 400, cy: 400, r: 57, class: "map-core"}));
    const core = svg("text", {x: 400, y: 398, "text-anchor": "middle", class: "map-core-label"}); core.textContent = "DARK"; map.append(core);
    const core2 = svg("text", {x: 400, y: 416, "text-anchor": "middle", class: "map-core-label"}); core2.textContent = "CAMPAIGN"; map.append(core2);
    const occupancy = {};
    for (const crew of game.crews) for (const ship of crew.ships) {
      if (!ship.ring) continue;
      const key = ship.column + ship.ring; (occupancy[key] ||= []).push({crew, ship});
    }
    for (const group of Object.values(occupancy)) group.forEach(({crew, ship}, index) => {
      const pos = locationOf(ship);
      // Keep overlapping tokens separately selectable, without changing their cells.
      if (group.length > 1) {
        pos.x += Math.cos(index * 2 * Math.PI / group.length) * Math.min(24, group.length * 5);
        pos.y += Math.sin(index * 2 * Math.PI / group.length) * Math.min(24, group.length * 5);
      }
      const token = svg("g", {transform: `translate(${pos.x},${pos.y})`, class: "board-ship" + (selected === ship.number && crew.id === me ? " selected-ship" : ""), role: "button", tabindex: "0", "data-gear": ship.gear,
        "aria-label": `${crew.name} ${ship.number}号舰船 ${ship.column}${ship.ring} ${ship.gear}档`});
      const degrees = (ship.column - .5) * 15 + (ship.direction === 1 ? 90 : -90);
      token.append(svg("image", {href: `/static/assets/${crew.fleet}-${ship.number}.png`, x: -13, y: -17, width: 26, height: 34, transform: `rotate(${degrees})`}));
      if (ship.gear > 0) token.append(svg("image", {href: `/static/assets/gear-${ship.gear}.png`, x: -12, y: 12, width: 24, height: 5, transform: `rotate(${degrees})`, class: "gear-marker", "aria-label": ship.gear + "档"}));
      token.append(svg("path", {d: "M-5 -22 0 -29 5 -22Z", fill: color(crew), transform: `rotate(${degrees})`}));
      const num = svg("text", {x: 0, y: 27, "text-anchor": "middle", class: "ship-number"}); num.textContent = ship.number + " / " + ship.gear; token.append(num);
      const select = () => {
        if (crew.id !== me || !canAct() || game.phase !== "battle" || mode === "shift") return;
        selected = ship.number; mode = "selected"; targetGear = null; draw();
      };
      token.onclick = (e) => { e.stopPropagation(); select(); };
      token.onkeydown = (e) => { if (e.key === "Enter") select(); };
      map.append(token);
    });
    if (draft && game.phase === "placement") {
      const pos = locationOf(draft);
      const ghost = svg("g", {transform: `translate(${pos.x},${pos.y})`, class: "deployment-ghost"});
      ghost.append(svg("circle", {r: 24}));
      ghost.append(svg("path", {d: "M0 -15 10 11 0 6 -10 11Z", fill: color(myself()), transform: `rotate(${(draft.column - .5) * 15 + (draft.direction === 1 ? 90 : -90)})`})); map.append(ghost);
    }
    container.append(map);
    if ((draft && game.phase === "placement") || (selected && game.phase === "battle" && canAct())) container.append(shipMenu());
    return container;
  }
  function shipMenu() {
    const menu = el("div", "ship-menu");
    const ship = myShip();
    const pos = locationOf(draft || ship);
    menu.style.left = Math.min(69, Math.max(3, pos.x / 8 + 3)) + "%";
    menu.style.top = Math.min(70, Math.max(3, pos.y / 8 - 5)) + "%";
    menu.append(el("strong", "", selected + "号舰船"));
    if (game.phase === "placement") {
      menu.append(el("span", "hint", draft.column + draft.ring + " · " + (draft.direction === 1 ? "顺时针" : "逆时针")),
        button("确认部署", () => { command({type: "place_ship", ship: selected, ...draft}); draft = null; selected = null; }),
        button("转向", () => { draft.direction *= -1; draw(); }),
        button("取消", () => { draft = null; draw(); }));
      return menu;
    }
    const locked = game.move_ship !== null && game.move_ship !== selected;
    if (mode === "selected") {
      menu.append(button("移动", () => { mode = "menu"; draw(); }, locked || (game.gear_used && game.shift_used && ship.gear !== 0)),
        button("取消", () => { selected = null; draw(); }));
    } else if (mode === "menu") {
      menu.append(button("横移 · 1能量", () => { mode = "shift"; draw(); }, game.shift_used || myself().energy < 1 || locked));
      for (const gear of [3, 2, 1, 0]) menu.append(button("档位" + gear, () => { targetGear = gear; mode = "confirm"; draw(); },
        game.gear_used || ship.gear === gear || myself().energy < Math.abs(gear - ship.gear) || locked));
      menu.append(button("0档转向", () => { command({type: "turn_ship", ship: selected}); mode = "selected"; }, ship.gear !== 0 || locked),
        button("取消", () => { mode = "selected"; draw(); }));
    } else if (mode === "shift") {
      menu.append(el("p", "hint", "点选高亮的相邻圈层"), button("取消横移", () => { mode = "menu"; draw(); }));
    } else {
      menu.append(el("p", "hint", `${ship.gear}档 → ${targetGear}档 · 消耗${Math.abs(targetGear - ship.gear)}能量`),
        button("确认调档", () => { command({type: "set_gear", ship: selected, gear: targetGear}); mode = "menu"; targetGear = null; }),
        button("取消", () => { mode = "selected"; targetGear = null; draw(); }));
    }
    return menu;
  }
  function playerConsole() {
    const panel = el("div", "player-console");
    const heading = el("div", "console-heading");
    heading.append(el("h3", "", game.fleets[myself().fleet].name + " · " + myself().name),
      button("结束回合", () => { selected = null; mode = "selected"; targetGear = null; command({type: "end_turn"}); }, game.phase !== "battle" || !canAct(), "end-turn"));
    panel.append(heading);
    const summary = el("div", "ship-summary");
    for (const ship of myself().ships) {
      const item = el("div", "summary-ship");
      const picture = el("span", "ship-card-image"); picture.append(shipImage(myself().fleet, ship.number));
      if (ship.gear > 0) { const marker = el("img", "card-gear-marker"); marker.src = `/static/assets/gear-${ship.gear}.png`; marker.alt = ship.gear + "档"; picture.append(marker); }
      item.append(picture, el("span", "", ship.number + "号 · " + labels[ship.role])); summary.append(item);
    }
    panel.append(summary);
    const status = el("div", "console-status");
    const energy = el("div", "energy-bank"); energy.setAttribute("aria-label", "公共能量 " + myself().energy);
    const cost = mode === "shift" ? 1 : mode === "confirm" && myShip() ? Math.abs(targetGear - myShip().gear) : 0;
    for (let i = 0; i < 12; i++) energy.append(el("span", "energy-block" + (i >= myself().energy ? " spent" : "") + (i < myself().energy && i >= myself().energy - cost ? " flashing" : "")));
    const energyLabel = el("div", "energy-label"); energyLabel.append(el("span", "eyebrow", "共享能量 " + myself().energy + " / 12"), energy);
    const indicators = el("div", "action-indicators");
    indicators.append(el("span", game.phase === "battle" && canAct() && !game.gear_used ? "lit" : "", "● 移动"), el("span", "", "● 战术"));
    status.append(energyLabel, indicators); panel.append(status);
    if (game.phase === "placement") {
      const tray = el("div", "ship-tray");
      for (const ship of myself().ships.filter((s) => !s.ring)) {
        const token = button("", () => { selected = ship.number; draft = null; draw(); }, !canAct(), selected === ship.number ? "tray-ship active" : "tray-ship secondary");
        token.setAttribute("aria-label", "部署" + ship.number + "号舰船");
        token.append(shipImage(myself().fleet, ship.number), el("span", "", ship.number + "号"));
        token.draggable = canAct(); token.style.setProperty("--fleet", color(myself()));
        token.ondragstart = (e) => { selected = ship.number; draft = null; e.dataTransfer.setData("text/plain", String(ship.number)); };
        tray.append(token);
      }
      panel.append(tray, el("p", "hint", selected ? "将舰船拖到格子，或点击棋盘格，再确认朝向。" : "拖拽或点选一艘舰船，开始部署。"));
    }
    if ((game.phase === "placement" || game.phase === "battle") && (!canAct())) panel.append(el("div", "console-lock", busy() ? "正在处理被动移动，请稍候" : "等待 " + captain(current())));
    return panel;
  }
  function rolesOverlay() {
    const overlay = el("div", "game-overlay");
    const card = el("div", "role-card");
    card.append(el("span", "eyebrow", "PRIVATE SHIP CONFIGURATION"), el("h2", "", myself().roles_ready ? "请等待其他舰长" : "请部署舰船种类"));
    if (!myself().roles_ready) {
      const slots = el("div", "role-slots");
      for (let i = 0; i < 5; i++) {
        const label = el("label", "role-slot", "No." + (i + 1));
        const select = el("select"); select.setAttribute("aria-label", (i + 1) + "号舰船种类");
        const placeholder = el("option", "", "选择舰种"); placeholder.value = ""; select.append(placeholder);
        for (const [value, name] of Object.entries(labels)) { const option = el("option", "", name); option.value = value; select.append(option); }
        select.value = roleDraft[i]; select.onchange = () => { roleDraft[i] = select.value; updateValidation(); };
        label.append(el("span", "role-icon", "▲"), select); slots.append(label);
      }
      const complete = button("部署完成", () => {
        const valid = roleDraft.filter((v) => v === "attack").length === 2 && roleDraft.filter((v) => v === "scout").length === 2 && roleDraft.filter((v) => v === "mothership").length === 1;
        if (!valid) error("请选择攻击舰*2；探测舰*2；母舰*1");
        else command({type: "set_roles", roles: roleDraft});
      }, true, "role-complete");
      function updateValidation() {
        const filled = roleDraft.every(Boolean);
        const valid = roleDraft.filter((v) => v === "attack").length === 2 && roleDraft.filter((v) => v === "scout").length === 2 && roleDraft.filter((v) => v === "mothership").length === 1;
        complete.disabled = !filled; complete.className = "role-complete " + (filled ? valid ? "valid" : "invalid" : "");
      }
      updateValidation(); card.append(slots, el("p", "hint", "仅你可见 · 攻击舰 ×2 / 探测舰 ×2 / 母舰 ×1"), complete);
    } else card.append(el("p", "hint", "你的舰种已秘密锁定。其他玩家不会收到你的舰种配置。"));
    overlay.append(card); return overlay;
  }
  function draw() {
    const previousLog = root().querySelector(".battle-log-entries");
    const previousScroll = previousLog ? previousLog.scrollTop : 0;
    const followingLog = !previousLog || previousLog.scrollHeight - previousLog.clientHeight - previousScroll < 35;
    clearTimeout(timer); root().replaceChildren();
    if (!game) return;
    if (game.phase === "fleet") { fleetSelection(); return; }
    const phaseText = game.phase === "roles" ? "秘密配置舰种" : game.phase === "placement" ? "轮流部署舰船" : "第 " + game.round + " 轮 · " + captain(current()) + "的回合";
    root().append(header(phaseText, game.phase === "placement" ? "每人每次部署一艘 · 初始0档 · 确认后轮到下一位舰长" : "位置公开 / 舰种隐藏 · 移动与回合原型"));
    const layout = el("div", "game-layout");
    layout.inert = game.phase === "roles" || (game.phase === "battle" && Date.now() / 1000 < game.battle_starts_at);
    const field = el("div", "battle-field"); field.append(board());
    const logs = el("aside", "battle-log"); logs.setAttribute("aria-label", "对局记录");
    logs.append(el("h3", "", "对局记录"), el("span", "eyebrow", "MISSION LOG"));
    const entries = el("div", "battle-log-entries");
    let round = 0;
    for (const entry of game.logs) {
      if (entry.round !== round) { round = entry.round; entries.append(el("h4", "", "第 " + round + " 轮")); }
      entries.append(el("p", "log-" + entry.kind, entry.text));
    }
    if (!game.logs.length) entries.append(el("p", "hint", "全员放置完毕后开始记录"));
    logs.append(entries); layout.append(field, logs, playerConsole()); root().append(layout);
    if (game.phase === "roles") root().append(rolesOverlay());
    if (game.phase === "battle" && Date.now() / 1000 < game.battle_starts_at) {
      const intro = el("div", "game-overlay battle-intro"); intro.append(el("h2", "", "战斗开始")); root().append(intro);
    } else if (game.phase === "battle" && Date.now() < toastUntil) root().append(el("div", "turn-toast", "你的回合"));
    const deadlines = [game.busy_until * 1000, game.battle_starts_at * 1000, toastUntil].filter((deadline) => deadline > Date.now());
    if (deadlines.length) timer = setTimeout(draw, Math.min(...deadlines) - Date.now() + 30);
    const logKey = game.logs.length + ":" + game.phase;
    entries.scrollTop = pendingKey !== logKey && followingLog ? entries.scrollHeight : previousScroll;
    pendingKey = logKey;
  }
  function render(state, playerId, send) {
    room = state; me = playerId; emit = send; game = state.game;
    if (!game) { reset(); return; }
    if (lastPhase !== game.phase) { selected = null; draft = null; mode = "selected"; targetGear = null; }
    const turn = game.round + ":" + game.current_player;
    if (lastTurn !== turn) {
      selected = null; draft = null; mode = "selected"; targetGear = null;
      if (game.phase === "battle" && game.current_player === me) toastUntil = Math.max(Date.now(), game.busy_until * 1000, game.battle_starts_at * 1000) + 1100;
    }
    lastPhase = game.phase; lastTurn = turn; draw();
  }
  return {render, reset, error};
})();
