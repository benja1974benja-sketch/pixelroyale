const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

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

const players = new Map();
const walls = [];
const trees = [];
let nextId = 1;
let nextWallId = 1;
let nextTreeId = 1;

const WORLD = 2000;

// Generar árboles al inicio
for (let i = 0; i < 45; i++) {
    trees.push({
        id: nextTreeId++,
        x: 100 + Math.random() * (WORLD - 200),
        y: 100 + Math.random() * (WORLD - 200),
        health: 80,
        maxHealth: 80,
        radius: 18
    });
}

function broadcast(data, exceptId = null) {
    const msg = JSON.stringify(data);
    for (const [id, player] of players) {
        if (id !== exceptId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(msg);
        }
    }
}

function broadcastAll(data) {
    const msg = JSON.stringify(data);
    for (const [, player] of players) {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(msg);
        }
    }
}

wss.on('connection', (ws) => {
    const id = nextId++;
    console.log(`Jugador conectado: #${id}`);

    const spawnX = 400 + Math.random() * (WORLD - 800);
    const spawnY = 400 + Math.random() * (WORLD - 800);

    const player = {
        id,
        ws,
        x: spawnX,
        y: spawnY,
        angle: 0,
        health: 100,
        shield: 0,
        materials: 30,
        color: `hsl(${Math.random() * 360}, 70%, 55%)`,
        name: `Jugador ${id}`,
        emote: null,
        alive: true,
        kills: 0,
        slot: 2 // 1 = pico, 2 = arma
    };

    players.set(id, player);

    ws.send(JSON.stringify({
        type: 'welcome',
        id: id,
        players: Array.from(players.values()).map(p => ({
            id: p.id, x: p.x, y: p.y, angle: p.angle,
            health: p.health, shield: p.shield, materials: p.materials,
            color: p.color, name: p.name, emote: p.emote, alive: p.alive, slot: p.slot
        })),
        walls: walls,
        trees: trees
    }));

    broadcast({
        type: 'playerJoined',
        player: {
            id: player.id, x: player.x, y: player.y, angle: player.angle,
            health: player.health, shield: player.shield, materials: player.materials,
            color: player.color, name: player.name, emote: null, alive: true, slot: 2
        }
    }, id);

    ws.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch (e) { return; }

        const p = players.get(id);
        if (!p || !p.alive) return;

        switch (data.type) {
            case 'update':
                p.x = data.x;
                p.y = data.y;
                p.angle = data.angle;
                p.emote = data.emote || null;
                p.slot = data.slot || p.slot;
                broadcast({
                    type: 'playerUpdate',
                    id: id,
                    x: p.x, y: p.y, angle: p.angle,
                    emote: p.emote, health: p.health, shield: p.shield,
                    materials: p.materials, slot: p.slot
                }, id);
                break;

            case 'shoot':
                if (p.slot === 2) {
                    broadcast({
                        type: 'shoot',
                        id: id,
                        x: data.x, y: data.y, angle: data.angle
                    }, id);
                }
                break;

            case 'hit':
                const target = players.get(data.targetId);
                if (target && target.alive) {
                    let dmg = data.damage || 20;
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
                        p.materials += 15;
                        broadcastAll({
                            type: 'playerDied',
                            id: target.id,
                            killerId: id
                        });
                    } else {
                        broadcastAll({
                            type: 'playerDamaged',
                            id: target.id,
                            health: target.health,
                            shield: target.shield
                        });
                    }
                }
                break;

            case 'build':
                if (p.materials >= 10) {
                    p.materials -= 10;
                    const wall = {
                        id: nextWallId++,
                        x: data.x, y: data.y,
                        w: 40, h: 40,
                        health: 120,
                        ownerId: id
                    };
                    walls.push(wall);
                    broadcastAll({
                        type: 'wallBuilt',
                        wall: wall,
                        materials: p.materials,
                        playerId: id
                    });
                }
                break;

            case 'wallHit':
                const wallIndex = walls.findIndex(w => w.id === data.wallId);
                if (wallIndex !== -1) {
                    walls[wallIndex].health -= data.damage || 20;
                    if (walls[wallIndex].health <= 0) {
                        const removed = walls.splice(wallIndex, 1)[0];
                        broadcastAll({ type: 'wallDestroyed', wallId: removed.id });
                    } else {
                        broadcastAll({
                            type: 'wallDamaged',
                            wallId: walls[wallIndex].id,
                            health: walls[wallIndex].health
                        });
                    }
                }
                break;

            case 'treeHit':
                // Pico golpeando árbol
                const treeIndex = trees.findIndex(t => t.id === data.treeId);
                if (treeIndex !== -1 && p.slot === 1) {
                    trees[treeIndex].health -= 25;
                    if (trees[treeIndex].health <= 0) {
                        const removed = trees.splice(treeIndex, 1)[0];
                        p.materials += 20 + Math.floor(Math.random() * 15);
                        broadcastAll({
                            type: 'treeDestroyed',
                            treeId: removed.id,
                            playerId: id,
                            materials: p.materials
                        });
                    } else {
                        broadcastAll({
                            type: 'treeDamaged',
                            treeId: trees[treeIndex].id,
                            health: trees[treeIndex].health,
                            playerId: id
                        });
                    }
                }
                break;

            case 'chat':
                broadcastAll({
                    type: 'chat',
                    id: id,
                    name: p.name,
                    message: (data.message || '').slice(0, 100)
                });
                break;

            case 'setName':
                p.name = (data.name || `Jugador ${id}`).slice(0, 16);
                broadcastAll({
                    type: 'nameChange',
                    id: id,
                    name: p.name
                });
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Jugador desconectado: #${id}`);
        players.delete(id);
        broadcastAll({ type: 'playerLeft', id: id });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`  PixelRoyale Multiplayer Server`);
    console.log(`  Puerto: ${PORT}`);
    console.log(`========================================`);
});
