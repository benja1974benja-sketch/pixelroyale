const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const WORLD = 2400;
const TICK = 50;

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/client.html") {
    const file = path.join(__dirname, "client.html");

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("No se pudo cargar Pixel Royale 2.0");
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache"
      });

      res.end(data);
    });

    return;
  }

  res.writeHead(404);
  res.end("404");
});

const wss = new WebSocket.Server({ server });

const players = new Map();
const parties = new Map();

let trees = [];
let loot = [];
let walls = [];
let bullets = [];

let phase = "lobby";
let countdown = 0;
let storm = {
  x: WORLD / 2,
  y: WORLD / 2,
  radius: WORLD * 0.62
};

let nextId = 1;
let nextObjectId = 1;

const WEAPONS = {
  pistol: {
    damage: 22,
    cooldown: 330,
    speed: 15,
    range: 850,
    ammo: 12,
    maxAmmo: 12
  },
  rifle: {
    damage: 13,
    cooldown: 120,
    speed: 18,
    range: 1000,
    ammo: 30,
    maxAmmo: 30
  },
  shotgun: {
    damage: 9,
    cooldown: 700,
    speed: 13,
    range: 500,
    ammo: 5,
    maxAmmo: 5
  }
};

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(random(min, max + 1));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cleanName(name) {
  return String(name || "Jugador")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16) || "Jugador";
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const text = JSON.stringify(data);

  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(text);
    }
  }
}

function generatePartyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = "";

    for (let i = 0; i < 5; i++) {
      code += chars[randomInt(0, chars.length - 1)];
    }
  } while (parties.has(code));

  return code;
}

function createParty(player) {
  if (player.partyCode) {
    leaveParty(player);
  }

  const code = generatePartyCode();

  const party = {
    code,
    leaderId: player.id,
    maxSize: player.teamMode || 4,
    members: new Set([player.id])
  };

  parties.set(code, party);
  player.partyCode = code;

  broadcastLobby();

  return party;
}

function leaveParty(player) {
  if (!player.partyCode) return;

  const party = parties.get(player.partyCode);

  if (!party) {
    player.partyCode = null;
    return;
  }

  party.members.delete(player.id);
  player.partyCode = null;

  if (party.leaderId === player.id) {
    const next = [...party.members][0];

    if (next) {
      party.leaderId = next;
    } else {
      parties.delete(party.code);
    }
  }

  broadcastLobby();
}

function joinParty(player, code) {
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const party = parties.get(code);

  if (!party) {
    return { ok: false, error: "No existe ese código." };
  }

  if (phase !== "lobby") {
    return { ok: false, error: "La partida ya ha comenzado." };
  }

  if (party.members.size >= party.maxSize) {
    return { ok: false, error: "El equipo está lleno." };
  }

  if (player.partyCode) {
    leaveParty(player);
  }

  party.members.add(player.id);
  player.partyCode = party.code;
  player.teamMode = party.maxSize;

  broadcastLobby();

  return { ok: true, party };
}

function getPartyMembers(player) {
  if (!player.partyCode) return [];

  const party = parties.get(player.partyCode);

  if (!party) return [];

  return [...party.members]
    .map(id => players.get(id))
    .filter(Boolean);
}

function broadcastLobby() {
  const lobbyPlayers = [...players.values()].map(p => ({
    id: p.id,
    name: p.name,
    partyCode: p.partyCode,
    teamMode: p.teamMode,
    ready: p.ready
  }));

  const partyList = [...parties.values()].map(party => ({
    code: party.code,
    leaderId: party.leaderId,
    maxSize: party.maxSize,
    members: [...party.members].map(id => {
      const p = players.get(id);
      return p
        ? {
            id: p.id,
            name: p.name,
            ready: p.ready
          }
        : null;
    }).filter(Boolean)
  }));

  broadcast({
    type: "lobby",
    players: lobbyPlayers,
    parties: partyList
  });
}

function resetWorld() {
  trees = [];
  loot = [];
  walls = [];
  bullets = [];

  storm = {
    x: WORLD / 2,
    y: WORLD / 2,
    radius: WORLD * 0.62
  };

  for (let i = 0; i < 70; i++) {
    trees.push({
      id: nextObjectId++,
      x: random(70, WORLD - 70),
      y: random(70, WORLD - 70),
      hp: 100
    });
  }

  const lootTypes = [
    "ammo",
    "ammo",
    "ammo",
    "shield",
    "shield",
    "heal",
    "rifle",
    "shotgun"
  ];

  for (let i = 0; i < 70; i++) {
    loot.push({
      id: nextObjectId++,
      x: random(80, WORLD - 80),
      y: random(80, WORLD - 80),
      type: lootTypes[randomInt(0, lootTypes.length - 1)]
    });
  }
}

function resetPlayer(p) {
  p.x = random(300, WORLD - 300);
  p.y = random(300, WORLD - 300);

  p.health = 100;
  p.shield = 0;

  p.materials = 30;

  p.weapon = "pistol";
  p.ammo = WEAPONS.pistol.ammo;
  p.maxAmmo = WEAPONS.pistol.maxAmmo;

  p.kills = 0;
  p.xp = 0;
  p.coins = 0;

  p.alive = true;
  p.angle = 0;
  p.emote = null;

  p.lastShot = 0;
  p.lastBuild = 0;
  p.lastPickup = 0;
  p.lastTreeHit = 0;

  p.ready = false;
}

function startMatch() {
  if (phase !== "lobby") return;

  const activePlayers = [...players.values()];

  if (activePlayers.length < 1) return;

  phase = "countdown";
  countdown = 5;

  resetWorld();

  for (const p of activePlayers) {
    resetPlayer(p);
  }

  assignTeams();

  broadcastLobby();

  broadcast({
    type: "matchStarting",
    seconds: countdown
  });

  const interval = setInterval(() => {
    countdown--;

    broadcast({
      type: "countdown",
      seconds: countdown
    });

    if (countdown <= 0) {
      clearInterval(interval);

      phase = "playing";

      broadcast({
        type: "matchStart",
        world: WORLD,
        storm
      });
    }
  }, 1000);
}

function assignTeams() {
  const used = new Set();
  let nextTeam = 1;

  for (const party of parties.values()) {
    const members = [...party.members]
      .map(id => players.get(id))
      .filter(Boolean);

    if (!members.length) continue;

    for (const p of members) {
      p.team = nextTeam;
      used.add(p.id);
    }

    nextTeam++;
  }

  const solo = [...players.values()].filter(p => !used.has(p.id));

  for (let i = 0; i < solo.length; i++) {
    const p = solo[i];

    p.team = nextTeam;

    if (p.teamMode > 1) {
      const group = solo
        .slice(i + 1)
        .filter(x => !used.has(x.id))
        .slice(0, p.teamMode - 1);

      for (const mate of group) {
        mate.team = nextTeam;
        used.add(mate.id);
      }
    }

    used.add(p.id);
    nextTeam++;
  }
}

function playerState(p) {
  return {
    id: p.id,
    name: p.name,
    x: Math.round(p.x),
    y: Math.round(p.y),
    angle: p.angle,
    health: p.health,
    shield: p.shield,
    materials: p.materials,
    weapon: p.weapon,
    ammo: p.ammo,
    maxAmmo: p.maxAmmo,
    kills: p.kills,
    xp: p.xp,
    coins: p.coins,
    alive: p.alive,
    team: p.team,
    emote: p.emote
  };
}

function broadcastState() {
  broadcast({
    type: "state",
    phase,
    players: [...players.values()].map(playerState),
    trees,
    loot,
    walls,
    storm
  });
}

function damagePlayer(target, amount, attacker = null) {
  if (!target.alive) return;

  if (
    attacker &&
    attacker !== target &&
    attacker.team &&
    target.team &&
    attacker.team === target.team
  ) {
    return;
  }

  let damage = amount;

  if (target.shield > 0) {
    const shieldDamage = Math.min(target.shield, damage);

    target.shield -= shieldDamage;
    damage -= shieldDamage;
  }

  target.health -= damage;

  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;

    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.xp += 100;
      attacker.coins += 25;
    }

    broadcast({
      type: "elimination",
      id: target.id,
      killer: attacker ? attacker.id : null
    });

    checkVictory();
  }
}

function checkVictory() {
  if (phase !== "playing") return;

  const aliveTeams = new Set();

  for (const p of players.values()) {
    if (p.alive) {
      aliveTeams.add(p.team);
    }
  }

  if (aliveTeams.size <= 1) {
    const winningTeam = [...aliveTeams][0] || null;

    endMatch(winningTeam);
  }
}

function endMatch(winningTeam) {
  if (phase !== "playing") return;

  phase = "ended";

  const results = [];

  for (const p of players.values()) {
    const victory = p.team === winningTeam && winningTeam !== null;

    if (victory) {
      p.xp += 250;
      p.coins += 100;
    }

    results.push({
      id: p.id,
      name: p.name,
      team: p.team,
      kills: p.kills,
      xp: p.xp,
      coins: p.coins,
      victory
    });
  }

  broadcast({
    type: "matchEnd",
    winningTeam,
    results
  });
}

function handleShoot(p) {
  if (phase !== "playing" || !p.alive) return;

  const weapon = WEAPONS[p.weapon] || WEAPONS.pistol;
  const now = Date.now();

  if (now - p.lastShot < weapon.cooldown) return;
  if (p.ammo <= 0) return;

  p.lastShot = now;
  p.ammo--;

  let shots = 1;

  if (p.weapon === "shotgun") {
    shots = 6;
  }

  for (let i = 0; i < shots; i++) {
    let angle = p.angle;

    if (p.weapon === "shotgun") {
      angle += random(-0.17, 0.17);
    } else if (p.weapon === "rifle") {
      angle += random(-0.025, 0.025);
    }

    bullets.push({
      id: nextObjectId++,
      owner: p.id,
      team: p.team,
      x: p.x + Math.cos(angle) * 20,
      y: p.y + Math.sin(angle) * 20,
      vx: Math.cos(angle) * weapon.speed,
      vy: Math.sin(angle) * weapon.speed,
      damage: weapon.damage,
      life: Math.ceil(weapon.range / weapon.speed)
    });
  }
}

function handleReload(p) {
  if (!p.alive) return;

  const weapon = WEAPONS[p.weapon] || WEAPONS.pistol;

  p.ammo = weapon.maxAmmo;
  p.maxAmmo = weapon.maxAmmo;
}

function handleBuild(p, data) {
  if (phase !== "playing" || !p.alive) return;

  const now = Date.now();

  if (now - p.lastBuild < 250) return;
  if (p.materials < 10) return;

  const x = Number(data.x);
  const y = Number(data.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  if (Math.hypot(x - p.x, y - p.y) > 130) return;

  p.lastBuild = now;
  p.materials -= 10;

  walls.push({
    id: nextObjectId++,
    x: Math.max(20, Math.min(WORLD - 60, x)),
    y: Math.max(20, Math.min(WORLD - 60, y)),
    width: 60,
    height: 60,
    hp: 150,
    team: p.team,
    kind: ["wall", "ramp", "floor", "roof"].includes(data.kind)
      ? data.kind
      : "wall"
  });
}

function handleTreeHit(p, data) {
  if (phase !== "playing" || !p.alive) return;

  const now = Date.now();

  if (now - p.lastTreeHit < 300) return;

  const tree = trees.find(t => t.id === Number(data.treeId));

  if (!tree) return;

  if (distance(p, tree) > 70) return;

  p.lastTreeHit = now;

  tree.hp -= 35;
  p.materials += 4;

  if (tree.hp <= 0) {
    const index = trees.findIndex(t => t.id === tree.id);

    if (index >= 0) {
      trees.splice(index, 1);
    }

    p.materials += 12;
    p.xp += 10;
  }
}

function handlePickup(p, data) {
  if (phase !== "playing" || !p.alive) return;

  const now = Date.now();

  if (now - p.lastPickup < 150) return;

  const item = loot.find(x => x.id === Number(data.lootId));

  if (!item) return;

  if (distance(p, item) > 80) return;

  p.lastPickup = now;

  if (item.type === "ammo") {
    p.ammo = p.maxAmmo;
  }

  if (item.type === "shield") {
    p.shield = Math.min(100, p.shield + 50);
  }

  if (item.type === "heal") {
    p.health = Math.min(100, p.health + 40);
  }

  if (item.type === "rifle") {
    p.weapon = "rifle";
    p.ammo = WEAPONS.rifle.maxAmmo;
    p.maxAmmo = WEAPONS.rifle.maxAmmo;
  }

  if (item.type === "shotgun") {
    p.weapon = "shotgun";
    p.ammo = WEAPONS.shotgun.maxAmmo;
    p.maxAmmo = WEAPONS.shotgun.maxAmmo;
  }

  const index = loot.findIndex(x => x.id === item.id);

  if (index >= 0) {
    loot.splice(index, 1);
  }
}

function updatePlayer(p, data) {
  if (phase !== "playing" || !p.alive) return;

  const x = Number(data.x);
  const y = Number(data.y);
  const angle = Number(data.angle);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const maxMove = 30;

  const dx = x - p.x;
  const dy = y - p.y;
  const d = Math.hypot(dx, dy);

  if (d <= maxMove) {
    p.x = Math.max(20, Math.min(WORLD - 20, x));
    p.y = Math.max(20, Math.min(WORLD - 20, y));
  }

  if (Number.isFinite(angle)) {
    p.angle = angle;
  }

  if (typeof data.emote === "string") {
    p.emote = data.emote.slice(0, 12);
  }
}

function processBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    let remove = false;

    if (
      b.x < 0 ||
      b.y < 0 ||
      b.x > WORLD ||
      b.y > WORLD ||
      b.life <= 0
    ) {
      remove = true;
    }

    if (!remove) {
      for (const wall of walls) {
        if (
          b.x > wall.x &&
          b.x < wall.x + wall.width &&
          b.y > wall.y &&
          b.y < wall.y + wall.height
        ) {
          wall.hp -= b.damage;

          if (wall.hp <= 0) {
            const wi = walls.findIndex(w => w.id === wall.id);

            if (wi >= 0) walls.splice(wi, 1);
          }

          remove = true;
          break;
        }
      }
    }

    if (!remove) {
      for (const target of players.values()) {
        if (!target.alive) continue;
        if (target.id === b.owner) continue;
        if (target.team === b.team) continue;

        if (Math.hypot(target.x - b.x, target.y - b.y) < 22) {
          const attacker = players.get(b.owner);

          damagePlayer(target, b.damage, attacker);

          remove = true;
          break;
        }
      }
    }

    if (remove) {
      bullets.splice(i, 1);
    }
  }
}

function processStorm() {
  if (phase !== "playing") return;

  storm.radius = Math.max(170, storm.radius - 0.10);

  for (const p of players.values()) {
    if (!p.alive) continue;

    const d = Math.hypot(
      p.x - storm.x,
      p.y - storm.y
    );

    if (d > storm.radius) {
      damagePlayer(p, 1.2, null);
    }
  }
}

function partyCanStart(p) {
  if (!p.partyCode) return true;

  const party = parties.get(p.partyCode);

  if (!party) return true;

  if (party.leaderId !== p.id) return false;

  const members = getPartyMembers(p);

  if (members.some(member => !member.ready)) {
    return false;
  }

  return true;
}

wss.on("connection", ws => {
  const id = String(nextId++);

  const player = {
    id,
    ws,
    name: "Jugador",
    team: 1,
    teamMode: 4,
    partyCode: null,
    ready: false,
    alive: false,
    x: WORLD / 2,
    y: WORLD / 2,
    health: 100,
    shield: 0,
    materials: 30,
    weapon: "pistol",
    ammo: 12,
    maxAmmo: 12,
    kills: 0,
    xp: 0,
    coins: 0,
    angle: 0,
    emote: null,
    lastShot: 0,
    lastBuild: 0,
    lastPickup: 0,
    lastTreeHit: 0
  };

  players.set(id, player);

  send(ws, {
    type: "welcome",
    id,
    world: WORLD,
    phase
  });

  broadcastLobby();

  ws.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!data || typeof data.type !== "string") return;

    switch (data.type) {
      case "join":
        player.name = cleanName(data.name);
        player.teamMode = Math.max(
          1,
          Math.min(4, Number(data.teamMode) || 4)
        );

        send(ws, {
          type: "joined",
          player: playerState(player)
        });

        broadcastLobby();
        break;

      case "createParty": {
        if (phase !== "lobby") return;

        player.teamMode = Math.max(
          2,
          Math.min(4, Number(data.size) || 4)
        );

        player.ready = false;

        const party = createParty(player);

        send(ws, {
          type: "partyCreated",
          code: party.code,
          maxSize: party.maxSize
        });

        break;
      }

      case "joinParty": {
        const result = joinParty(player, data.code);

        send(ws, {
          type: "partyResult",
          ok: result.ok,
          error: result.error || null
        });

        break;
      }

      case "leaveParty":
        if (phase === "lobby") {
          leaveParty(player);
          player.ready = false;
          broadcastLobby();
        }
        break;

      case "ready":
        if (phase !== "lobby") return;

        player.ready = !player.ready;

        broadcastLobby();
        break;

      case "startMatch":
        if (phase !== "lobby") return;

        if (!partyCanStart(player)) {
          send(ws, {
            type: "error",
            message: "Solo el líder puede iniciar y todos deben estar listos."
          });

          return;
        }

        startMatch();
        break;

      case "update":
        updatePlayer(player, data);
        break;

      case "shoot":
        handleShoot(player);
        break;

      case "reload":
        handleReload(player);
        break;

      case "build":
        handleBuild(player, data);
        break;

      case "treeHit":
        handleTreeHit(player, data);
        break;

      case "pickup":
        handlePickup(player, data);
        break;

      case "emote":
        if (player.alive) {
          player.emote = String(data.emote || "").slice(0, 12);
        }
        break;

      case "chat": {
        const message = String(data.message || "")
          .replace(/[<>]/g, "")
          .trim()
          .slice(0, 100);

        if (!message) return;

        broadcast({
          type: "chat",
          name: player.name,
          message
        });

        break;
      }

      case "playAgain":
        if (phase === "ended") {
          for (const p of players.values()) {
            p.ready = false;
          }

          phase = "lobby";

          broadcastLobby();
        }

        break;
    }
  });

  ws.on("close", () => {
    leaveParty(player);
    players.delete(id);

    if (players.size === 0) {
      phase = "lobby";
      bullets = [];
      walls = [];
    }

    broadcastLobby();
  });
});

setInterval(() => {
  if (phase === "playing") {
    processBullets();
    processStorm();
  }

  broadcastState();
}, TICK);

server.listen(PORT, () => {
  console.log("");
  console.log("======================================");
  console.log("       PIXEL ROYALE 2.0");
  console.log("======================================");
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log("PC + móvil compatibles");
  console.log("======================================");
  console.log("");
});
