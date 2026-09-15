
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const WORLD_SIZE = 2400;
const MAX_POSITION_DELTA = 30;
const STATE_INTERVAL = 50;

const server = http.createServer((req, res) => {
  let requestedPath = req.url || "/";

  if (requestedPath === "/") {
    requestedPath = "/client.html";
  }

  const filePath = path.join(__dirname, requestedPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);

  let contentType = "application/octet-stream";

  if (ext === ".html") {
    contentType = "text/html; charset=utf-8";
  } else if (ext === ".js") {
    contentType = "application/javascript; charset=utf-8";
  } else if (ext === ".css") {
    contentType = "text/css; charset=utf-8";
  }

  res.writeHead(200, {
    "Content-Type": contentType
  });

  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocket.Server({
  server
});

const players = new Map();
const parties = new Map();

const bullets = [];
const loot = [];
const walls = [];

let nextPlayerId = 1;
let nextBulletId = 1;
let nextWallId = 1;

const EMOTES = new Set([
  "😀",
  "😂",
  "😎"
]);

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastParty(partyCode, data) {
  if (!partyCode) return;

  for (const player of players.values()) {
    if (
      player.partyCode === partyCode &&
      player.ws &&
      player.ws.readyState === WebSocket.OPEN
    ) {
      player.ws.send(JSON.stringify(data));
    }
  }
}

function randomPartyCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();
  } while (parties.has(code));

  return code;
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,

    x: player.x,
    y: player.y,

    angle: player.angle,

    hp: player.hp,
    shield: player.shield,

    weapon: player.weapon,

    ammo: player.ammo,
    maxAmmo: player.maxAmmo,

    kills: player.kills,

    alive: player.alive,
    moving: player.moving,

    team: player.team,

    selectedSlot: player.selectedSlot,

    emote: player.emote,
    emoteUntil: player.emoteUntil,

    pickaxeUntil: player.pickaxeUntil
  };
}

function createPlayer(ws, name) {
  const player = {
    id: nextPlayerId++,
    ws,

    name: String(name || "Player").substring(0, 16),

    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,

    angle: 0,

    hp: 100,
    shield: 50,

    weapon: "rifle",

    ammo: 30,
    maxAmmo: 30,

    kills: 0,

    alive: true,
    moving: false,

    team: null,

    partyCode: null,

    ready: false,
    isHost: false,

    selectedSlot: 1,

    emote: null,
    emoteUntil: 0,

    pickaxeUntil: 0
  };

  players.set(player.id, player);

  send(ws, {
    type: "player",
    player: serializePlayer(player)
  });

  send(ws, {
    type: "joined",
    player: serializePlayer(player),
    partyCode: null
  });

  return player;
}

function ensurePlayer(ws, name) {
  for (const player of players.values()) {
    if (player.ws === ws) {
      if (name) {
        player.name = String(name).substring(0, 16);
      }

      return player;
    }
  }

  return createPlayer(ws, name);
}

function getPartyState(party) {
  return {
    code: party.code,
    hostId: party.hostId,
    started: party.started,
    teamMode: party.teamMode,

    players: [...party.players]
      .map(id => players.get(id))
      .filter(Boolean)
      .map(player => ({
        id: player.id,
        name: player.name,
        ready: player.ready,
        isHost: player.isHost,
        team: player.team
      }))
  };
}

function sendPartyState(party) {
  if (!party) return;

  const state = getPartyState(party);

  broadcastParty(party.code, {
    type: "party",

    code: state.code,
    hostId: state.hostId,
    started: state.started,
    teamMode: state.teamMode,
    players: state.players,

    party: state
  });
}

function removePlayerFromParty(player) {
  if (!player.partyCode) {
    return;
  }

  const oldPartyCode = player.partyCode;
  const party = parties.get(oldPartyCode);

  if (!party) {
    player.partyCode = null;
    player.ready = false;
    player.isHost = false;
    return;
  }

  party.players.delete(player.id);

  player.partyCode = null;
  player.ready = false;
  player.isHost = false;
  player.team = null;

  if (party.hostId === player.id) {
    const nextHost = [...party.players][0] || null;

    party.hostId = nextHost;

    if (nextHost) {
      const hostPlayer = players.get(nextHost);

      if (hostPlayer) {
        hostPlayer.isHost = true;
      }
    }
  }

  if (party.players.size === 0) {
    parties.delete(oldPartyCode);
    return;
  }

  sendPartyState(party);
}

function createParty(player, teamMode) {
  removePlayerFromParty(player);

  const code = randomPartyCode();

  const party = {
    code,
    hostId: player.id,

    players: new Set([player.id]),

    started: false,

    teamMode: teamMode || "solo"
  };

  parties.set(code, party);

  player.partyCode = code;
  player.ready = false;
  player.isHost = true;

  sendPartyState(party);
}

function joinParty(player, code) {
  code = String(code || "")
    .trim()
    .toUpperCase();

  const party = parties.get(code);

  if (!party) {
    send(player.ws, {
      type: "error",
      message: "Partida no encontrada"
    });

    return;
  }

  if (party.started) {
    send(player.ws, {
      type: "error",
      message: "La partida ya ha comenzado"
    });

    return;
  }

  removePlayerFromParty(player);

  party.players.add(player.id);

  player.partyCode = party.code;
  player.ready = false;
  player.isHost = false;

  sendPartyState(party);
}

function setReady(player, ready) {
  if (!player.partyCode) return;

  const party = parties.get(player.partyCode);

  if (!party) return;

  player.ready = !!ready;

  sendPartyState(party);
}

function startParty(player) {
  if (!player.partyCode) {
    send(player.ws, {
      type: "error",
      message: "Primero crea o únete a una partida."
    });

    return;
  }

  const party = parties.get(player.partyCode);

  if (!party) {
    send(player.ws, {
      type: "error",
      message: "La partida no existe."
    });

    return;
  }

  if (party.hostId !== player.id) {
    send(player.ws, {
      type: "error",
      message: "Solo el anfitrión puede iniciar."
    });

    return;
  }

  if (party.started) {
    return;
  }

  party.started = true;

  const partyPlayers = [...party.players]
    .map(id => players.get(id))
    .filter(Boolean);

  if (
    party.teamMode === "duo" ||
    party.teamMode === "squad" ||
    party.teamMode === "teams"
  ) {
    partyPlayers.forEach((p, index) => {
      p.team = index % 2;
    });
  } else {
    partyPlayers.forEach(p => {
      p.team = null;
    });
  }

  partyPlayers.forEach((p, index) => {
    p.x = 300 + (index % 4) * 100;
    p.y = 300 + Math.floor(index / 4) * 100;

    p.hp = 100;
    p.shield = 50;

    p.ammo = p.maxAmmo;

    p.alive = true;
    p.moving = false;

    p.kills = 0;

    p.selectedSlot = 1;

    p.emote = null;
    p.emoteUntil = 0;

    p.pickaxeUntil = 0;
  });

  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].partyCode === party.code) {
      bullets.splice(i, 1);
    }
  }

  for (let i = walls.length - 1; i >= 0; i--) {
    if (walls[i].partyCode === party.code) {
      walls.splice(i, 1);
    }
  }

  for (let i = loot.length - 1; i >= 0; i--) {
    if (loot[i].partyCode === party.code) {
      loot.splice(i, 1);
    }
  }

  broadcastParty(party.code, {
    type: "start",
    started: true
  });

  broadcastParty(party.code, {
    type: "gameStarted",
    started: true
  });

  broadcastStateToParty(party.code);
}

function updatePlayer(player, data) {
  if (!player.alive) return;

  const newX = Number(data.x);
  const newY = Number(data.y);
  const angle = Number(data.angle);

  if (!Number.isFinite(newX) || !Number.isFinite(newY)) {
    return;
  }

  if (
    Math.abs(newX - player.x) > MAX_POSITION_DELTA ||
    Math.abs(newY - player.y) > MAX_POSITION_DELTA
  ) {
    return;
  }

  player.x = Math.max(
    0,
    Math.min(WORLD_SIZE, newX)
  );

  player.y = Math.max(
    0,
    Math.min(WORLD_SIZE, newY)
  );

  if (Number.isFinite(angle)) {
    player.angle = angle;
  }

  player.moving = !!data.moving;
}

function shoot(player) {
  if (!player.alive) return;

  if (player.ammo <= 0) {
    return;
  }

  player.ammo--;

  const angle = Number(player.angle) || 0;
  const speed = 900;

  bullets.push({
    id: nextBulletId++,

    ownerId: player.id,

    partyCode: player.partyCode,

    x: player.x + Math.cos(angle) * 28,
    y: player.y + Math.sin(angle) * 28,

    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,

    damage: 20,

    life: 1000
  });
}

function reload(player) {
  if (!player.alive) return;

  player.ammo = player.maxAmmo;
}

function damagePlayer(player, damage, attackerId) {
  if (!player.alive) {
    return;
  }

  let remainingDamage = damage;

  if (player.shield > 0) {
    const shieldDamage = Math.min(
      player.shield,
      remainingDamage
    );

    player.shield -= shieldDamage;
    remainingDamage -= shieldDamage;
  }

  if (remainingDamage > 0) {
    player.hp -= remainingDamage;
  }

  if (player.hp <= 0) {
    killPlayer(player, attackerId);
  }
}

function killPlayer(player, attackerId) {
  if (!player.alive) {
    return;
  }

  player.hp = 0;
  player.alive = false;
  player.moving = false;

  if (
    attackerId &&
    attackerId !== player.id
  ) {
    const attacker = players.get(attackerId);

    if (
      attacker &&
      attacker.partyCode === player.partyCode
    ) {
      attacker.kills++;
    }
  }

  broadcastParty(player.partyCode, {
    type: "kill",

    playerId: player.id,

    attackerId: attackerId || null,

    killerId: attackerId || null
  });

  checkWinner(player.partyCode);
}

function checkWinner(partyCode) {
  if (!partyCode) return;

  const party = parties.get(partyCode);

  if (!party || !party.started) {
    return;
  }

  const partyPlayers = [...party.players]
    .map(id => players.get(id))
    .filter(Boolean);

  const alivePlayers = partyPlayers.filter(
    player => player.alive
  );

  if (
    alivePlayers.length <= 1 &&
    partyPlayers.length > 1
  ) {
    const winner = alivePlayers[0] || null;

    broadcastParty(partyCode, {
      type: "end",

      winnerId: winner ? winner.id : null,

      winnerName: winner
        ? winner.name
        : "Nadie"
    });
  }
}

function segmentIntersectsRect(
  x1,
  y1,
  x2,
  y2,
  rect
) {
  const left = rect.x;
  const right = rect.x + rect.width;

  const top = rect.y;
  const bottom = rect.y + rect.height;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (
    x1 >= left &&
    x1 <= right &&
    y1 >= top &&
    y1 <= bottom
  ) {
    return true;
  }

  if (
    x2 >= left &&
    x2 <= right &&
    y2 >= top &&
    y2 <= bottom
  ) {
    return true;
  }

  let t0 = 0;
  let t1 = 1;

  const p = [
    -dx,
    dx,
    -dy,
    dy
  ];

  const q = [
    x1 - left,
    right - x1,
    y1 - top,
    bottom - y1
  ];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) {
        return false;
      }
    } else {
      const r = q[i] / p[i];

      if (p[i] < 0) {
        if (r > t1) {
          return false;
        }

        if (r > t0) {
          t0 = r;
        }
      } else {
        if (r < t0) {
          return false;
        }

        if (r < t1) {
          t1 = r;
        }
      }
    }
  }

  return true;
}

function updateBullets(deltaMs) {
  const delta = deltaMs / 1000;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];

    const oldX = bullet.x;
    const oldY = bullet.y;

    const newX =
      oldX +
      bullet.vx * delta;

    const newY =
      oldY +
      bullet.vy * delta;

    bullet.x = newX;
    bullet.y = newY;

    bullet.life -= deltaMs;

    let removeBullet = false;

    for (const wall of walls) {
      if (wall.partyCode !== bullet.partyCode) {
        continue;
      }

      if (
        segmentIntersectsRect(
          oldX,
          oldY,
          newX,
          newY,
          wall
        )
      ) {
        removeBullet = true;
        break;
      }
    }

    if (removeBullet) {
      bullets.splice(i, 1);
      continue;
    }

    for (const player of players.values()) {
      if (!player.alive) {
        continue;
      }

      if (player.id === bullet.ownerId) {
        continue;
      }

      if (player.partyCode !== bullet.partyCode) {
        continue;
      }

      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;

      const distanceSquared =
        dx * dx +
        dy * dy;

      if (distanceSquared <= 22 * 22) {
        damagePlayer(
          player,
          bullet.damage,
          bullet.ownerId
        );

        removeBullet = true;
        break;
      }
    }

    if (
      removeBullet ||
      bullet.life <= 0
    ) {
      bullets.splice(i, 1);
      continue;
    }

    if (
      bullet.x < 0 ||
      bullet.x > WORLD_SIZE ||
      bullet.y < 0 ||
      bullet.y > WORLD_SIZE
    ) {
      bullets.splice(i, 1);
    }
  }
}

function build(player) {
  if (!player.alive) return;

  player.selectedSlot = 3;

  const angle = Number(player.angle) || 0;

  const width = 60;
  const height = 60;
  const distance = 70;

  let x =
    player.x +
    Math.cos(angle) * distance -
    width / 2;

  let y =
    player.y +
    Math.sin(angle) * distance -
    height / 2;

  x = Math.max(
    0,
    Math.min(
      WORLD_SIZE - width,
      x
    )
  );

  y = Math.max(
    0,
    Math.min(
      WORLD_SIZE - height,
      y
    )
  );

  const wall = {
    id: nextWallId++,

    x,
    y,

    width,
    height,

    ownerId: player.id,

    partyCode: player.partyCode
  };

  walls.push(wall);

  const playerWalls = walls.filter(
    w => w.ownerId === player.id
  );

  if (playerWalls.length > 20) {
    const oldest = playerWalls[0];
    const index = walls.indexOf(oldest);

    if (index !== -1) {
      walls.splice(index, 1);
    }
  }
}

function pickaxe(player) {
  if (!player.alive) return;

  player.selectedSlot = 4;

  player.pickaxeUntil =
    Date.now() + 350;

  const range = 75;

  for (let i = walls.length - 1; i >= 0; i--) {
    const wall = walls[i];

    if (wall.partyCode !== player.partyCode) {
      continue;
    }

    const centerX =
      wall.x +
      wall.width / 2;

    const centerY =
      wall.y +
      wall.height / 2;

    const dx =
      centerX -
      player.x;

    const dy =
      centerY -
      player.y;

    const distance =
      Math.sqrt(
        dx * dx +
        dy * dy
      );

    if (distance <= range) {
      walls.splice(i, 1);
      break;
    }
  }
}

function pickup(player, lootId) {
  if (!player.alive) {
    return;
  }

  let index = -1;

  if (lootId != null) {
    index = loot.findIndex(
      item =>
        item.id === lootId &&
        item.partyCode === player.partyCode
    );
  } else {
    let bestDistance = Infinity;

    loot.forEach((item, i) => {
      if (item.partyCode !== player.partyCode) {
        return;
      }

      const dx =
        item.x -
        player.x;

      const dy =
        item.y -
        player.y;

      const distance =
        dx * dx +
        dy * dy;

      if (
        distance < 80 * 80 &&
        distance < bestDistance
      ) {
        bestDistance = distance;
        index = i;
      }
    });
  }

  if (index === -1) {
    return;
  }

  const item = loot[index];

  const dx =
    item.x -
    player.x;

  const dy =
    item.y -
    player.y;

  if (
    dx * dx +
    dy * dy >
    80 * 80
  ) {
    return;
  }

  if (item.type === "ammo") {
    player.ammo = Math.min(
      player.maxAmmo,
      player.ammo + (item.amount || 10)
    );
  }

  if (item.type === "shield") {
    player.shield = Math.min(
      100,
      player.shield + (item.amount || 25)
    );
  }

  if (item.type === "health") {
    player.hp = Math.min(
      100,
      player.hp + (item.amount || 25)
    );
  }

  loot.splice(index, 1);
}

function emote(player, value) {
  if (!player.alive) {
    return;
  }

  value = String(value || "");

  if (!EMOTES.has(value)) {
    return;
  }

  player.emote = value;

  player.emoteUntil =
    Date.now() + 2000;

  broadcastParty(player.partyCode, {
    type: "emote",

    id: player.id,

    playerId: player.id,

    emote: value
  });
}

function createState(partyCode) {
  const now = Date.now();

  const statePlayers = [];

  for (const player of players.values()) {
    if (player.partyCode !== partyCode) {
      continue;
    }

    if (
      player.emoteUntil &&
      player.emoteUntil < now
    ) {
      player.emote = null;
      player.emoteUntil = 0;
    }

    statePlayers.push(
      serializePlayer(player)
    );
  }

  return {
    type: "state",

    players: statePlayers,

    bullets: bullets
      .filter(
        bullet =>
          bullet.partyCode === partyCode
      )
      .map(bullet => ({
        id: bullet.id,
        ownerId: bullet.ownerId,
        x: bullet.x,
        y: bullet.y
      })),

    loot: loot.filter(
      item =>
        item.partyCode === partyCode
    ),

    walls: walls
      .filter(
        wall =>
          wall.partyCode === partyCode
      )
      .map(wall => ({
        id: wall.id,

        x: wall.x,
        y: wall.y,

        width: wall.width,
        height: wall.height,

        ownerId: wall.ownerId
      }))
  };
}

function broadcastStateToParty(partyCode) {
  broadcastParty(
    partyCode,
    createState(partyCode)
  );
}

function broadcastStates() {
  for (const party of parties.values()) {
    if (!party.started) {
      continue;
    }

    broadcastStateToParty(party.code);
  }
}

wss.on("connection", ws => {
  let player = null;

  ws.on("message", rawMessage => {
    let data;

    try {
      data = JSON.parse(
        rawMessage.toString()
      );
    } catch (error) {
      return;
    }

    if (
      !data ||
      typeof data.type !== "string"
    ) {
      return;
    }

    if (data.type === "createPlayer") {
      if (!player) {
        player = ensurePlayer(
          ws,
          data.name
        );
      }

      return;
    }

    if (data.type === "createParty") {
      player = ensurePlayer(
        ws,
        data.name
      );

      createParty(
        player,
        data.teamMode
      );

      return;
    }

    if (data.type === "joinParty") {
      player = ensurePlayer(
        ws,
        data.name
      );

      joinParty(
        player,
        data.code
      );

      return;
    }

    if (data.type === "ready") {
      player = player || ensurePlayer(
        ws,
        data.name
      );

      setReady(
        player,
        data.ready !== false
      );

      return;
    }

    if (data.type === "start") {
      player = player || ensurePlayer(
        ws,
        data.name
      );

      startParty(player);

      return;
    }

    if (data.type === "leaveParty") {
      if (!player) {
        return;
      }

      const oldPartyCode =
        player.partyCode;

      removePlayerFromParty(player);

      send(ws, {
        type: "leftParty"
      });

      if (oldPartyCode) {
        const party =
          parties.get(oldPartyCode);

        if (party) {
          sendPartyState(party);
        }
      }

      return;
    }

    if (data.type === "update") {
      if (!player) {
        return;
      }

      updatePlayer(
        player,
        data
      );

      return;
    }

    if (data.type === "shoot") {
      if (!player) {
        return;
      }

      if (
        Number.isFinite(
          Number(data.angle)
        )
      ) {
        player.angle =
          Number(data.angle);
      }

      shoot(player);

      return;
    }

    if (data.type === "reload") {
      if (!player) {
        return;
      }

      reload(player);

      return;
    }

    if (data.type === "selectSlot") {
      if (!player) {
        return;
      }

      const slot =
        Number(data.slot);

      if (
        Number.isInteger(slot) &&
        slot >= 1 &&
        slot <= 4
      ) {
        player.selectedSlot = slot;
      }

      return;
    }

    if (data.type === "build") {
      if (!player) {
        return;
      }

      if (
        Number.isFinite(
          Number(data.angle)
        )
      ) {
        player.angle =
          Number(data.angle);
      }

      build(player);

      return;
    }

    if (data.type === "pickaxe") {
      if (!player) {
        return;
      }

      if (
        Number.isFinite(
          Number(data.angle)
        )
      ) {
        player.angle =
          Number(data.angle);
      }

      pickaxe(player);

      return;
    }

    if (data.type === "pickup") {
      if (!player) {
        return;
      }

      pickup(
        player,
        data.id
      );

      return;
    }

    if (data.type === "chat") {
      if (!player) {
        return;
      }

      const message = String(
        data.message || ""
      )
        .trim()
        .substring(0, 200);

      if (!message) {
        return;
      }

      broadcastParty(
        player.partyCode,
        {
          type: "chat",

          playerId: player.id,

          name: player.name,

          message
        }
      );

      return;
    }

    if (data.type === "emote") {
      if (!player) {
        return;
      }

      emote(
        player,
        data.emote
      );

      return;
    }

    if (data.type === "ping") {
      send(ws, {
        type: "pong",
        clientTime: data.clientTime
      });

      return;
    }
  });

  ws.on("close", () => {
    if (!player) {
      return;
    }

    const partyCode =
      player.partyCode;

    for (let i = bullets.length - 1; i >= 0; i--) {
      if (bullets[i].ownerId === player.id) {
        bullets.splice(i, 1);
      }
    }

    for (let i = walls.length - 1; i >= 0; i--) {
      if (walls[i].ownerId === player.id) {
        walls.splice(i, 1);
      }
    }

    removePlayerFromParty(player);

    players.delete(player.id);

    if (partyCode) {
      const party =
        parties.get(partyCode);

      if (party) {
        sendPartyState(party);
      }
    }
  });
});

let lastUpdate = Date.now();

setInterval(() => {
  const now = Date.now();

  const deltaMs = Math.min(
    100,
    now - lastUpdate
  );

  lastUpdate = now;

  updateBullets(deltaMs);

  broadcastStates();
}, STATE_INTERVAL);

server.listen(PORT, () => {
  console.log(
    `Pixel Royale server running on port ${PORT}`
  );
});
```
