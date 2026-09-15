const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const WORLD_SIZE = 2400;
const MAX_POSITION_DELTA = 30;
const STATE_INTERVAL = 50;

const server = http.createServer((req, res) => {
  let filePath = req.url === "/" || req.url === "/index.html"
    ? path.join(__dirname, "client.html")
    : path.join(__dirname, req.url);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const contentType =
    ext === ".html" ? "text/html; charset=utf-8" :
    ext === ".js" ? "application/javascript; charset=utf-8" :
    ext === ".css" ? "text/css; charset=utf-8" :
    "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType
  });

  fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocket.Server({ server });

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
      player.ws.readyState === WebSocket.OPEN
    ) {
      player.ws.send(JSON.stringify(data));
    }
  }
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

    // Inventario / animaciones visuales
    selectedSlot: 1,
    emote: null,
    emoteUntil: 0,
    pickaxeUntil: 0
  };

  players.set(player.id, player);

  return player;
}

function removePlayerFromParty(player) {
  if (!player.partyCode) return;

  const party = parties.get(player.partyCode);

  if (!party) {
    player.partyCode = null;
    player.ready = false;
    player.isHost = false;
    return;
  }

  party.players.delete(player.id);

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
    parties.delete(player.partyCode);
  } else {
    broadcastParty(player.partyCode, {
      type: "party",
      party: getPartyState(party)
    });
  }

  player.partyCode = null;
  player.ready = false;
  player.isHost = false;
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
      .map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        isHost: p.isHost,
        team: p.team
      }))
  };
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

  send(player.ws, {
    type: "party",
    party: getPartyState(party)
  });
}

function joinParty(player, code) {
  code = String(code || "").trim().toUpperCase();

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

  player.partyCode = code;
  player.ready = false;
  player.isHost = false;

  send(player.ws, {
    type: "party",
    party: getPartyState(party)
  });

  broadcastParty(code, {
    type: "party",
    party: getPartyState(party)
  });
}

function setReady(player, ready) {
  if (!player.partyCode) return;

  const party = parties.get(player.partyCode);

  if (!party) return;

  player.ready = !!ready;

  broadcastParty(player.partyCode, {
    type: "party",
    party: getPartyState(party)
  });
}

function startParty(player) {
  if (!player.partyCode) return;

  const party = parties.get(player.partyCode);

  if (!party) return;

  if (party.hostId !== player.id) {
    send(player.ws, {
      type: "error",
      message: "Solo el anfitrión puede iniciar"
    });
    return;
  }

  party.started = true;

  const partyPlayers = [...party.players]
    .map(id => players.get(id))
    .filter(Boolean);

  // Mantener la asignación de equipos sencilla.
  if (party.teamMode === "teams") {
    partyPlayers.forEach((p, index) => {
      p.team = index % 2;
    });
  } else {
    partyPlayers.forEach(p => {
      p.team = null;
    });
  }

  // Reiniciar jugadores al comenzar.
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

  // Limpiar objetos de esa partida.
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

  sendPartyState(party);
}

function sendPartyState(party) {
  broadcastParty(party.code, {
    type: "party",
    party: getPartyState(party)
  });

  broadcastParty(party.code, {
    type: "gameStarted",
    started: party.started
  });
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

  player.x = Math.max(0, Math.min(WORLD_SIZE, newX));
  player.y = Math.max(0, Math.min(WORLD_SIZE, newY));

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

  player.selectedSlot = 1;

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
  if (!player.alive) return;

  let remainingDamage = damage;

  if (player.shield > 0) {
    const shieldDamage = Math.min(player.shield, remainingDamage);

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
  if (!player.alive) return;

  player.hp = 0;
  player.alive = false;
  player.moving = false;

  if (attackerId && attackerId !== player.id) {
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
    attackerId: attackerId || null
  });

  checkWinner(player.partyCode);
}

function checkWinner(partyCode) {
  if (!partyCode) return;

  const party = parties.get(partyCode);

  if (!party || !party.started) return;

  const partyPlayers = [...party.players]
    .map(id => players.get(id))
    .filter(Boolean);

  const alivePlayers = partyPlayers.filter(p => p.alive);

  if (alivePlayers.length <= 1 && partyPlayers.length > 1) {
    const winner = alivePlayers[0] || null;

    broadcastParty(partyCode, {
      type: "gameEnd",
      winnerId: winner ? winner.id : null
    });
  }
}

/*
 * Comprueba si un segmento entre (x1,y1) y (x2,y2)
 * atraviesa un rectángulo.
 *
 * Esto evita que una bala rápida atraviese una pared
 * entre dos actualizaciones del servidor.
 */
function segmentIntersectsRect(x1, y1, x2, y2, rect) {
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

  const p = [-dx, dx, -dy, dy];
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
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
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

    const newX = oldX + bullet.vx * delta;
    const newY = oldY + bullet.vy * delta;

    bullet.x = newX;
    bullet.y = newY;

    bullet.life -= deltaMs;

    let removeBullet = false;

    // --------------------------------------------------
    // COLISIÓN CON CONSTRUCCIONES
    // --------------------------------------------------

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

    // --------------------------------------------------
    // COLISIÓN CON JUGADORES
    // --------------------------------------------------

    for (const player of players.values()) {
      if (!player.alive) continue;

      if (player.id === bullet.ownerId) continue;

      // Solo jugadores de la misma partida.
      if (player.partyCode !== bullet.partyCode) continue;

      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;

      const distanceSquared = dx * dx + dy * dy;

      // Hitbox aproximada del personaje.
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

    if (removeBullet || bullet.life <= 0) {
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

  x = Math.max(0, Math.min(WORLD_SIZE - width, x));
  y = Math.max(0, Math.min(WORLD_SIZE - height, y));

  const wall = {
    id: nextWallId++,

    x,
    y,

    width,
    height,

    ownerId: player.id,

    // Muy importante:
    // esta construcción solo existe dentro de esta partida.
    partyCode: player.partyCode
  };

  walls.push(wall);

  // Máximo 20 construcciones por jugador.
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

  // Animación visual del pico.
  player.pickaxeUntil = Date.now() + 350;

  const range = 75;

  for (let i = walls.length - 1; i >= 0; i--) {
    const wall = walls[i];

    // No puedes romper construcciones de otra partida.
    if (wall.partyCode !== player.partyCode) {
      continue;
    }

    const centerX = wall.x + wall.width / 2;
    const centerY = wall.y + wall.height / 2;

    const dx = centerX - player.x;
    const dy = centerY - player.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= range) {
      walls.splice(i, 1);
      break;
    }
  }
}

function pickup(player, lootId) {
  if (!player.alive) return;

  const index = loot.findIndex(
    item =>
      item.id === lootId &&
      item.partyCode === player.partyCode
  );

  if (index === -1) return;

  const item = loot[index];

  const dx = item.x - player.x;
  const dy = item.y - player.y;

  if (dx * dx + dy * dy > 80 * 80) {
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
  if (!player.alive) return;

  value = String(value || "");

  if (!EMOTES.has(value)) {
    return;
  }

  player.emote = value;

  // El emote se mantiene visible durante 2 segundos.
  player.emoteUntil = Date.now() + 2000;

  broadcastParty(player.partyCode, {
    type: "emote",
    playerId: player.id,
    emote: value
  });
}

function createState(partyCode) {
  const now = Date.now();

  const statePlayers = [];

  for (const player of players.values()) {
    if (player.partyCode !== partyCode) continue;

    if (
      player.emoteUntil &&
      player.emoteUntil < now
    ) {
      player.emote = null;
      player.emoteUntil = 0;
    }

    statePlayers.push({
      id: player.id,
      name: player.name,

      x: player.x,
      y: player.y,

      angle: player.angle,

      hp: player.hp,
      shield: player.shield,

      weapon: player.weapon,

      ammo: player.ammo,

      kills: player.kills,

      alive: player.alive,
      moving: player.moving,

      team: player.team,

      // Para que el cliente sepa qué tiene equipado.
      selectedSlot: player.selectedSlot,

      // Emote actual.
      emote: player.emote,
      emoteUntil: player.emoteUntil,

      // Animación del pico.
      pickaxeUntil: player.pickaxeUntil
    });
  }

  return {
    type: "state",

    players: statePlayers,

    // Solo se envían las balas de esta partida.
    bullets: bullets
      .filter(b => b.partyCode === partyCode)
      .map(b => ({
        id: b.id,
        ownerId: b.ownerId,
        x: b.x,
        y: b.y
      })),

    // Solo loot de esta partida.
    loot: loot
      .filter(item => item.partyCode === partyCode),

    // Solo construcciones de esta partida.
    walls: walls
      .filter(w => w.partyCode === partyCode)
      .map(w => ({
        id: w.id,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        ownerId: w.ownerId
      }))
  };
}

function broadcastStateToParty(partyCode) {
  const state = createState(partyCode);

  broadcastParty(partyCode, state);
}

function broadcastStates() {
  for (const party of parties.values()) {
    if (!party.started) continue;

    broadcastStateToParty(party.code);
  }
}

wss.on("connection", ws => {
  let player = null;

  ws.on("message", rawMessage => {
    let data;

    try {
      data = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    if (!data || typeof data.type !== "string") {
      return;
    }

    // --------------------------------------------------
    // CREAR JUGADOR
    // --------------------------------------------------

    if (data.type === "createPlayer") {
      if (player) return;

      player = createPlayer(
        ws,
        data.name
      );

      send(ws, {
        type: "player",
        player: {
          id: player.id,
          name: player.name
        }
      });

      return;
    }

    // --------------------------------------------------
    // CREATE PARTY
    // --------------------------------------------------

    if (data.type === "createParty") {
      if (!player) return;

      createParty(
        player,
        data.teamMode
      );

      return;
    }

    // --------------------------------------------------
    // JOIN PARTY
    // --------------------------------------------------

    if (data.type === "joinParty") {
      if (!player) return;

      joinParty(
        player,
        data.code
      );

      return;
    }

    // --------------------------------------------------
    // READY
    // --------------------------------------------------

    if (data.type === "ready") {
      if (!player) return;

      setReady(
        player,
        data.ready
      );

      return;
    }

    // --------------------------------------------------
    // START
    // --------------------------------------------------

    if (data.type === "start") {
      if (!player) return;

      startParty(player);

      return;
    }

    // --------------------------------------------------
    // LEAVE PARTY
    // --------------------------------------------------

    if (data.type === "leaveParty") {
      if (!player) return;

      const oldPartyCode = player.partyCode;

      removePlayerFromParty(player);

      send(ws, {
        type: "leftParty"
      });

      if (oldPartyCode) {
        const party = parties.get(oldPartyCode);

        if (party) {
          broadcastParty(oldPartyCode, {
            type: "party",
            party: getPartyState(party)
          });
        }
      }

      return;
    }

    // --------------------------------------------------
    // UPDATE
    // --------------------------------------------------

    if (data.type === "update") {
      if (!player) return;

      updatePlayer(
        player,
        data
      );

      return;
    }

    // --------------------------------------------------
    // SHOOT
    // --------------------------------------------------

    if (data.type === "shoot") {
      if (!player) return;

      shoot(player);

      return;
    }

    // --------------------------------------------------
    // RELOAD
    // --------------------------------------------------

    if (data.type === "reload") {
      if (!player) return;

      reload(player);

      return;
    }

    // --------------------------------------------------
    // SELECT SLOT
    // --------------------------------------------------

    if (data.type === "selectSlot") {
      if (!player) return;

      const slot = Number(data.slot);

      if (
        Number.isInteger(slot) &&
        slot >= 1 &&
        slot <= 4
      ) {
        player.selectedSlot = slot;
      }

      return;
    }

    // --------------------------------------------------
    // BUILD
    // --------------------------------------------------

    if (data.type === "build") {
      if (!player) return;

      if (Number.isFinite(Number(data.angle))) {
        player.angle = Number(data.angle);
      }

      build(player);

      return;
    }

    // --------------------------------------------------
    // PICKAXE
    // --------------------------------------------------

    if (data.type === "pickaxe") {
      if (!player) return;

      if (Number.isFinite(Number(data.angle))) {
        player.angle = Number(data.angle);
      }

      pickaxe(player);

      return;
    }

    // --------------------------------------------------
    // PICKUP
    // --------------------------------------------------

    if (data.type === "pickup") {
      if (!player) return;

      pickup(
        player,
        data.id
      );

      return;
    }

    // --------------------------------------------------
    // CHAT
    // --------------------------------------------------

    if (data.type === "chat") {
      if (!player) return;

      const message = String(
        data.message || ""
      )
        .trim()
        .substring(0, 200);

      if (!message) return;

      broadcastParty(player.partyCode, {
        type: "chat",
        playerId: player.id,
        name: player.name,
        message
      });

      return;
    }

    // --------------------------------------------------
    // EMOTE
    // --------------------------------------------------

    if (data.type === "emote") {
      if (!player) return;

      emote(
        player,
        data.emote
      );

      return;
    }

    // --------------------------------------------------
    // PING
    // --------------------------------------------------

    if (data.type === "ping") {
      send(ws, {
        type: "pong"
      });

      return;
    }
  });

  ws.on("close", () => {
    if (!player) return;

    const partyCode = player.partyCode;

    // Eliminar balas del jugador.
    for (let i = bullets.length - 1; i >= 0; i--) {
      if (bullets[i].ownerId === player.id) {
        bullets.splice(i, 1);
      }
    }

    // Eliminar construcciones del jugador.
    for (let i = walls.length - 1; i >= 0; i--) {
      if (walls[i].ownerId === player.id) {
        walls.splice(i, 1);
      }
    }

    removePlayerFromParty(player);

    players.delete(player.id);

    if (partyCode) {
      const party = parties.get(partyCode);

      if (party) {
        broadcastParty(partyCode, {
          type: "party",
          party: getPartyState(party)
        });
      }
    }
  });
});

// --------------------------------------------------
// GAME LOOP
// --------------------------------------------------

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
  console.log(`Pixel Royale server running on port ${PORT}`);
});
