const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Crear servidor HTTP simple para servir el cliente también
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

// Estado del juego en el servidor
const players = new Map(); // id -> player data
let nextId = 1;

// Mundo
const WORLD = 2000;

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

    // Posición inicial aleatoria
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
        kills: 0
    };

    players.set(id, player);

    // Enviar al nuevo jugador su ID y lista de jugadores actuales
    ws.send(JSON.stringify({
        type: 'welcome',
        id: id,
        players: Array.from(players.values()).map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            angle: p.angle,
            health: p.health,
            shield: p.shield,
            color: p.color,
            name: p.name,
            emote: p.emote,
            alive: p.alive
        }))
    }));

    // Avisar a los demás que entró alguien
    broadcast({
        type: 'playerJoined',
        player: {
            id: player.id,
            x: player.x,
            y: player.y,
            angle: player.angle,
            health: player.health,
            shield: player.shield,
            color: player.color,
            name: player.name,
            emote: null,
            alive: true
        }
    }, id);

    ws.on('message', (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return;
        }

        const p = players.get(id);
        if (!p || !p.alive) return;

        switch (data.type) {
            case 'update':
                // Actualizar posición y estado
                p.x = data.x;
                p.y = data.y;
                p.angle = data.angle;
                p.emote = data.emote || null;
                // Reenviar a los demás
                broadcast({
                    type: 'playerUpdate',
                    id: id,
                    x: p.x,
                    y: p.y,
                    angle: p.angle,
                    emote: p.emote,
                    health: p.health,
                    shield: p.shield
                }, id);
                break;

            case 'shoot':
                broadcast({
                    type: 'shoot',
                    id: id,
                    x: data.x,
                    y: data.y,
                    angle: data.angle
                }, id);
                break;

            case 'hit':
                // Alguien dice que impactó a otro jugador
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
        broadcastAll({
            type: 'playerLeft',
            id: id
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`  PixelRoyale Multiplayer Server`);
    console.log(`========================================`);
    console.log(`  En este ordenador:  http://localhost:${PORT}`);
    console.log(`  En el cole (misma WiFi):`);
    console.log(`  http://TU-IP:${PORT}`);
    console.log(`========================================`);
    console.log(`Para ver tu IP escribe en otra terminal: ipconfig`);
    console.log(`Busca la linea "IPv4" (ejemplo: 192.168.1.12)`);
});
