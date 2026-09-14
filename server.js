'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3000);
const WORLD = 2400;
const TICK_RATE = 20;
const MAX_PLAYERS = 64;

const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/' || url === '/index.html') {
        const file = path.join(__dirname, 'client.html');

        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Error cargando PixelRoyale');
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache'
            });

            res.end(data);
        });

        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

const wss = new WebSocket.Server({
    server,
    maxPayload: 16 * 1024
});

const players = new Map();
const walls = [];
const trees = [];
const loot = [];

let nextPlayerId = 1;
let nextWallId = 1;
let nextTreeId = 1;
let nextLootId = 1;

let phase = 'lobby';
let teamMode = 1;
let matchStartedAt = 0;
let countdown = 10;
let countdownTimer = null;

const storm = {
    cx: WORLD / 2,
    cy: WORLD / 2,
    radius: 1500,
    target: 1500,
    phase: 0
};

const WEAPONS = {
    pistol: {
        name: 'Pistola',
        damage: 24,
        fireRate: 260,
        magazine: 12,
        reload: 900,
        range: 720
    },
    smg: {
        name: 'Subfusil',
        damage: 14,
        fireRate: 90,
        magazine: 30,
        reload: 1200,
        range: 620
    },
    shotgun: {
        name: 'Escopeta',
        damage: 11,
        pellets: 7,
        fireRate: 650,
        magazine: 6,
        reload: 1400,
        range: 420
    },
    rifle: {
        name: 'Rifle',
        damage: 31,
        fireRate: 170,
        magazine: 20,
        reload: 1100,
        range: 900
    },
    sniper: {
        name: 'Francotirador',
        damage: 90,
        fireRate: 1000,
        magazine: 5,
        reload: 1700,
        range: 1400
    }
};

const BUILD_TYPES = {
    wall: {
        w: 44,
        h: 44,
        health: 160
    },
    ramp: {
        w: 52,
        h: 40,
        health: 120
    },
    floor: {
        w: 52,
        h: 52,
        health: 100
    },
    roof: {
        w: 52,
        h: 52,
        health: 100
    }
};

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function validNumber(v) {
    return Number.isFinite(v);
}

function safeName(value, fallback) {
    return String(value || fallback)
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, 16) || fallback;
}

function publicPlayer(p) {
    return {
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        health: p.health,
        shield: p.shield,
        materials: p.materials,
        color: p.color,
        name: p.name,
        emote: p.emote,
        alive: p.alive,
        kills: p.kills,
        xp: p.xp,
        coins: p.coins,
        team: p.team,
        slot: p.slot,
        weapon: p.weapon,
        ammo: p.ammo,
        maxAmmo: p.maxAmmo,
        reloading: p.reloading
    };
}

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(data, exceptId = null) {
    const msg = JSON.stringify(data);

    for (const [id, p] of players) {
        if (
            id !== exceptId &&
            p.ws.readyState === WebSocket.OPEN
        ) {
            p.ws.send(msg);
        }
    }
}

function broadcastAll(data) {
    const msg = JSON.stringify(data);

    for (const p of players.values()) {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(msg);
        }
    }
}

function randomColor() {
    return `hsl(${Math.floor(Math.random() * 360)}, 75%, 58%)`;
}

function randomSpawn() {
    return {
        x: 250 + Math.random() * (WORLD - 500),
        y: 250 + Math.random() * (WORLD - 500)
    };
}

function resetWorld() {
    walls.length = 0;
    trees.length = 0;
    loot.length = 0;

    nextWallId = 1;
    nextTreeId = 1;
    nextLootId = 1;

    for (let i = 0; i < 65; i++) {
        trees.push({
            id: nextTreeId++,
            x: 80 + Math.random() * (WORLD - 160),
            y: 80 + Math.random() * (WORLD - 160),
            radius: 18,
            health: 80,
            maxHealth: 80
        });
    }

    const lootTypes = [
        'shield',
        'medkit',
        'ammo',
        'materials',
        'smg',
        'shotgun',
        'rifle',
        'sniper'
    ];

    for (let i = 0; i < 75; i++) {
        const type = lootTypes[Math.floor(Math.random() * lootTypes.length)];

        loot.push({
            id: nextLootId++,
            x: 70 + Math.random() * (WORLD - 140),
            y: 70 + Math.random() * (WORLD - 140),
            type
        });
    }

    storm.cx = WORLD / 2;
    storm.cy = WORLD / 2;
    storm.radius = 1500;
    storm.target = 1500;
    storm.phase = 0;
}

function assignTeams() {
    const list = [...players.values()];

    if (teamMode <= 1) {
        list.forEach((p, index) => {
            p.team = index + 1;
        });
        return;
    }

    const teamCount = Math.max(1, Math.ceil(list.length / teamMode));

    list.forEach((p, index) => {
        p.team = (index % teamCount) + 1;
    });
}

function aliveTeams() {
    const set = new Set();

    for (const p of players.values()) {
        if (p.alive) {
            set.add(p.team);
        }
    }

    return set;
}

function alivePlayers() {
    return [...players.values()].filter(p => p.alive);
}

function startCountdown() {
    if (phase !== 'lobby') return;
    if (players.size < 1) return;

    phase = 'countdown';
    countdown = 10;

    broadcastAll({
        type: 'countdown',
        value: countdown
    });

    clearInterval(countdownTimer);

    countdownTimer = setInterval(() => {
        countdown--;

        if (countdown <= 0) {
            clearInterval(countdownTimer);
            startMatch();
            return;
        }

        broadcastAll({
            type: 'countdown',
            value: countdown
        });
    }, 1000);
}

function startMatch() {
    resetWorld();
    assignTeams();

    phase = 'playing';
    matchStartedAt = Date.now();

    for (const p of players.values()) {
        const spawn = randomSpawn();

        p.x = spawn.x;
        p.y = spawn.y;
        p.health = 100;
        p.shield = 0;
        p.materials = 30;
        p.alive = true;
        p.kills = 0;
        p.xp = 0;
        p.weapon = 'pistol';
        p.ammo = WEAPONS.pistol.magazine;
        p.maxAmmo = WEAPONS.pistol.magazine;
        p.slot = 2;
        p.reloading = false;
        p.lastShot = 0;
        p.lastSwing = 0;
        p.emote = null;
    }

    broadcastAll({
        type: 'matchStart',
        players: [...players.values()].map(publicPlayer),
        trees,
        walls,
        loot,
        storm
    });
}

function endMatch() {
    if (phase !== 'playing') return;

    phase = 'gameover';

    const teams = aliveTeams();
    const winnerTeam = teams.size === 1 ? [...teams][0] : null;

    const rewards = [];

    for (const p of players.values()) {
        const won = winnerTeam !== null && p.team === winnerTeam;

        const xp = won
            ? 500 + p.kills * 100
            : 100 + p.kills * 50;

        const coins = won
            ? 250 + p.kills * 50
            : 50 + p.kills * 25;

        p.xp += xp;
        p.coins += coins;

        rewards.push({
            id: p.id,
            xp,
            coins,
            kills: p.kills
        });
    }

    broadcastAll({
        type: 'matchEnd',
        winnerTeam,
        rewards
    });

    setTimeout(() => {
        if (players.size > 0) {
            phase = 'lobby';

            for (const p of players.values()) {
                p.alive = true;
                p.health = 100;
                p.shield = 0;
            }

            broadcastAll({
                type: 'lobby',
                players: [...players.values()].map(publicPlayer)
            });

            if (players.size >= 1) {
                setTimeout(startCountdown, 1500);
            }
        } else {
            phase = 'lobby';
        }
    }, 5000);
}

function insideWorld(x, y, radius = 20) {
    return (
        x >= radius &&
        y >= radius &&
        x <= WORLD - radius &&
        y <= WORLD - radius
    );
}

function collidesWithWall(x, y, radius = 16) {
    for (const w of walls) {
        const cx = clamp(x, w.x, w.x + w.w);
        const cy = clamp(y, w.y, w.y + w.h);

        if (Math.hypot(x - cx, y - cy) < radius) {
            return true;
        }
    }

    return false;
}

function canMoveTo(p, x, y) {
    if (!insideWorld(x, y, 18)) return false;
    if (collidesWithWall(x, y, 18)) return false;

    for (const other of players.values()) {
        if (
            other.id !== p.id &&
            other.alive &&
            Math.hypot(x - other.x, y - other.y) < 28
        ) {
            return false;
        }
    }

    return true;
}

function hasLineOfSight(a, b) {
    const steps = Math.ceil(distance(a, b) / 12);

    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;

        for (const w of walls) {
            if (
                x >= w.x &&
                x <= w.x + w.w &&
                y >= w.y &&
                y <= w.y + w.h
            ) {
                return false;
            }
        }
    }

    return true;
}

function damagePlayer(attacker, target, amount) {
    if (!target.alive) return;

    let damage = clamp(amount, 0, 100);

    if (target.shield > 0) {
        const absorbed = Math.min(target.shield, damage);
        target.shield -= absorbed;
        damage -= absorbed;
    }

    target.health -= damage;

    if (target.health <= 0) {
        target.health = 0;
        target.alive = false;

        attacker.kills++;
        attacker.materials += 15;
        attacker.xp += 100;

        broadcastAll({
            type: 'playerDied',
            id: target.id,
            killerId: attacker.id
        });

        checkMatchEnd();
        return;
    }

    broadcastAll({
        type: 'playerDamaged',
        id: target.id,
        health: target.health,
        shield: target.shield
    });
}

function checkMatchEnd() {
    const teams = aliveTeams();

    if (teams.size <= 1) {
        endMatch();
    }
}

function performShot(p) {
    if (phase !== 'playing' || !p.alive) return;

    const weapon = WEAPONS[p.weapon] || WEAPONS.pistol;
    const now = Date.now();

    if (p.reloading) return;

    if (now - p.lastShot < weapon.fireRate) return;

    if (p.ammo <= 0) {
        startReload(p);
        return;
    }

    p.lastShot = now;
    p.ammo--;

    const pellets = weapon.pellets || 1;

    broadcast({
        type: 'shoot',
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        weapon: p.weapon
    }, p.id);

    for (let pellet = 0; pellet < pellets; pellet++) {
        let angle = p.angle;

        if (pellets > 1) {
            angle += (Math.random() - 0.5) * 0.34;
        }

        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        let bestTarget = null;
        let bestDistance = weapon.range;

        for (const target of players.values()) {
            if (
                !target.alive ||
                target.id === p.id ||
                target.team === p.team
            ) {
                continue;
            }

            const vx = target.x - p.x;
            const vy = target.y - p.y;
            const d = Math.hypot(vx, vy);

            if (d > weapon.range) continue;

            const dot = (vx * dx + vy * dy) / Math.max(d, 0.001);

            if (dot < 0.985) continue;

            if (!hasLineOfSight(p, target)) continue;

            if (d < bestDistance) {
                bestDistance = d;
                bestTarget = target;
            }
        }

        if (bestTarget) {
            damagePlayer(p, bestTarget, weapon.damage);
        }
    }

    if (p.ammo <= 0) {
        startReload(p);
    }

    send(p.ws, {
        type: 'ammo',
        ammo: p.ammo,
        maxAmmo: p.maxAmmo
    });
}

function startReload(p) {
    if (
        p.reloading ||
        p.ammo >= p.maxAmmo ||
        !p.alive
    ) {
        return;
    }

    const weapon = WEAPONS[p.weapon];

    p.reloading = true;

    send(p.ws, {
        type: 'reloadStart',
        duration: weapon.reload
    });

    setTimeout(() => {
        if (!players.has(p.id)) return;

        p.reloading = false;

        if (p.alive) {
            p.ammo = p.maxAmmo;

            send(p.ws, {
                type: 'reloaded',
                ammo: p.ammo,
                maxAmmo: p.maxAmmo
            });
        }
    }, weapon.reload);
}

function build(p, data) {
    if (phase !== 'playing' || !p.alive) return;
    if (p.materials < 10) return;

    const kind = BUILD_TYPES[data.kind] ? data.kind : 'wall';
    const spec = BUILD_TYPES[kind];

    let x = Number(data.x);
    let y = Number(data.y);

    if (!validNumber(x) || !validNumber(y)) return;

    x = clamp(x, 0, WORLD - spec.w);
    y = clamp(y, 0, WORLD - spec.h);

    const center = {
        x: x + spec.w / 2,
        y: y + spec.h / 2
    };

    if (distance(p, center) > 100) return;

    for (const w of walls) {
        if (
            x < w.x + w.w &&
            x + spec.w > w.x &&
            y < w.y + w.h &&
            y + spec.h > w.y
        ) {
            return;
        }
    }

    p.materials -= 10;

    const wall = {
        id: nextWallId++,
        x,
        y,
        w: spec.w,
        h: spec.h,
        health: spec.health,
        maxHealth: spec.health,
        ownerId: p.id,
        kind
    };

    walls.push(wall);

    broadcastAll({
        type: 'wallBuilt',
        wall,
        playerId: p.id,
        materials: p.materials
    });
}

function hitWall(p, data) {
    if (phase !== 'playing' || !p.alive) return;

    const wall = walls.find(w => w.id === Number(data.wallId));

    if (!wall) return;

    const center = {
        x: wall.x + wall.w / 2,
        y: wall.y + wall.h / 2
    };

    if (distance(p, center) > 80) return;

    const damage = p.slot === 1 ? 30 : 20;

    wall.health -= damage;

    if (wall.health <= 0) {
        const index = walls.indexOf(wall);

        if (index !== -1) {
            walls.splice(index, 1);
        }

        broadcastAll({
            type: 'wallDestroyed',
            wallId: wall.id
        });

        return;
    }

    broadcastAll({
        type: 'wallDamaged',
        wallId: wall.id,
        health: wall.health
    });
}

function hitTree(p, data) {
    if (
        phase !== 'playing' ||
        !p.alive ||
        p.slot !== 1
    ) {
        return;
    }

    const tree = trees.find(t => t.id === Number(data.treeId));

    if (!tree) return;

    if (distance(p, tree) > 65) return;

    const now = Date.now();

    if (now - p.lastSwing < 350) return;

    p.lastSwing = now;

    tree.health -= 25;

    if (tree.health <= 0) {
        const index = trees.indexOf(tree);

        if (index !== -1) {
            trees.splice(index, 1);
        }

        const gained = 20 + Math.floor(Math.random() * 16);

        p.materials += gained;

        broadcastAll({
            type: 'treeDestroyed',
            treeId: tree.id,
            playerId: p.id,
            materials: p.materials
        });

        return;
    }

    broadcastAll({
        type: 'treeDamaged',
        treeId: tree.id,
        health: tree.health,
        playerId: p.id
    });
}

function pickup(p, data) {
    if (phase !== 'playing' || !p.alive) return;

    const item = loot.find(l => l.id === Number(data.lootId));

    if (!item) return;

    if (distance(p, item) > 80) return;

    const index = loot.indexOf(item);

    if (index !== -1) {
        loot.splice(index, 1);
    }

    if (item.type === 'shield') {
        p.shield = Math.min(100, p.shield + 50);
    } else if (item.type === 'medkit') {
        p.health = Math.min(100, p.health + 50);
    } else if (item.type === 'ammo') {
        p.ammo = p.maxAmmo;
    } else if (item.type === 'materials') {
        p.materials += 40;
    } else if (WEAPONS[item.type]) {
        p.weapon = item.type;
        p.maxAmmo = WEAPONS[item.type].magazine;
        p.ammo = p.maxAmmo;
        p.reloading = false;
    }

    broadcastAll({
        type: 'lootPicked',
        lootId: item.id,
        playerId: p.id,
        item,
        player: publicPlayer(p)
    });
}

function applyStormDamage() {
    if (phase !== 'playing') return;

    for (const p of players.values()) {
        if (!p.alive) continue;

        const d = Math.hypot(
            p.x - storm.cx,
            p.y - storm.cy
        );

        if (d > storm.radius) {
            damagePlayer(p, p, 0);
            p.health -= 4;

            if (p.health <= 0) {
                p.health = 0;
                p.alive = false;

                broadcastAll({
                    type: 'playerDied',
                    id: p.id,
                    killerId: null,
                    storm: true
                });
            }
        }
    }

    checkMatchEnd();
}

function advanceStorm() {
    if (phase !== 'playing') return;

    const elapsed = (Date.now() - matchStartedAt) / 1000;

    const phaseNumber = Math.min(
        6,
        Math.floor(elapsed / 35)
    );

    if (phaseNumber !== storm.phase) {
        storm.phase = phaseNumber;

        const newRadius = Math.max(
            180,
            1500 - phaseNumber * 210
        );

        storm.target = newRadius;

        storm.cx =
            WORLD / 2 +
            (Math.random() - 0.5) * 350;

        storm.cy =
            WORLD / 2 +
            (Math.random() - 0.5) * 350;

        storm.cx = clamp(storm.cx, 300, WORLD - 300);
        storm.cy = clamp(storm.cy, 300, WORLD - 300);

        broadcastAll({
            type: 'stormUpdate',
            storm
        });
    }

    storm.radius +=
        (storm.target - storm.radius) * 0.015;

    broadcastAll({
        type: 'stormTick',
        storm
    });
}

wss.on('connection', ws => {
    if (players.size >= MAX_PLAYERS) {
        send(ws, {
            type: 'error',
            message: 'Servidor lleno.'
        });

        ws.close();
        return;
    }

    const id = nextPlayerId++;
    const spawn = randomSpawn();

    const player = {
        id,
        ws,

        x: spawn.x,
        y: spawn.y,
        angle: 0,

        health: 100,
        shield: 0,

        materials: 30,

        color: randomColor(),
        name: `Jugador ${id}`,

        emote: null,
        alive: true,

        kills: 0,
        xp: 0,
        coins: 0,

        team: 1,

        slot: 2,
        weapon: 'pistol',

        ammo: WEAPONS.pistol.magazine,
        maxAmmo: WEAPONS.pistol.magazine,

        reloading: false,

        lastShot: 0,
        lastSwing: 0,
        lastUpdate: 0
    };

    players.set(id, player);

    send(ws, {
        type: 'welcome',
        id,
        phase,
        players: [...players.values()].map(publicPlayer),
        walls,
        trees,
        loot,
        storm,
        teamMode
    });

    broadcast({
        type: 'playerJoined',
        player: publicPlayer(player)
    }, id);

    if (phase === 'lobby' && players.size >= 1) {
        setTimeout(() => {
            if (phase === 'lobby' && players.size > 0) {
                startCountdown();
            }
        }, 1200);
    }

    ws.on('message', raw => {
        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (!data || typeof data.type !== 'string') {
            return;
        }

        const p = players.get(id);

        if (!p) return;

        switch (data.type) {
            case 'setName': {
                p.name = safeName(
                    data.name,
                    `Jugador ${p.id}`
                );

                broadcastAll({
                    type: 'nameChange',
                    id: p.id,
                    name: p.name
                });

                break;
            }

            case 'setTeamMode': {
                if (phase !== 'lobby') return;

                const mode = Number(data.mode);

                if (![1, 2, 3, 4].includes(mode)) {
                    return;
                }

                teamMode = mode;
                assignTeams();

                broadcastAll({
                    type: 'teamMode',
                    mode: teamMode,
                    players: [...players.values()].map(publicPlayer)
                });

                break;
            }

            case 'update': {
                if (
                    !p.alive ||
                    phase !== 'playing'
                ) {
                    return;
                }

                const x = Number(data.x);
                const y = Number(data.y);
                const angle = Number(data.angle);

                if (
                    !validNumber(x) ||
                    !validNumber(y) ||
                    !validNumber(angle)
                ) {
                    return;
                }

                const now = Date.now();

                if (now - p.lastUpdate < 35) {
                    return;
                }

                p.lastUpdate = now;

                const maxDistance = 32;

                if (
                    Math.hypot(
                        x - p.x,
                        y - p.y
                    ) > maxDistance
                ) {
                    return;
                }

                if (canMoveTo(p, x, y)) {
                    p.x = x;
                    p.y = y;
                }

                p.angle = clamp(
                    angle,
                    -Math.PI * 2,
                    Math.PI * 2
                );

                if (
                    typeof data.slot === 'number' &&
                    [1, 2].includes(data.slot)
                ) {
                    p.slot = data.slot;
                }

                if (
                    typeof data.emote === 'string'
                ) {
                    p.emote = data.emote.slice(0, 12);
                } else {
                    p.emote = null;
                }

                broadcast({
                    type: 'playerUpdate',
                    id: p.id,
                    x: p.x,
                    y: p.y,
                    angle: p.angle,
                    health: p.health,
                    shield: p.shield,
                    materials: p.materials,
                    emote: p.emote,
                    alive: p.alive,
                    team: p.team,
                    slot: p.slot,
                    weapon: p.weapon,
                    ammo: p.ammo,
                    reloading: p.reloading
                }, p.id);

                break;
            }

            case 'shoot':
                performShot(p);
                break;

            case 'reload':
                if (p.alive && phase === 'playing') {
                    startReload(p);
                }
                break;

            case 'build':
                build(p, data);
                break;

            case 'wallHit':
                hitWall(p, data);
                break;

            case 'treeHit':
                hitTree(p, data);
                break;

            case 'pickup':
                pickup(p, data);
                break;

            case 'chat': {
                const message = String(
                    data.message || ''
                )
                    .replace(/[<>]/g, '')
                    .trim()
                    .slice(0, 100);

                if (!message) return;

                broadcastAll({
                    type: 'chat',
                    id: p.id,
                    name: p.name,
                    message
                });

                break;
            }

            default:
                break;
        }
    });

    ws.on('close', () => {
        players.delete(id);

        broadcastAll({
            type: 'playerLeft',
            id
        });

        if (
            phase === 'countdown' &&
            players.size === 0
        ) {
            clearInterval(countdownTimer);
            phase = 'lobby';
        }

        if (
            phase === 'playing' &&
            players.size === 0
        ) {
            phase = 'lobby';
        }
    });

    ws.on('error', () => {
        try {
            ws.close();
        } catch {}
    });
});

setInterval(() => {
    advanceStorm();
}, 1000);

setInterval(() => {
    applyStormDamage();
}, 1000);

resetWorld();

server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('========================================');
    console.log('       PIXELROYALE 2.0 SERVER');
    console.log('========================================');
    console.log(`Puerto: ${PORT}`);
    console.log(`Mundo: ${WORLD} x ${WORLD}`);
    console.log(`Máximo jugadores: ${MAX_PLAYERS}`);
    console.log('========================================');
    console.log('');
});
