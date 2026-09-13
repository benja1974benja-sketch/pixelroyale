const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const WORLD = 2000;

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        const file = path.join(__dirname, 'client.html');
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error cargando el juego');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const wss = new WebSocket.Server({ server });

// ========== ESTADO GLOBAL ==========
const players = new Map();
let walls = [];
let trees = [];
let loot = [];
let nextId = 1;
let nextWallId = 1;
let nextTreeId = 1;
let nextLootId = 1;

// Estados de partida
const STATE = { LOBBY: 'lobby', COUNTDOWN: 'countdown', PLAYING: 'playing', ENDED: 'ended' };
let gameState = STATE.LOBBY;
let countdown = 0;
let matchStartTime = 0;
let winner = null; // { type: 'solo'|'squad', id/name, squadId }

// Tormenta
let storm = {
    cx: WORLD / 2,
    cy: WORLD / 2,
    radius: 1400,
    targetRadius: 1400,
    damage: 2,
    phase: 0,
    nextShrink: 0
};

// Armas disponibles
const WEAPONS = {
    pistol:   { id: 'pistol',   name: 'Pistola',   dmg: 18, rate: 280, speed: 13, spread: 4, color: '#aaa', emoji: '🔫' },
    shotgun:  { id: 'shotgun',  name: 'Escopeta',  dmg: 12, rate: 700, speed: 11, size: 5, pellets: 5, color: '#e67e22', emoji: '💥' },
    rifle:    { id: 'rifle',    name: 'Rifle',     dmg: 28, rate: 180, speed: 16, size: 3, color: '#2ecc71', emoji: '🎯' },
    smg:      { id: 'smg',      name: 'SMG',       dmg: 12, rate: 90,  speed: 12, size: 3, color: '#9b59b6', emoji: '⚡' },
    sniper:   { id: 'sniper',   name: 'Francotirador', dmg: 55, rate: 1100, speed: 20, size: 3, color: '#e74c3c', emoji: '🔭' }
};

// ========== UTILIDADES ==========
function broadcast(data, exceptId = null) {
    const msg = JSON.stringify(data);
    for (const [id, p] of players) {
        if (id !== exceptId && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(msg);
        }
    }
}

function broadcastAll(data) {
    const msg = JSON.stringify(data);
    for (const [, p] of players) {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
    }
}

function sendTo(id, data) {
    const p = players.get(id);
    if (p && p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(data));
}

function getAlivePlayers() {
    return Array.from(players.values()).filter(p => p.alive && p.inMatch);
}

function getAliveSquads() {
    const squads = new Map();
    for (const p of getAlivePlayers()) {
        const sid = p.squadId || ('solo_' + p.id);
        if (!squads.has(sid)) squads.set(sid, []);
        squads.get(sid).push(p);
    }
    return squads;
}

function resetWorld() {
    walls = [];
    trees = [];
    loot = [];
    nextWallId = 1;
    nextTreeId = 1;
    nextLootId = 1;

    // Árboles
    for (let i = 0; i < 55; i++) {
        trees.push({
            id: nextTreeId++,
            x: 80 + Math.random() * (WORLD - 160),
            y: 80 + Math.random() * (WORLD - 160),
            health: 80,
            maxHealth: 80,
            radius: 18
        });
    }

    // Loot inicial
    const weaponKeys = Object.keys(WEAPONS);
    for (let i = 0; i < 40; i++) {
        const type = Math.random() < 0.55 ? 'weapon' : (Math.random() < 0.5 ? 'shield' : 'materials');
        let item = { id: nextLootId++, x: 100 + Math.random() * (WORLD - 200), y: 100 + Math.random() * (WORLD - 200), type };
        if (type === 'weapon') {
            const w = WEAPONS[weaponKeys[Math.floor(Math.random() * weaponKeys.length)]];
            item.weapon = { ...w };
        } else if (type === 'shield') {
            item.amount = 25 + Math.floor(Math.random() * 50);
        } else {
            item.amount = 15 + Math.floor(Math.random() * 25);
        }
        loot.push(item);
    }

    // Tormenta inicial
    storm = {
        cx: WORLD / 2 + (Math.random() - 0.5) * 200,
        cy: WORLD / 2 + (Math.random() - 0.5) * 200,
        radius: 1350,
        targetRadius: 1350,
        damage: 2,
        phase: 0,
        nextShrink: Date.now() + 45000
    };
}

function startCountdown() {
    if (gameState !== STATE.LOBBY) return;
    const readyCount = Array.from(players.values()).filter(p => p.ready).length;
    if (readyCount < 1) return; // mínimo 1 para pruebas, sube a 2-4 en producción

    gameState = STATE.COUNTDOWN;
    countdown = 5;
    broadcastAll({ type: 'countdown', seconds: countdown });

    const tick = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
            clearInterval(tick);
            startMatch();
        } else {
            broadcastAll({ type: 'countdown', seconds: countdown });
        }
    }, 1000);
}

function startMatch() {
    resetWorld();
    gameState = STATE.PLAYING;
    matchStartTime = Date.now();
    winner = null;

    // Spawnear jugadores en posiciones aleatorias (lejos del centro si hay muchos)
    const alive = Array.from(players.values());
    alive.forEach((p, i) => {
        const angle = (i / alive.length) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 400 + Math.random() * 500;
        p.x = WORLD / 2 + Math.cos(angle) * dist;
        p.y = WORLD / 2 + Math.sin(angle) * dist;
        p.x = Math.max(50, Math.min(WORLD - 50, p.x));
        p.y = Math.max(50, Math.min(WORLD - 50, p.y));
        p.health = 100;
        p.shield = 0;
        p.materials = 20;
        p.alive = true;
        p.inMatch = true;
        p.kills = 0;
        p.weapon = { ...WEAPONS.pistol };
        p.slot = 2; // 1 pico, 2 arma
        p.xpEarned = 0;
        p.emote = null;
    });

    broadcastAll({
        type: 'matchStart',
        walls,
        trees,
        loot,
        storm: { cx: storm.cx, cy: storm.cy, radius: storm.radius },
        players: alive.map(p => ({
            id: p.id, x: p.x, y: p.y, angle: p.angle,
            health: p.health, shield: p.shield, materials: p.materials,
            color: p.color, name: p.name, emote: null, alive: true,
            slot: p.slot, weapon: p.weapon, squadId: p.squadId, squadSize: p.squadSize
        }))
    });
}

function endMatch(winData) {
    if (gameState !== STATE.PLAYING) return;
    gameState = STATE.ENDED;
    winner = winData;

    // Calcular XP
    const alive = getAlivePlayers();
    const placementBonus = { 1: 150, 2: 80, 3: 50 };
    for (const p of players.values()) {
        if (!p.inMatch) continue;
        let xp = p.kills * 25;
        if (p.alive) xp += 100; // sobrevivir
        // bonus por escuadrón
        if (winData && (winData.squadId === p.squadId || winData.id === p.id)) {
            xp += 120;
        }
        p.xpEarned = xp;
        p.totalXp = (p.totalXp || 0) + xp;
    }

    broadcastAll({
        type: 'matchEnd',
        winner,
        players: Array.from(players.values()).filter(p => p.inMatch).map(p => ({
            id: p.id, name: p.name, kills: p.kills, alive: p.alive,
            xp: p.xpEarned, squadId: p.squadId, color: p.color
        }))
    });
}

function checkVictory() {
    if (gameState !== STATE.PLAYING) return;
    const squads = getAliveSquads();
    if (squads.size <= 1) {
        if (squads.size === 1) {
            const [sid, members] = [...squads.entries()][0];
            const isSolo = sid.startsWith('solo_');
            endMatch({
                type: isSolo ? 'solo' : 'squad',
                id: isSolo ? members[0].id : null,
                name: isSolo ? members[0].name : members.map(m => m.name).join(', '),
                squadId: sid,
                members: members.map(m => ({ id: m.id, name: m.name, color: m.color }))
            });
        } else {
            // nadie vivo (raro)
            endMatch({ type: 'none', name: 'Nadie' });
        }
    }
}

// Tormenta loop
setInterval(() => {
    if (gameState !== STATE.PLAYING) return;

    const now = Date.now();

    // Shrink
    if (now > storm.nextShrink) {
        storm.phase++;
        const phases = [900, 550, 320, 180, 90, 40];
        storm.targetRadius = phases[Math.min(storm.phase - 1, phases.length - 1)] || 30;
        storm.damage = 2 + storm.phase * 1.5;
        storm.nextShrink = now + (40000 - storm.phase * 4000);
        // Mover centro un poco hacia un punto aleatorio
        storm.cx += (Math.random() - 0.5) * 180;
        storm.cy += (Math.random() - 0.5) * 180;
        storm.cx = Math.max(200, Math.min(WORLD - 200, storm.cx));
        storm.cy = Math.max(200, Math.min(WORLD - 200, storm.cy));

        broadcastAll({
            type: 'stormUpdate',
            storm: { cx: storm.cx, cy: storm.cy, radius: storm.radius, targetRadius: storm.targetRadius, damage: storm.damage, phase: storm.phase }
        });
    }

    // Suavizar radio
    if (storm.radius > storm.targetRadius) {
        storm.radius -= 0.35;
        if (storm.radius < storm.targetRadius) storm.radius = storm.targetRadius;
    }

    // Daño por tormenta
    for (const p of getAlivePlayers()) {
        const dx = p.x - storm.cx;
        const dy = p.y - storm.cy;
        const dist = Math.hypot(dx, dy);
        if (dist > storm.radius) {
            let dmg = storm.damage;
            if (p.shield > 0) {
                const abs = Math.min(p.shield, dmg);
                p.shield -= abs;
                dmg -= abs;
            }
            if (dmg > 0) p.health -= dmg;
            if (p.health <= 0) {
                p.alive = false;
                p.health = 0;
                broadcastAll({ type: 'playerDied', id: p.id, killerId: null, reason: 'storm' });
                checkVictory();
            } else {
                broadcastAll({ type: 'playerDamaged', id: p.id, health: p.health, shield: p.shield });
            }
        }
    }

    // Broadcast storm position cada segundo aprox
    if (Math.random() < 0.08) {
        broadcastAll({
            type: 'stormUpdate',
            storm: { cx: storm.cx, cy: storm.cy, radius: storm.radius, targetRadius: storm.targetRadius, damage: storm.damage, phase: storm.phase }
        });
    }
}, 200);

// ========== CONEXIONES ==========
wss.on('connection', (ws) => {
    const id = nextId++;
    console.log(`Jugador conectado: #${id}`);

    const player = {
        id,
        ws,
        x: 0, y: 0, angle: 0,
        health: 100, shield: 0, materials: 30,
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
        name: `Jugador ${id}`,
        emote: null,
        alive: true,
        inMatch: false,
        ready: false,
        kills: 0,
        slot: 2,
        weapon: { ...WEAPONS.pistol },
        squadId: null,
        squadSize: 1,
        partyCode: null,
        totalXp: 0,
        xpEarned: 0
    };

    players.set(id, player);

    // Enviar estado de lobby
    ws.send(JSON.stringify({
        type: 'welcome',
        id,
        gameState,
        players: Array.from(players.values()).map(p => ({
            id: p.id, name: p.name, color: p.color, ready: p.ready,
            squadId: p.squadId, squadSize: p.squadSize, totalXp: p.totalXp || 0
        }))
    }));

    broadcast({
        type: 'playerJoinedLobby',
        player: { id: player.id, name: player.name, color: player.color, ready: false, squadId: null, squadSize: 1 }
    }, id);

    ws.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch (e) { return; }

        const p = players.get(id);
        if (!p) return;

        switch (data.type) {
            // ===== LOBBY =====
            case 'setName':
                p.name = (data.name || `Jugador ${id}`).slice(0, 16);
                broadcastAll({ type: 'nameChange', id, name: p.name });
                break;

            case 'setSquadSize':
                if (gameState !== STATE.LOBBY) break;
                p.squadSize = Math.max(1, Math.min(4, parseInt(data.size) || 1));
                // Si cambia a solo, salir de squad
                if (p.squadSize === 1) {
                    p.squadId = null;
                    p.partyCode = null;
                }
                broadcastAll({ type: 'lobbyUpdate', id, squadSize: p.squadSize, squadId: p.squadId, ready: p.ready });
                break;

            case 'createParty':
                if (gameState !== STATE.LOBBY) break;
                const code = Math.random().toString(36).substring(2, 6).toUpperCase();
                p.partyCode = code;
                p.squadId = 'party_' + code;
                p.squadSize = Math.max(2, Math.min(4, p.squadSize || 2));
                p.ready = false;
                sendTo(id, { type: 'partyCreated', code, squadId: p.squadId });
                broadcastAll({ type: 'lobbyUpdate', id, squadId: p.squadId, squadSize: p.squadSize, ready: false, partyCode: code });
                break;

            case 'joinParty':
                if (gameState !== STATE.LOBBY) break;
                const joinCode = (data.code || '').toUpperCase().slice(0, 6);
                let host = null;
                for (const pl of players.values()) {
                    if (pl.partyCode === joinCode && pl.squadId) { host = pl; break; }
                }
                if (host) {
                    // Contar miembros actuales
                    const members = Array.from(players.values()).filter(x => x.squadId === host.squadId);
                    if (members.length < host.squadSize) {
                        p.squadId = host.squadId;
                        p.partyCode = joinCode;
                        p.squadSize = host.squadSize;
                        p.ready = false;
                        sendTo(id, { type: 'partyJoined', code: joinCode, squadId: p.squadId });
                        broadcastAll({ type: 'lobbyUpdate', id, squadId: p.squadId, squadSize: p.squadSize, ready: false });
                    } else {
                        sendTo(id, { type: 'partyFull' });
                    }
                } else {
                    sendTo(id, { type: 'partyNotFound' });
                }
                break;

            case 'leaveParty':
                p.squadId = null;
                p.partyCode = null;
                p.ready = false;
                broadcastAll({ type: 'lobbyUpdate', id, squadId: null, squadSize: p.squadSize, ready: false });
                break;

            case 'setReady':
                if (gameState !== STATE.LOBBY) break;
                p.ready = !!data.ready;
                broadcastAll({ type: 'lobbyUpdate', id, ready: p.ready, squadId: p.squadId, squadSize: p.squadSize });
                // Auto start si todos listos y >= 1
                const all = Array.from(players.values());
                if (all.length >= 1 && all.every(x => x.ready)) {
                    startCountdown();
                }
                break;

            case 'requestStart':
                // Cualquiera puede pedir start si hay al menos 1 listo
                if (gameState === STATE.LOBBY) startCountdown();
                break;

            case 'playAgain':
                if (gameState === STATE.ENDED) {
                    // Volver a lobby
                    gameState = STATE.LOBBY;
                    for (const pl of players.values()) {
                        pl.ready = false;
                        pl.inMatch = false;
                        pl.alive = true;
                        pl.health = 100;
                        pl.shield = 0;
                    }
                    broadcastAll({ type: 'backToLobby', players: Array.from(players.values()).map(p => ({
                        id: p.id, name: p.name, color: p.color, ready: false,
                        squadId: p.squadId, squadSize: p.squadSize, totalXp: p.totalXp || 0
                    })) });
                }
                break;

            // ===== JUEGO =====
            case 'update':
                if (gameState !== STATE.PLAYING || !p.alive || !p.inMatch) break;
                p.x = data.x;
                p.y = data.y;
                p.angle = data.angle;
                p.emote = data.emote || null;
                p.slot = data.slot || p.slot;
                broadcast({
                    type: 'playerUpdate',
                    id,
                    x: p.x, y: p.y, angle: p.angle,
                    emote: p.emote, health: p.health, shield: p.shield,
                    materials: p.materials, slot: p.slot, weapon: p.weapon
                }, id);
                break;

            case 'shoot':
                if (gameState !== STATE.PLAYING || !p.alive || p.slot !== 2) break;
                broadcast({
                    type: 'shoot',
                    id,
                    x: data.x, y: data.y, angle: data.angle,
                    weapon: p.weapon
                }, id);
                break;

            case 'hit':
                if (gameState !== STATE.PLAYING) break;
                const target = players.get(data.targetId);
                if (!target || !target.alive || !target.inMatch) break;
                // Friendly fire off en escuadrones
                if (p.squadId && target.squadId && p.squadId === target.squadId) break;

                let dmg = data.damage || (p.weapon ? p.weapon.dmg : 20);
                if (target.shield > 0) {
                    const absorbed = Math.min(target.shield, dmg);
                    target.shield -= absorbed;
                    dmg -= absorbed;
                }
                if (dmg > 0) target.health -= dmg;

                if (target.health <= 0) {
                    target.alive = false;
                    target.health = 0;
                    p.kills++;
                    p.materials += 12;
                    // Loot del muerto
                    if (target.weapon && target.weapon.id !== 'pistol') {
                        loot.push({
                            id: nextLootId++,
                            x: target.x + (Math.random() - 0.5) * 30,
                            y: target.y + (Math.random() - 0.5) * 30,
                            type: 'weapon',
                            weapon: { ...target.weapon }
                        });
                        broadcastAll({ type: 'lootSpawn', loot: loot[loot.length - 1] });
                    }
                    broadcastAll({ type: 'playerDied', id: target.id, killerId: id });
                    checkVictory();
                } else {
                    broadcastAll({ type: 'playerDamaged', id: target.id, health: target.health, shield: target.shield });
                }
                break;

            case 'build':
                if (gameState !== STATE.PLAYING || !p.alive || p.materials < 10) break;
                p.materials -= 10;
                const wall = {
                    id: nextWallId++,
                    x: data.x, y: data.y,
                    w: 40, h: 40,
                    health: 120,
                    ownerId: id
                };
                walls.push(wall);
                broadcastAll({ type: 'wallBuilt', wall, materials: p.materials, playerId: id });
                break;

            case 'wallHit':
                if (gameState !== STATE.PLAYING) break;
                const wallIndex = walls.findIndex(w => w.id === data.wallId);
                if (wallIndex !== -1) {
                    walls[wallIndex].health -= data.damage || 20;
                    if (walls[wallIndex].health <= 0) {
                        const removed = walls.splice(wallIndex, 1)[0];
                        broadcastAll({ type: 'wallDestroyed', wallId: removed.id });
                    } else {
                        broadcastAll({ type: 'wallDamaged', wallId: walls[wallIndex].id, health: walls[wallIndex].health });
                    }
                }
                break;

            case 'treeHit':
                if (gameState !== STATE.PLAYING || !p.alive || p.slot !== 1) break;
                const treeIndex = trees.findIndex(t => t.id === data.treeId);
                if (treeIndex !== -1) {
                    trees[treeIndex].health -= 25;
                    if (trees[treeIndex].health <= 0) {
                        const removed = trees.splice(treeIndex, 1)[0];
                        p.materials += 18 + Math.floor(Math.random() * 12);
                        broadcastAll({ type: 'treeDestroyed', treeId: removed.id, playerId: id, materials: p.materials });
                    } else {
                        broadcastAll({ type: 'treeDamaged', treeId: trees[treeIndex].id, health: trees[treeIndex].health });
                    }
                }
                break;

            case 'pickup':
                if (gameState !== STATE.PLAYING || !p.alive) break;
                const li = loot.findIndex(l => l.id === data.lootId);
                if (li === -1) break;
                const item = loot[li];
                const dx = p.x - item.x, dy = p.y - item.y;
                if (Math.hypot(dx, dy) > 45) break;

                if (item.type === 'weapon') {
                    p.weapon = { ...item.weapon };
                    broadcastAll({ type: 'weaponPickup', id, weapon: p.weapon });
                } else if (item.type === 'shield') {
                    p.shield = Math.min(100, p.shield + (item.amount || 30));
                    broadcastAll({ type: 'playerDamaged', id, health: p.health, shield: p.shield });
                } else if (item.type === 'materials') {
                    p.materials += item.amount || 20;
                }
                loot.splice(li, 1);
                broadcastAll({ type: 'lootRemoved', lootId: item.id, playerId: id, materials: p.materials });
                break;

            case 'chat':
                broadcastAll({
                    type: 'chat',
                    id,
                    name: p.name,
                    message: (data.message || '').slice(0, 100)
                });
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Jugador desconectado: #${id}`);
        const wasInMatch = players.get(id)?.inMatch;
        players.delete(id);
        broadcastAll({ type: 'playerLeft', id });
        if (wasInMatch && gameState === STATE.PLAYING) checkVictory();
        // Si se vacía el lobby
        if (players.size === 0) {
            gameState = STATE.LOBBY;
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`  PixelRoyale Battle Royale Server`);
    console.log(`  Puerto: ${PORT}`);
    console.log(`  Estados: Lobby → Countdown → Playing → Ended`);
    console.log(`========================================`);
});
