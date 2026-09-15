const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const WORLD = 2000;
const MAX_MATERIALS = 200;
const START_MATERIALS = 50;
const BUILD_COST = 10;

const PLAYER_RADIUS = 13;
const MAX_CHAT_LENGTH = 100;

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        const file = path.join(__dirname, 'client.html');

        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando el juego');
                return;
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

const wss = new WebSocket.Server({ server });


// ============================================================
// ESTADO
// ============================================================

const players = new Map();

let walls = [];
let trees = [];
let loot = [];
let bullets = [];

let nextId = 1;
let nextWallId = 1;
let nextTreeId = 1;
let nextLootId = 1;
let nextBulletId = 1;

const STATE = {
    LOBBY: 'lobby',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    ENDED: 'ended'
};

let gameState = STATE.LOBBY;
let countdown = 0;
let winner = null;


// ============================================================
// TORMENTA
// ============================================================

let storm = {
    cx: WORLD / 2,
    cy: WORLD / 2,
    radius: 1400,
    targetRadius: 1400,
    damage: 2,
    phase: 0,
    nextShrink: 0
};


// ============================================================
// ARMAS
// ============================================================

const WEAPONS = {

    pistol: {
        id: 'pistol',
        name: 'Pistola',
        damage: 20,
        rate: 300,
        speed: 15,
        radius: 4,
        pellets: 1,
        spread: 0,
        range: 900,
        wallDamage: 25,
        color: '#00c6ff',
        emoji: '🔫'
    },

    shotgun: {
        id: 'shotgun',
        name: 'Escopeta',
        damage: 12,
        rate: 750,
        speed: 12,
        radius: 4,
        pellets: 8,
        spread: 0.32,
        range: 500,
        wallDamage: 12,
        color: '#ff9f43',
        emoji: '💥'
    },

    rifle: {
        id: 'rifle',
        name: 'Rifle',
        damage: 31,
        rate: 190,
        speed: 19,
        radius: 3,
        pellets: 1,
        spread: 0.015,
        range: 1200,
        wallDamage: 30,
        color: '#2ecc71',
        emoji: '🎯'
    },

    smg: {
        id: 'smg',
        name: 'SMG',
        damage: 13,
        rate: 95,
        speed: 16,
        radius: 3,
        pellets: 1,
        spread: 0.06,
        range: 800,
        wallDamage: 16,
        color: '#9b59b6',
        emoji: '⚡'
    },

    sniper: {
        id: 'sniper',
        name: 'Francotirador',
        damage: 80,
        rate: 1300,
        speed: 28,
        radius: 3,
        pellets: 1,
        spread: 0,
        range: 1800,
        wallDamage: 70,
        color: '#e74c3c',
        emoji: '🔭'
    }
};


// ============================================================
// EMOTES
// ============================================================

const EMOTES = {
    dance: {
        id: 'dance',
        emoji: '💃',
        duration: 2500
    },

    wave: {
        id: 'wave',
        emoji: '👋',
        duration: 2200
    },

    cheer: {
        id: 'cheer',
        emoji: '🎉',
        duration: 2200
    },

    laugh: {
        id: 'laugh',
        emoji: '😂',
        duration: 2200
    },

    heart: {
        id: 'heart',
        emoji: '❤️',
        duration: 2200
    },

    angry: {
        id: 'angry',
        emoji: '😡',
        duration: 2200
    },

    thumbs: {
        id: 'thumbs',
        emoji: '👍',
        duration: 2200
    },

    cool: {
        id: 'cool',
        emoji: '😎',
        duration: 2200
    },

    sit: {
        id: 'sit',
        emoji: '🪑',
        duration: 4000
    }
};


// ============================================================
// UTILIDADES
// ============================================================

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function distance(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function addMaterials(player, amount) {
    player.materials = clamp(
        player.materials + Math.max(0, amount || 0),
        0,
        MAX_MATERIALS
    );
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeAngle(angle) {
    let a = safeNumber(angle, 0);

    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;

    return a;
}

function sendTo(id, data) {
    const p = players.get(id);

    if (
        p &&
        p.ws &&
        p.ws.readyState === WebSocket.OPEN
    ) {
        p.ws.send(JSON.stringify(data));
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

function getAlivePlayers() {
    return Array.from(players.values())
        .filter(p => p.inMatch && p.alive);
}

function getAliveSquads() {
    const squads = new Map();

    for (const p of getAlivePlayers()) {
        const squadId = p.squadId || `solo_${p.id}`;

        if (!squads.has(squadId)) {
            squads.set(squadId, []);
        }

        squads.get(squadId).push(p);
    }

    return squads;
}


// ============================================================
// COLISIONES
// ============================================================

function pointInsideRect(x, y, rect) {
    return (
        x >= rect.x &&
        x <= rect.x + rect.w &&
        y >= rect.y &&
        y <= rect.y + rect.h
    );
}

function circleIntersectsRect(cx, cy, radius, rect) {
    const closestX = clamp(cx, rect.x, rect.x + rect.w);
    const closestY = clamp(cy, rect.y, rect.y + rect.h);

    const dx = cx - closestX;
    const dy = cy - closestY;

    return dx * dx + dy * dy <= radius * radius;
}

function segmentIntersectsRect(x1, y1, x2, y2, rect) {

    const minX = rect.x;
    const maxX = rect.x + rect.w;
    const minY = rect.y;
    const maxY = rect.y + rect.h;

    const dx = x2 - x1;
    const dy = y2 - y1;

    let t0 = 0;
    let t1 = 1;

    const p = [-dx, dx, -dy, dy];
    const q = [
        x1 - minX,
        maxX - x1,
        y1 - minY,
        maxY - y1
    ];

    for (let i = 0; i < 4; i++) {

        if (p[i] === 0) {
            if (q[i] < 0) return false;
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

function firstWallOnSegment(x1, y1, x2, y2) {

    let result = null;
    let bestDistance = Infinity;

    for (const wall of walls) {

        if (
            segmentIntersectsRect(
                x1,
                y1,
                x2,
                y2,
                wall
            )
        ) {

            const d = distance(
                x1,
                y1,
                wall.x + wall.w / 2,
                wall.y + wall.h / 2
            );

            if (d < bestDistance) {
                bestDistance = d;
                result = wall;
            }
        }
    }

    return result;
}


// ============================================================
// MUNDO
// ============================================================

function resetWorld() {

    walls = [];
    trees = [];
    loot = [];
    bullets = [];

    nextWallId = 1;
    nextTreeId = 1;
    nextLootId = 1;
    nextBulletId = 1;

    // Árboles
    for (let i = 0; i < 55; i++) {

        let x;
        let y;

        let valid = false;

        while (!valid) {

            x = 80 + Math.random() * (WORLD - 160);
            y = 80 + Math.random() * (WORLD - 160);

            valid = true;

            for (const tree of trees) {
                if (distance(x, y, tree.x, tree.y) < 60) {
                    valid = false;
                    break;
                }
            }
        }

        trees.push({
            id: nextTreeId++,
            x,
            y,
            health: 80,
            maxHealth: 80,
            radius: 18
        });
    }


    // Loot
    const weaponKeys = Object.keys(WEAPONS);

    for (let i = 0; i < 45; i++) {

        const roll = Math.random();

        let type;

        if (roll < 0.48) {
            type = 'weapon';
        } else if (roll < 0.70) {
            type = 'shield';
        } else {
            type = 'materials';
        }

        const item = {
            id: nextLootId++,
            x: 100 + Math.random() * (WORLD - 200),
            y: 100 + Math.random() * (WORLD - 200),
            type
        };

        if (type === 'weapon') {

            const key =
                weaponKeys[
                    Math.floor(
                        Math.random() *
                        weaponKeys.length
                    )
                ];

            item.weapon = {
                ...WEAPONS[key]
            };

        } else if (type === 'shield') {

            item.amount =
                25 +
                Math.floor(
                    Math.random() * 50
                );

        } else {

            item.amount =
                15 +
                Math.floor(
                    Math.random() * 30
                );
        }

        loot.push(item);
    }


    // Tormenta
    storm = {
        cx:
            WORLD / 2 +
            (Math.random() - 0.5) * 200,

        cy:
            WORLD / 2 +
            (Math.random() - 0.5) * 200,

        radius: 1350,
        targetRadius: 1350,
        damage: 2,
        phase: 0,
        nextShrink: Date.now() + 45000
    };
}


// ============================================================
// SERIALIZAR JUGADORES
// ============================================================

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
        slot: p.slot,
        weapon: p.weapon,
        squadId: p.squadId,
        squadSize: p.squadSize,
        ready: p.ready
    };
}


// ============================================================
// CUENTA ATRÁS
// ============================================================

function startCountdown() {

    if (gameState !== STATE.LOBBY) {
        return;
    }

    const readyPlayers =
        Array.from(players.values())
            .filter(p => p.ready);

    if (readyPlayers.length < 1) {
        return;
    }

    gameState = STATE.COUNTDOWN;

    countdown = 5;

    broadcastAll({
        type: 'countdown',
        seconds: countdown
    });

    const timer = setInterval(() => {

        if (players.size === 0) {
            clearInterval(timer);
            gameState = STATE.LOBBY;
            return;
        }

        countdown--;

        broadcastAll({
            type: 'countdown',
            seconds: countdown
        });

        if (countdown <= 0) {

            clearInterval(timer);

            startMatch();
        }

    }, 1000);
}


// ============================================================
// INICIAR PARTIDA
// ============================================================

function startMatch() {

    resetWorld();

    gameState = STATE.PLAYING;
    winner = null;

    const matchPlayers =
        Array.from(players.values());

    matchPlayers.forEach((p, index) => {

        const angle =
            (index / Math.max(1, matchPlayers.length)) *
            Math.PI *
            2 +
            Math.random() * 0.4;

        const spawnDistance =
            400 +
            Math.random() * 500;

        p.x =
            WORLD / 2 +
            Math.cos(angle) *
            spawnDistance;

        p.y =
            WORLD / 2 +
            Math.sin(angle) *
            spawnDistance;

        p.x = clamp(
            p.x,
            50,
            WORLD - 50
        );

        p.y = clamp(
            p.y,
            50,
            WORLD - 50
        );

        p.health = 100;
        p.shield = 0;

        p.materials = START_MATERIALS;

        p.alive = true;
        p.inMatch = true;

        p.kills = 0;

        p.slot = 2;

        p.weapon = {
            ...WEAPONS.pistol
        };

        p.lastShotAt = 0;
        p.emote = null;
        p.emoteUntil = 0;

        p.xpEarned = 0;
    });


    broadcastAll({
        type: 'matchStart',

        walls,

        trees,

        loot,

        storm: {
            ...storm
        },

        players:
            matchPlayers.map(publicPlayer)
    });
}


// ============================================================
// FINAL PARTIDA
// ============================================================

function endMatch(winData) {

    if (gameState !== STATE.PLAYING) {
        return;
    }

    gameState = STATE.ENDED;

    winner = winData;

    for (const p of players.values()) {

        if (!p.inMatch) continue;

        let xp =
            p.kills * 25;

        if (p.alive) {
            xp += 100;
        }

        if (
            winner &&
            (
                winner.id === p.id ||
                winner.squadId === p.squadId
            )
        ) {
            xp += 120;
        }

        p.xpEarned = xp;

        p.totalXp =
            (p.totalXp || 0) +
            xp;
    }


    broadcastAll({
        type: 'matchEnd',

        winner,

        players:
            Array.from(players.values())
                .filter(p => p.inMatch)
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    kills: p.kills,
                    alive: p.alive,
                    xp: p.xpEarned,
                    squadId: p.squadId,
                    color: p.color
                }))
    });
}


// ============================================================
// VICTORIA
// ============================================================

function checkVictory() {

    if (gameState !== STATE.PLAYING) {
        return;
    }

    const squads = getAliveSquads();

    if (squads.size > 1) {
        return;
    }

    if (squads.size === 1) {

        const [
            squadId,
            members
        ] = [...squads.entries()][0];

        const isSolo =
            squadId.startsWith('solo_');

        endMatch({

            type:
                isSolo
                    ? 'solo'
                    : 'squad',

            id:
                isSolo
                    ? members[0].id
                    : null,

            name:
                isSolo
                    ? members[0].name
                    : members
                        .map(m => m.name)
                        .join(', '),

            squadId,

            members:
                members.map(m => ({
                    id: m.id,
                    name: m.name,
                    color: m.color
                }))
        });

    } else {

        endMatch({
            type: 'none',
            name: 'Nadie'
        });
    }
}


// ============================================================
// APLICAR DAÑO
// ============================================================

function applyDamage(attacker, target, damage) {

    if (
        !target ||
        !target.alive
    ) {
        return;
    }

    if (
        attacker &&
        attacker.squadId &&
        target.squadId &&
        attacker.squadId === target.squadId
    ) {
        return;
    }

    let remaining =
        Math.max(0, damage);

    if (target.shield > 0) {

        const absorbed =
            Math.min(
                target.shield,
                remaining
            );

        target.shield -= absorbed;
        remaining -= absorbed;
    }

    if (remaining > 0) {
        target.health -= remaining;
    }

    target.health =
        Math.max(0, target.health);


    if (target.health <= 0) {

        target.alive = false;

        target.health = 0;

        if (attacker) {

            attacker.kills++;

            addMaterials(
                attacker,
                15
            );
        }


        // Dropear arma
        if (
            target.weapon &&
            target.weapon.id !== 'pistol'
        ) {

            const dropped = {

                id: nextLootId++,

                x:
                    target.x +
                    (Math.random() - 0.5) *
                    30,

                y:
                    target.y +
                    (Math.random() - 0.5) *
                    30,

                type: 'weapon',

                weapon: {
                    ...target.weapon
                }
            };

            loot.push(dropped);

            broadcastAll({
                type: 'lootSpawn',
                loot: dropped
            });
        }


        broadcastAll({
            type: 'playerDied',
            id: target.id,
            killerId:
                attacker
                    ? attacker.id
                    : null
        });

        checkVictory();

    } else {

        broadcastAll({
            type: 'playerDamaged',

            id: target.id,

            health: target.health,

            shield: target.shield
        });
    }
}


// ============================================================
// CREAR BALA
// ============================================================

function createBullet(
    shooter,
    weapon,
    angle
) {

    const startX =
        shooter.x +
        Math.cos(angle) *
        20;

    const startY =
        shooter.y +
        Math.sin(angle) *
        20;

    const bullet = {

        id: nextBulletId++,

        x: startX,
        y: startY,

        prevX: startX,
        prevY: startY,

        vx:
            Math.cos(angle) *
            weapon.speed,

        vy:
            Math.sin(angle) *
            weapon.speed,

        radius: weapon.radius,

        damage: weapon.damage,

        wallDamage: weapon.wallDamage,

        range: weapon.range,

        travelled: 0,

        fromId: shooter.id,

        color: weapon.color,

        weaponId: weapon.id,

        life: 120
    };

    bullets.push(bullet);

    broadcastAll({
        type: 'bulletSpawn',

        bullet: {
            id: bullet.id,
            x: bullet.x,
            y: bullet.y,
            vx: bullet.vx,
            vy: bullet.vy,
            radius: bullet.radius,
            color: bullet.color,
            fromId: bullet.fromId
        }
    });

    return bullet;
}


// ============================================================
// DISPARO DEL SERVIDOR
// ============================================================

function serverShoot(player, requestedAngle) {

    if (
        gameState !== STATE.PLAYING ||
        !player.alive ||
        player.slot !== 2
    ) {
        return;
    }

    const weapon =
        WEAPONS[player.weapon.id] ||
        WEAPONS.pistol;

    const now = Date.now();

    if (
        now - player.lastShotAt <
        weapon.rate
    ) {
        return;
    }

    player.lastShotAt = now;

    const angle =
        normalizeAngle(requestedAngle);

    const pellets =
        weapon.pellets || 1;

    for (let i = 0; i < pellets; i++) {

        let shotAngle = angle;

        if (pellets > 1) {

            const randomSpread =
                (Math.random() - 0.5) *
                weapon.spread *
                2;

            shotAngle += randomSpread;

        } else if (weapon.spread > 0) {

            shotAngle +=
                (Math.random() - 0.5) *
                weapon.spread *
                2;
        }

        createBullet(
            player,
            weapon,
            shotAngle
        );
    }
}


// ============================================================
// ACTUALIZAR BALAS
// ============================================================

function updateBullets() {

    if (gameState !== STATE.PLAYING) {
        bullets = [];
        return;
    }

    const newBullets = [];

    for (const bullet of bullets) {

        bullet.prevX = bullet.x;
        bullet.prevY = bullet.y;

        bullet.x += bullet.vx;
        bullet.y += bullet.vy;

        bullet.travelled +=
            Math.hypot(
                bullet.vx,
                bullet.vy
            );

        bullet.life--;


        // Fuera del mundo
        if (
            bullet.x < 0 ||
            bullet.x > WORLD ||
            bullet.y < 0 ||
            bullet.y > WORLD ||
            bullet.life <= 0 ||
            bullet.travelled > bullet.range
        ) {

            broadcastAll({
                type: 'bulletRemove',
                id: bullet.id
            });

            continue;
        }


        // ====================================================
        // PARED
        // ====================================================

        const wall =
            firstWallOnSegment(
                bullet.prevX,
                bullet.prevY,
                bullet.x,
                bullet.y
            );

        if (wall) {

            wall.health -=
                bullet.wallDamage;

            broadcastAll({
                type: 'bulletHitWall',

                bulletId: bullet.id,

                wallId: wall.id,

                health:
                    Math.max(
                        0,
                        wall.health
                    ),

                x: bullet.x,
                y: bullet.y
            });


            if (wall.health <= 0) {

                const index =
                    walls.findIndex(
                        w => w.id === wall.id
                    );

                if (index !== -1) {

                    walls.splice(index, 1);

                    broadcastAll({
                        type: 'wallDestroyed',
                        wallId: wall.id
                    });
                }

            } else {

                broadcastAll({
                    type: 'wallDamaged',

                    wallId: wall.id,

                    health: wall.health
                });
            }


            broadcastAll({
                type: 'bulletRemove',
                id: bullet.id
            });

            continue;
        }


        // ====================================================
        // JUGADORES
        // ====================================================

        let hitPlayer = null;

        for (const target of getAlivePlayers()) {

            if (
                target.id ===
                bullet.fromId
            ) {
                continue;
            }

            const shooter =
                players.get(
                    bullet.fromId
                );

            if (
                shooter &&
                shooter.squadId &&
                target.squadId &&
                shooter.squadId ===
                target.squadId
            ) {
                continue;
            }


            const d =
                distance(
                    bullet.x,
                    bullet.y,
                    target.x,
                    target.y
                );

            if (
                d <=
                PLAYER_RADIUS +
                bullet.radius
            ) {

                hitPlayer = target;
                break;
            }
        }


        if (hitPlayer) {

            const shooter =
                players.get(
                    bullet.fromId
                );

            applyDamage(
                shooter,
                hitPlayer,
                bullet.damage
            );

            broadcastAll({
                type: 'bulletRemove',
                id: bullet.id
            });

            continue;
        }


        newBullets.push(bullet);
    }

    bullets = newBullets;
}


// ============================================================
// GAME LOOP
// ============================================================

setInterval(() => {

    updateBullets();

    if (gameState !== STATE.PLAYING) {
        return;
    }


    const now = Date.now();


    // Emotes
    for (const p of players.values()) {

        if (
            p.emote &&
            p.emoteUntil > 0 &&
            now > p.emoteUntil
        ) {
            p.emote = null;
            p.emoteUntil = 0;

            broadcastAll({
                type: 'emote',
                id: p.id,
                emote: null
            });
        }
    }


    // Tormenta
    if (
        now >
        storm.nextShrink
    ) {

        storm.phase++;

        const phases = [
            950,
            700,
            500,
            320,
            180,
            80,
            30
        ];

        storm.targetRadius =
            phases[
                Math.min(
                    storm.phase - 1,
                    phases.length - 1
                )
            ] || 30;

        storm.damage =
            2 +
            storm.phase *
            1.5;

        storm.nextShrink =
            now +
            Math.max(
                12000,
                40000 -
                storm.phase * 4000
            );

        storm.cx +=
            (Math.random() - 0.5) *
            180;

        storm.cy +=
            (Math.random() - 0.5) *
            180;

        storm.cx =
            clamp(
                storm.cx,
                200,
                WORLD - 200
            );

        storm.cy =
            clamp(
                storm.cy,
                200,
                WORLD - 200
            );

        broadcastAll({
            type: 'stormUpdate',
            storm: {
                ...storm
            }
        });
    }


    // Acercar tormenta
    if (
        storm.radius >
        storm.targetRadius
    ) {

        storm.radius -= 0.45;

        if (
            storm.radius <
            storm.targetRadius
        ) {
            storm.radius =
                storm.targetRadius;
        }
    }


    // Daño tormenta
    for (const p of getAlivePlayers()) {

        const d =
            distance(
                p.x,
                p.y,
                storm.cx,
                storm.cy
            );

        if (
            d >
            storm.radius
        ) {

            applyDamage(
                null,
                p,
                storm.damage
            );
        }
    }

}, 100);


// ============================================================
// BROADCAST ESTADO
// ============================================================

setInterval(() => {

    if (gameState !== STATE.PLAYING) {
        return;
    }

    const state = {

        type: 'state',

        players:
            getAliveAndMatchPlayers(),

        walls,

        trees,

        loot,

        storm: {
            ...storm
        }
    };

    broadcastAll(state);

}, 100);


function getAliveAndMatchPlayers() {

    return Array.from(players.values())
        .filter(p => p.inMatch)
        .map(publicPlayer);
}


// ============================================================
// CONEXIONES
// ============================================================

wss.on('connection', ws => {

    const id = nextId++;

    const player = {

        id,

        ws,

        x: 0,
        y: 0,

        angle: 0,

        health: 100,
        shield: 0,

        materials: START_MATERIALS,

        color:
            `hsl(${Math.random() * 360}, 70%, 55%)`,

        name:
            `Jugador ${id}`,

        alive: true,
        inMatch: false,

        ready: false,

        kills: 0,

        slot: 2,

        weapon: {
            ...WEAPONS.pistol
        },

        squadId: null,
        squadSize: 1,
        partyCode: null,

        totalXp: 0,
        xpEarned: 0,

        emote: null,
        emoteUntil: 0,

        lastShotAt: 0,

        lastUpdateAt: Date.now()
    };


    players.set(id, player);


    // Welcome
    ws.send(JSON.stringify({

        type: 'welcome',

        id,

        gameState,

        players:
            Array.from(players.values())
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    color: p.color,
                    ready: p.ready,
                    squadId: p.squadId,
                    squadSize: p.squadSize,
                    totalXp: p.totalXp || 0
                }))
    }));


    broadcast({

        type: 'playerJoinedLobby',

        player: {
            id: player.id,
            name: player.name,
            color: player.color,
            ready: false,
            squadId: null,
            squadSize: 1
        }

    }, id);


    // ========================================================
    // MENSAJES
    // ========================================================

    ws.on('message', raw => {

        let data;

        try {
            data = JSON.parse(raw);
        } catch {
            return;
        }

        const p = players.get(id);

        if (!p) {
            return;
        }


        switch (data.type) {


            // ==================================================
            // NOMBRE
            // ==================================================

            case 'setName': {

                let name =
                    String(
                        data.name ||
                        `Jugador ${id}`
                    ).trim();

                name =
                    name
                        .replace(/[<>]/g, '')
                        .slice(0, 16);

                if (!name) {
                    name =
                        `Jugador ${id}`;
                }

                p.name = name;

                broadcastAll({
                    type: 'nameChange',
                    id,
                    name
                });

                break;
            }


            // ==================================================
            // TAMAÑO ESCUADRÓN
            // ==================================================

            case 'setSquadSize': {

                if (
                    gameState !==
                    STATE.LOBBY
                ) {
                    break;
                }

                p.squadSize =
                    clamp(
                        parseInt(data.size) || 1,
                        1,
                        4
                    );

                if (
                    p.squadSize === 1
                ) {
                    p.squadId = null;
                    p.partyCode = null;
                }

                p.ready = false;

                broadcastAll({
                    type: 'lobbyUpdate',

                    id,

                    squadId:
                        p.squadId,

                    squadSize:
                        p.squadSize,

                    ready:
                        p.ready
                });

                break;
            }


            // ==================================================
            // CREAR PARTIDO
            // ==================================================

            case 'createParty': {

                if (
                    gameState !==
                    STATE.LOBBY
                ) {
                    break;
                }

                let code;

                do {
                    code =
                        Math.random()
                            .toString(36)
                            .substring(2, 6)
                            .toUpperCase();

                } while (
                    Array.from(players.values())
                        .some(
                            pl =>
                                pl.partyCode === code
                        )
                );


                p.partyCode = code;

                p.squadId =
                    'party_' + code;

                p.squadSize =
                    clamp(
                        p.squadSize || 2,
                        2,
                        4
                    );

                p.ready = false;


                sendTo(id, {
                    type: 'partyCreated',
                    code,
                    squadId:
                        p.squadId
                });


                broadcastAll({
                    type: 'lobbyUpdate',

                    id,

                    squadId:
                        p.squadId,

                    squadSize:
                        p.squadSize,

                    ready: false,

                    partyCode:
                        code
                });

                break;
            }


            // ==================================================
            // UNIRSE PARTIDO
            // ==================================================

            case 'joinParty': {

                if (
                    gameState !==
                    STATE.LOBBY
                ) {
                    break;
                }

                const joinCode =
                    String(
                        data.code || ''
                    )
                        .toUpperCase()
                        .slice(0, 6);

                let host = null;

                for (
                    const pl of
                    players.values()
                ) {

                    if (
                        pl.partyCode ===
                        joinCode
                    ) {

                        host = pl;
                        break;
                    }
                }


                if (!host) {

                    sendTo(id, {
                        type:
                            'partyNotFound'
                    });

                    break;
                }


                const members =
                    Array.from(
                        players.values()
                    ).filter(
                        x =>
                            x.squadId ===
                            host.squadId
                    );


                if (
                    members.length >=
                    host.squadSize
                ) {

                    sendTo(id, {
                        type:
                            'partyFull'
                    });

                    break;
                }


                p.squadId =
                    host.squadId;

                p.partyCode =
                    joinCode;

                p.squadSize =
                    host.squadSize;

                p.ready = false;


                sendTo(id, {
                    type:
                        'partyJoined',

                    code:
                        joinCode,

                    squadId:
                        p.squadId
                });


                broadcastAll({
                    type:
                        'lobbyUpdate',

                    id,

                    squadId:
                        p.squadId,

                    squadSize:
                        p.squadSize,

                    ready: false
                });

                break;
            }


            // ==================================================
            // SALIR ESCUADRÓN
            // ==================================================

            case 'leaveParty': {

                p.squadId = null;
                p.partyCode = null;
                p.ready = false;

                broadcastAll({
                    type: 'lobbyUpdate',

                    id,

                    squadId: null,

                    squadSize:
                        p.squadSize,

                    ready: false
                });

                break;
            }


            // ==================================================
            // READY
            // ==================================================

            case 'setReady': {

                if (
                    gameState !==
                    STATE.LOBBY
                ) {
                    break;
                }

                p.ready =
                    !!data.ready;

                broadcastAll({
                    type:
                        'lobbyUpdate',

                    id,

                    ready:
                        p.ready,

                    squadId:
                        p.squadId,

                    squadSize:
                        p.squadSize
                });


                const allPlayers =
                    Array.from(
                        players.values()
                    );

                if (
                    allPlayers.length >= 1 &&
                    allPlayers.every(
                        pl => pl.ready
                    )
                ) {

                    startCountdown();
                }

                break;
            }


            // ==================================================
            // START
            // ==================================================

            case 'requestStart': {

                if (
                    gameState ===
                    STATE.LOBBY
                ) {
                    startCountdown();
                }

                break;
            }


            // ==================================================
            // JUGAR OTRA VEZ
            // ==================================================

            case 'playAgain': {

                if (
                    gameState !==
                    STATE.ENDED
                ) {
                    break;
                }

                gameState =
                    STATE.LOBBY;

                for (
                    const pl of
                    players.values()
                ) {

                    pl.ready = false;

                    pl.inMatch = false;

                    pl.alive = true;

                    pl.health = 100;

                    pl.shield = 0;

                    pl.materials =
                        START_MATERIALS;

                    pl.weapon = {
                        ...WEAPONS.pistol
                    };

                    pl.slot = 2;

                    pl.emote = null;
                    pl.emoteUntil = 0;
                }


                broadcastAll({

                    type:
                        'backToLobby',

                    players:
                        Array.from(
                            players.values()
                        ).map(
                            p => ({
                                id: p.id,
                                name: p.name,
                                color: p.color,
                                ready: false,
                                squadId:
                                    p.squadId,
                                squadSize:
                                    p.squadSize,
                                totalXp:
                                    p.totalXp || 0
                            })
                        )
                });

                break;
            }


            // ==================================================
            // MOVIMIENTO
            // ==================================================

            case 'update': {

                if (
                    gameState !==
                    STATE.PLAYING ||
                    !p.alive ||
                    !p.inMatch
                ) {
                    break;
                }


                const now = Date.now();

                const newX =
                    clamp(
                        safeNumber(
                            data.x,
                            p.x
                        ),
                        20,
                        WORLD - 20
                    );

                const newY =
                    clamp(
                        safeNumber(
                            data.y,
                            p.y
                        ),
                        20,
                        WORLD - 20
                    );


                // Anti teleport
                const elapsed =
                    Math.max(
                        0.016,
                        (now -
                            p.lastUpdateAt) /
                            1000
                    );

                const maxDistance =
                    Math.max(
                        35,
                        260 *
                        Math.min(
                            elapsed,
                            0.25
                        )
                    );

                const movement =
                    distance(
                        p.x,
                        p.y,
                        newX,
                        newY
                    );


                let finalX = newX;
                let finalY = newY;


                if (
                    movement >
                    maxDistance
                ) {

                    const ratio =
                        maxDistance /
                        movement;

                    finalX =
                        p.x +
                        (newX - p.x) *
                        ratio;

                    finalY =
                        p.y +
                        (newY - p.y) *
                        ratio;
                }


                p.x = finalX;
                p.y = finalY;

                p.angle =
                    normalizeAngle(
                        data.angle
                    );

                p.slot =
                    data.slot === 1
                        ? 1
                        : 2;

                p.lastUpdateAt =
                    now;


                broadcast({
                    type:
                        'playerUpdate',

                    id,

                    x: p.x,
                    y: p.y,

                    angle: p.angle,

                    health:
                        p.health,

                    shield:
                        p.shield,

                    materials:
                        p.materials,

                    slot:
                        p.slot,

                    weapon:
                        p.weapon,

                    emote:
                        p.emote
                }, id);

                break;
            }


            // ==================================================
            // DISPARAR
            // ==================================================

            case 'shoot': {

                if (
                    gameState !==
                    STATE.PLAYING ||
                    !p.alive ||
                    p.slot !== 2
                ) {
                    break;
                }

                serverShoot(
                    p,
                    data.angle
                );

                break;
            }


            // ==================================================
            // EMOTE
            // ==================================================

            case 'emote': {

                if (
                    gameState !==
                    STATE.PLAYING ||
                    !p.alive
                ) {
                    break;
                }

                const emoteId =
                    String(
                        data.emote || ''
                    );

                const emote =
                    EMOTES[emoteId];

                if (!emote) {
                    break;
                }

                p.emote =
                    emote.id;

                p.emoteUntil =
                    Date.now() +
                    emote.duration;


                broadcastAll({
                    type: 'emote',

                    id,

                    emote:
                        emote.id,

                    emoji:
                        emote.emoji
                });

                break;
            }


            // ==================================================
            // CONSTRUIR
            // ==================================================

            case 'build': {

                if (
                    gameState !==
                    STATE.PLAYING ||
                    !p.alive ||
                    p.materials <
                    BUILD_COST
                ) {
                    break;
                }


                let bx =
                    safeNumber(
                        data.x,
                        p.x
                    );

                let by =
                    safeNumber(
                        data.y,
                        p.y
                    );


                // No permitir construir
                // a distancia absurda
                if (
                    distance(
                        p.x,
                        p.y,
                        bx + 20,
                        by + 20
                    ) > 100
                ) {

                    const a =
                        Math.atan2(
                            by + 20 - p.y,
                            bx + 20 - p.x
                        );

                    bx =
                        p.x +
                        Math.cos(a) *
                        55 -
                        20;

                    by =
                        p.y +
                        Math.sin(a) *
                        55 -
                        20;
                }


                bx =
                    clamp(
                        bx,
                        0,
                        WORLD - 40
                    );

                by =
                    clamp(
                        by,
                        0,
                        WORLD - 40
                    );


                const newWall = {

                    id:
                        nextWallId++,

                    x: bx,
                    y: by,

                    w: 40,
                    h: 40,

                    health: 150,
                    maxHealth: 150,

                    ownerId: id
                };


                // No colocar pared encima de otra
                let overlaps = false;

                for (
                    const wall of walls
                ) {

                    if (
                        !(
                            newWall.x +
                            newWall.w <=
                            wall.x ||

                            newWall.x >=
                            wall.x +
                            wall.w ||

                            newWall.y +
                            newWall.h <=
                            wall.y ||

                            newWall.y >=
                            wall.y +
                            wall.h
                        )
                    ) {

                        overlaps = true;
                        break;
                    }
                }


                if (overlaps) {
                    break;
                }


                walls.push(newWall);

                p.materials =
                    clamp(
                        p.materials -
                        BUILD_COST,
                        0,
                        MAX_MATERIALS
                    );


                broadcastAll({

                    type:
                        'wallBuilt',

                    wall:
                        newWall,

                    playerId:
                        id,

                    materials:
                        p.materials
                });

                break;
            }


            // ==================================================
            // GOLPEAR PARED
            // ==================================================

            case 'wallHit': {

                if (
                    gameState !==
                    STATE.PLAYING ||
                    !p.alive ||
                    p.slot !== 1
                ) {
                    break;
                }


                const wall =
                    walls.find(
                        w =>
                            w.id ===
                            data.wallId
                    );

                if (!wall) {
                    break;
                }


                if (
                    distance(
                        p.x,
                        p.y,
                        wall.x +
                        wall.w / 2,
                        wall.y +
                        wall.h / 2
                    ) > 65
                ) {
                    break;
                }


                const damage = 30;

                wall.health -= damage;


                if (
                    wall.health <= 0
                ) {

                    walls =
                        walls.filter(
                            w =>
                                w.id !==
                                wall.id
                        );

                    broadcastAll({
                        type:
                            'wallDestroyed',

                        wallId:
                            wall.id
                    });

                } else {

                    broadcastAll({

                        type:
                            'wallDamaged',

                        wallId:
                            wall.id,

                        health:
                            wall.health
                    });
                }

                break;
            }


            // ==================================================
            // ÁRBOL
            // ==================================================

            case 'treeHit': {

                if (
                    gameState !==
                    STATE.PLAYING ||
                    !p.alive ||
                    p.slot !== 1
                ) {
                    break;
                }


                const tree =
                    trees.find(
                        t =>
                            t.id ===
                            data.treeId
                    );

                if (!tree) {
                    break;
                }


                if (
                    distance(
                        p.x,
                        p.y,
                        tree.x,
                        tree.y
                    ) > 65
                ) {
                    break;
                }


                tree.health -= 25;


                if (
                    tree.health <= 0
                ) {

                    trees =
                        trees.filter(
                            t =>
                                t.id !==
                                tree.id
                        );


                    const amount =
                        18 +
                        Math.floor(
                            Math.random() *
                            13
                        );

                    addMaterials(
                        p,
                        amount
                    );


                    broadcastAll({

                        type:
                            'treeDestroyed',

                        treeId:
                            tree.id,

                        playerId:
                            id,

                        materials:
                            p.materials
                    });

                } else {

                    broadcastAll({

                        type:
                            'treeDamaged',

                        treeId:
                            tree.id,

                        health:
                            tree.health
                    });
                }

                break;
            }


            // ==================================================
            // PICKUP
            // ==================================================

            case 'pickup': {

                if (
                    gameState !==
                    STATE.PLAYING ||
                    !p.alive
                ) {
                    break;
                }


                const index =
                    loot.findIndex(
                        l =>
                            l.id ===
                            data.lootId
                    );

                if (index === -1) {
                    break;
                }


                const item =
                    loot[index];


                if (
                    distance(
                        p.x,
                        p.y,
                        item.x,
                        item.y
                    ) > 55
                ) {
                    break;
                }


                if (
                    item.type ===
                    'weapon'
                ) {

                    p.weapon = {
                        ...item.weapon
                    };


                    broadcastAll({

                        type:
                            'weaponPickup',

                        id,

                        weapon:
                            p.weapon
                    });


                } else if (
                    item.type ===
                    'shield'
                ) {

                    p.shield =
                        clamp(
                            p.shield +
                            (
                                item.amount ||
                                30
                            ),
                            0,
                            100
                        );


                    broadcastAll({

                        type:
                            'playerDamaged',

                        id,

                        health:
                            p.health,

                        shield:
                            p.shield
                    });


                } else if (
                    item.type ===
                    'materials'
                ) {

                    addMaterials(
                        p,
                        item.amount ||
                        20
                    );
                }


                loot.splice(
                    index,
                    1
                );


                broadcastAll({

                    type:
                        'lootRemoved',

                    lootId:
                        item.id,

                    playerId:
                        id,

                    materials:
                        p.materials
                });

                break;
            }


            // ==================================================
            // CHAT
            // ==================================================

            case 'chat': {

                let message =
                    String(
                        data.message ||
                        ''
                    )
                        .replace(/[<>]/g, '')
                        .trim()
                        .slice(
                            0,
                            MAX_CHAT_LENGTH
                        );

                if (!message) {
                    break;
                }


                broadcastAll({

                    type:
                        'chat',

                    id,

                    name:
                        p.name,

                    message
                });

                break;
            }
        }
    });


    // ========================================================
    // DESCONEXIÓN
    // ========================================================

    ws.on('close', () => {

        const wasInMatch =
            players.get(id)?.inMatch;

        players.delete(id);

        broadcastAll({
            type:
                'playerLeft',

            id
        });


        if (
            wasInMatch &&
            gameState ===
            STATE.PLAYING
        ) {
            checkVictory();
        }


        if (
            players.size === 0
        ) {

            gameState =
                STATE.LOBBY;

            walls = [];
            trees = [];
            loot = [];
            bullets = [];
        }
    });
});


// ============================================================
// SERVIDOR
// ============================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            '========================================'
        );

        console.log(
            ' PixelRoyale Battle Royale'
        );

        console.log(
            ` Puerto: ${PORT}`
        );

        console.log(
            ' Paredes bloquean balas'
        );

        console.log(
            ' Daño calculado por servidor'
        );

        console.log(
            ` Materiales: ${MAX_MATERIALS} máximo`
        );

        console.log(
            ' Armas: Pistola / Escopeta / Rifle / SMG / Sniper'
        );

        console.log(
            ' Emotes sincronizados'
        );

        console.log(
            '========================================'
        );
    }
);
