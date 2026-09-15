"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

/* =========================================================
   CONFIG
========================================================= */

const PORT =
  process.env.PORT || 3000;

const WORLD_SIZE = 2400;

const MAX_POSITION_DELTA = 30;

const STATE_INTERVAL = 50;

/* =========================================================
   HTTP SERVER
========================================================= */

const server =
  http.createServer((req,res) => {

    let filePath;

    if(
      req.url === "/" ||
      req.url === "/index.html"
    ){

      filePath =
        path.join(
          __dirname,
          "client.html"
        );

    }else{

      res.writeHead(404);
      res.end("Not found");
      return;
    }

    fs.readFile(
      filePath,
      (err,data) => {

        if(err){

          res.writeHead(500);
          res.end(
            "Error loading client.html"
          );

          return;
        }

        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8"
          }
        );

        res.end(data);
      }
    );
  });

/* =========================================================
   WEBSOCKET
========================================================= */

const wss =
  new WebSocket.Server({
    server
  });

/* =========================================================
   DATA
========================================================= */

const players =
  new Map();

const parties =
  new Map();

let nextPlayerId = 1;

let nextBulletId = 1;

let nextWallId = 1;

/* =========================================================
   UTIL
========================================================= */

function randomId(prefix){

  return (
    prefix +
    Math.random()
      .toString(36)
      .slice(2,9)
  );
}

function randomSpawn(){

  return {
    x:
      100 +
      Math.random() *
      (WORLD_SIZE - 200),

    y:
      100 +
      Math.random() *
      (WORLD_SIZE - 200)
  };
}

function clamp(value,min,max){

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function distance(
  x1,
  y1,
  x2,
  y2
){

  return Math.hypot(
    x2 - x1,
    y2 - y1
  );
}

/* =========================================================
   CREATE PLAYER
========================================================= */

function createPlayer(ws,name){

  const spawn =
    randomSpawn();

  const player = {

    id:
      "p" +
      nextPlayerId++,

    ws,

    name:
      String(name || "Player")
        .slice(0,16),

    x:
      spawn.x,

    y:
      spawn.y,

    angle:0,

    hp:100,

    shield:0,

    weapon:"rifle",

    ammo:30,

    maxAmmo:30,

    kills:0,

    alive:true,

    moving:false,

    team:null,

    partyCode:null,

    ready:false,

    isHost:false
  };

  players.set(
    ws,
    player
  );

  return player;
}

/* =========================================================
   SEND
========================================================= */

function send(ws,data){

  if(
    ws &&
    ws.readyState ===
    WebSocket.OPEN
  ){

    try{
      ws.send(
        JSON.stringify(data)
      );
    }catch(e){}
  }
}

/* =========================================================
   PARTY CODE
========================================================= */

function generatePartyCode(){

  let code;

  do{

    code =
      Math.random()
        .toString(36)
        .substring(2,8)
        .toUpperCase();

  }while(parties.has(code));

  return code;
}

/* =========================================================
   CREATE PARTY
========================================================= */

function createParty(
  player,
  teamMode
){

  const code =
    generatePartyCode();

  const party = {

    code,

    hostId:
      player.id,

    teamMode:
      teamMode || "solo",

    started:false,

    players:
      new Set()
  };

  party.players.add(
    player.id
  );

  parties.set(
    code,
    party
  );

  player.partyCode =
    code;

  player.isHost =
    true;

  player.ready =
    true;

  sendPartyState(
    party
  );

  return party;
}

/* =========================================================
   FIND PLAYER BY ID
========================================================= */

function getPlayerById(id){

  for(
    const player of players.values()
  ){

    if(player.id === id){
      return player;
    }
  }

  return null;
}

/* =========================================================
   JOIN PARTY
========================================================= */

function joinParty(
  player,
  code
){

  const party =
    parties.get(
      String(code || "")
        .toUpperCase()
    );

  if(!party){

    send(player.ws,{
      type:"error",
      message:
        "No existe esa partida."
    });

    return;
  }

  if(party.started){

    send(player.ws,{
      type:"error",
      message:
        "La partida ya empezó."
    });

    return;
  }

  if(party.players.size >= 16){

    send(player.ws,{
      type:"error",
      message:
        "La sala está llena."
    });

    return;
  }

  player.partyCode =
    party.code;

  player.ready =
    false;

  player.isHost =
    false;

  party.players.add(
    player.id
  );

  sendPartyState(
    party
  );
}

/* =========================================================
   PARTY STATE
========================================================= */

function sendPartyState(party){

  if(!party) return;

  const list = [];

  party.players.forEach(
    playerId => {

      const p =
        getPlayerById(
          playerId
        );

      if(p){

        list.push({
          id:p.id,
          name:p.name,
          ready:p.ready
        });
      }
    }
  );

  party.players.forEach(
    playerId => {

      const p =
        getPlayerById(
          playerId
        );

      if(!p) return;

      send(p.ws,{
        type:"party",
        code:party.code,
        hostId:party.hostId,
        players:list
      });
    }
  );
}

/* =========================================================
   REMOVE FROM PARTY
========================================================= */

function removeFromParty(
  player
){

  if(!player.partyCode){
    return;
  }

  const party =
    parties.get(
      player.partyCode
    );

  if(!party){

    player.partyCode =
      null;

    return;
  }

  party.players.delete(
    player.id
  );

  player.partyCode =
    null;

  player.ready =
    false;

  player.isHost =
    false;

  if(
    party.players.size === 0
  ){

    parties.delete(
      party.code
    );

    return;
  }

  if(
    party.hostId === player.id
  ){

    const next =
      party.players.values()
        .next()
        .value;

    party.hostId =
      next || null;

    const newHost =
      getPlayerById(
        party.hostId
      );

    if(newHost){
      newHost.isHost = true;
      newHost.ready = true;
    }
  }

  sendPartyState(
    party
  );
}

/* =========================================================
   READY
========================================================= */

function toggleReady(player){

  player.ready =
    !player.ready;

  const party =
    parties.get(
      player.partyCode
    );

  if(party){

    sendPartyState(
      party
    );
  }
}

/* =========================================================
   CAN START
========================================================= */

function canStart(party){

  if(!party) return false;

  if(
    party.players.size < 1
  ){
    return false;
  }

  for(
    const id of party.players
  ){

    const p =
      getPlayerById(id);

    if(
      p &&
      !p.ready
    ){
      return false;
    }
  }

  return true;
}

/* =========================================================
   START PARTY
========================================================= */

function startParty(party){

  if(!party) return;

  if(
    party.started
  ){
    return;
  }

  if(!canStart(party)){

    const host =
      getPlayerById(
        party.hostId
      );

    if(host){

      send(host.ws,{
        type:"error",
        message:
          "Todos los jugadores deben estar listos."
      });
    }

    return;
  }

  party.started =
    true;

  party.players.forEach(
    id => {

      const p =
        getPlayerById(id);

      if(!p) return;

      p.alive = true;
      p.hp = 100;
      p.shield = 0;
      p.ammo = p.maxAmmo;
      p.kills = 0;

      const spawn =
        randomSpawn();

      p.x = spawn.x;
      p.y = spawn.y;

      p.moving = false;

      send(p.ws,{
        type:"countdown",
        value:3
      });
    }
  );

  setTimeout(() => {

    party.players.forEach(
      id => {

        const p =
          getPlayerById(id);

        if(!p) return;

        send(p.ws,{
          type:"countdown",
          value:2
        });
      }

    );

  },1000);

  setTimeout(() => {

    party.players.forEach(
      id => {

        const p =
          getPlayerById(id);

        if(!p) return;

        send(p.ws,{
          type:"countdown",
          value:1
        });
      }

    );

  },2000);

  setTimeout(() => {

    party.players.forEach(
      id => {

        const p =
          getPlayerById(id);

        if(!p) return;

        send(p.ws,{
          type:"countdown",
          value:0
        });

        send(p.ws,{
          type:"start",
          player:{
            id:p.id,
            name:p.name,
            x:p.x,
            y:p.y,
            hp:p.hp,
            shield:p.shield,
            ammo:p.ammo,
            weapon:p.weapon,
            angle:p.angle,
            alive:p.alive
          }
        });
      }

    );

  },3000);
}

/* =========================================================
   UPDATE PLAYER
========================================================= */

function updatePlayer(
  player,
  data
){

  if(!player) return;

  if(
    typeof data.x === "number" &&
    typeof data.y === "number"
  ){

    const targetX =
      clamp(
        data.x,
        30,
        WORLD_SIZE - 30
      );

    const targetY =
      clamp(
        data.y,
        30,
        WORLD_SIZE - 30
      );

    const dx =
      targetX - player.x;

    const dy =
      targetY - player.y;

    const delta =
      Math.hypot(dx,dy);

    /*
     * El cliente manda cada 40ms.
     *
     * Con 225 px/s:
     *
     * 225 × 0.04 = 9 px
     *
     * Permitimos hasta 30px por mensaje.
     */

    if(
      delta <=
      MAX_POSITION_DELTA
    ){

      player.x =
        targetX;

      player.y =
        targetY;

      player.moving =
        delta > 0.1;
    }
  }

  if(
    typeof data.angle === "number" &&
    Number.isFinite(data.angle)
  ){

    player.angle =
      data.angle;
  }
}

/* =========================================================
   SHOOT
========================================================= */

function shoot(player){

  if(
    !player ||
    !player.alive
  ){
    return;
  }

  if(
    player.ammo <= 0
  ){

    send(player.ws,{
      type:"error",
      message:"Sin munición."
    });

    return;
  }

  player.ammo--;

  const bulletSpeed =
    900;

  const bullet = {

    id:
      nextBulletId++,

    ownerId:
      player.id,

    x:
      player.x +
      Math.cos(player.angle) *
      28,

    y:
      player.y +
      Math.sin(player.angle) *
      28,

    vx:
      Math.cos(player.angle) *
      bulletSpeed,

    vy:
      Math.sin(player.angle) *
      bulletSpeed,

    damage:
      20,

    life:
      1000
  };

  bullets.push(
    bullet
  );
}

/* =========================================================
   RELOAD
========================================================= */

function reload(player){

  if(!player) return;

  player.ammo =
    player.maxAmmo;
}

/* =========================================================
   BULLETS
========================================================= */

const bullets = [];

function updateBullets(deltaMs){

  const delta =
    deltaMs / 1000;

  for(
    let i = bullets.length - 1;
    i >= 0;
    i--
  ){

    const b =
      bullets[i];

    b.x +=
      b.vx * delta;

    b.y +=
      b.vy * delta;

    b.life -=
      deltaMs;

    let remove = false;

    if(
      b.life <= 0 ||
      b.x < 0 ||
      b.y < 0 ||
      b.x > WORLD_SIZE ||
      b.y > WORLD_SIZE
    ){

      remove = true;
    }

    if(!remove){

      for(
        const player of players.values()
      ){

        if(
          !player.alive ||
          player.id === b.ownerId
        ){
          continue;
        }

        if(
          distance(
            b.x,
            b.y,
            player.x,
            player.y
          ) < 24
        ){

          damagePlayer(
            player,
            b.damage,
            b.ownerId
          );

          remove = true;
          break;
        }
      }
    }

    if(remove){
      bullets.splice(i,1);
    }
  }
}

/* =========================================================
   DAMAGE
========================================================= */

function damagePlayer(
  player,
  damage,
  attackerId
){

  let remaining =
    damage;

  if(player.shield > 0){

    const shieldDamage =
      Math.min(
        player.shield,
        remaining
      );

    player.shield -=
      shieldDamage;

    remaining -=
      shieldDamage;
  }

  if(remaining > 0){

    player.hp -=
      remaining;
  }

  if(
    player.hp <= 0
  ){

    player.hp = 0;

    killPlayer(
      player,
      attackerId
    );
  }
}

/* =========================================================
   KILL
========================================================= */

function killPlayer(
  player,
  killerId
){

  if(!player.alive){
    return;
  }

  player.alive =
    false;

  player.moving =
    false;

  const killer =
    getPlayerById(
      killerId
    );

  if(killer){

    killer.kills++;

    send(killer.ws,{
      type:"kill",
      killerId:killer.id,
      victimId:player.id
    });
  }

  checkWinner(
    player.partyCode
  );
}

/* =========================================================
   WINNER
========================================================= */

function checkWinner(
  partyCode
){

  const party =
    parties.get(
      partyCode
    );

  if(!party) return;

  const alive = [];

  party.players.forEach(
    id => {

      const p =
        getPlayerById(id);

      if(
        p &&
        p.alive
      ){

        alive.push(p);
      }
    }
  );

  if(
    alive.length <= 1
  ){

    const winner =
      alive[0];

    party.players.forEach(
      id => {

        const p =
          getPlayerById(id);

        if(!p) return;

        send(p.ws,{
          type:"end",
          winnerName:
            winner
              ? winner.name
              : "Nadie"
        });
      }
    );
  }
}

/* =========================================================
   BUILD
========================================================= */

const walls = [];

function build(player){

  if(!player) return;

  const distanceFromPlayer =
    70;

  const wall = {

    id:
      nextWallId++,

    x:
      player.x +
      Math.cos(player.angle) *
      distanceFromPlayer -
      30,

    y:
      player.y +
      Math.sin(player.angle) *
      distanceFromPlayer -
      30,

    width:60,
    height:60,

    ownerId:
      player.id
  };

  wall.x =
    clamp(
      wall.x,
      0,
      WORLD_SIZE - wall.width
    );

  wall.y =
    clamp(
      wall.y,
      0,
      WORLD_SIZE - wall.height
    );

  walls.push(
    wall
  );

  /*
   * Limitar la cantidad de construcciones
   * por jugador.
   */

  const mine =
    walls.filter(
      w =>
        w.ownerId === player.id
    );

  if(mine.length > 20){

    const first =
      mine[0];

    const index =
      walls.indexOf(first);

    if(index !== -1){
      walls.splice(index,1);
    }
  }
}

/* =========================================================
   PICKAXE
========================================================= */

function pickaxe(player){

  if(!player) return;

  const range = 75;

  for(
    let i = walls.length - 1;
    i >= 0;
    i--
  ){

    const wall =
      walls[i];

    const centerX =
      wall.x +
      wall.width / 2;

    const centerY =
      wall.y +
      wall.height / 2;

    if(
      distance(
        player.x,
        player.y,
        centerX,
        centerY
      ) <= range
    ){

      walls.splice(i,1);
      return;
    }
  }
}

/* =========================================================
   LOOT
========================================================= */

const loot = [];

function pickup(player){

  if(!player) return;

  for(
    let i = loot.length - 1;
    i >= 0;
    i--
  ){

    const item =
      loot[i];

    if(
      distance(
        player.x,
        player.y,
        item.x,
        item.y
      ) <= 70
    ){

      if(item.type === "ammo"){

        player.ammo =
          Math.min(
            player.maxAmmo,
            player.ammo +
            (item.amount || 10)
          );
      }

      if(item.type === "shield"){

        player.shield =
          Math.min(
            100,
            player.shield +
            (item.amount || 25)
          );
      }

      loot.splice(i,1);

      return;
    }
  }
}

/* =========================================================
   CHAT
========================================================= */

function chat(
  player,
  message
){

  if(!player) return;

  message =
    String(message || "")
      .trim()
      .slice(0,100);

  if(!message) return;

  const party =
    parties.get(
      player.partyCode
    );

  if(!party) return;

  party.players.forEach(
    id => {

      const p =
        getPlayerById(id);

      if(!p) return;

      send(p.ws,{
        type:"chat",
        name:player.name,
        message
      });
    }
  );
}

/* =========================================================
   EMOTE
========================================================= */

function emote(
  player,
  value
){

  if(!player) return;

  const party =
    parties.get(
      player.partyCode
    );

  if(!party) return;

  party.players.forEach(
    id => {

      const p =
        getPlayerById(id);

      if(!p) return;

      send(p.ws,{
        type:"chat",
        name:player.name,
        message:
          String(value || "")
            .slice(0,8)
      });
    }
  );
}

/* =========================================================
   STATE
========================================================= */

function createState(
  partyCode
){

  const party =
    parties.get(
      partyCode
    );

  if(!party){

    return {
      players:[],
      bullets:[],
      loot:[],
      walls:[]
    };
  }

  const statePlayers = [];

  party.players.forEach(
    id => {

      const p =
        getPlayerById(id);

      if(!p) return;

      statePlayers.push({

        id:p.id,

        name:p.name,

        x:p.x,

        y:p.y,

        angle:p.angle,

        hp:p.hp,

        shield:p.shield,

        weapon:p.weapon,

        ammo:p.ammo,

        kills:p.kills,

        alive:p.alive,

        moving:p.moving,

        team:p.team
      });
    }
  );

  return {

    players:
      statePlayers,

    bullets:
      bullets.map(b => ({
        id:b.id,
        ownerId:b.ownerId,
        x:b.x,
        y:b.y
      })),

    loot:
      loot.map(item => ({
        id:item.id,
        type:item.type,
        x:item.x,
        y:item.y,
        amount:item.amount
      })),

    walls:
      walls.map(w => ({
        id:w.id,
        x:w.x,
        y:w.y,
        width:w.width,
        height:w.height,
        ownerId:w.ownerId
      }))
  };
}

/* =========================================================
   BROADCAST STATES
========================================================= */

function broadcastStates(){

  const partyStates =
    new Map();

  for(
    const player of players.values()
  ){

    if(!player.partyCode){
      continue;
    }

    if(
      !partyStates.has(
        player.partyCode
      )
    ){

      partyStates.set(
        player.partyCode,
        createState(
          player.partyCode
        )
      );
    }

    send(
      player.ws,
      {
        type:"state",
        ...partyStates.get(
          player.partyCode
        )
      }
    );

    /*
     * Después de mandar el estado,
     * el flag moving vuelve a false.
     *
     * El cliente local sigue sabiendo si se
     * está moviendo por sus propios controles.
     */

    player.moving = false;
  }
}

/* =========================================================
   WEBSOCKET MESSAGE
========================================================= */

wss.on(
  "connection",
  ws => {

    const player =
      createPlayer(
        ws,
        "Player"
      );

    send(ws,{
      type:"joined",
      player:{
        id:player.id,
        name:player.name,
        x:player.x,
        y:player.y,
        hp:player.hp,
        shield:player.shield,
        ammo:player.ammo,
        weapon:player.weapon,
        angle:player.angle,
        alive:player.alive
      }
    });

    ws.on(
      "message",
      raw => {

        let data;

        try{

          data =
            JSON.parse(
              raw.toString()
            );

        }catch(e){

          return;
        }

        switch(data.type){

          /* -------------------------
             CREATE PARTY
          ------------------------- */

          case "createParty":{

            if(player.partyCode){
              removeFromParty(player);
            }

            player.name =
              String(
                data.name ||
                "Player"
              ).slice(0,16);

            createParty(
              player,
              data.teamMode
            );

            break;
          }

          /* -------------------------
             JOIN PARTY
          ------------------------- */

          case "joinParty":{

            player.name =
              String(
                data.name ||
                "Player"
              ).slice(0,16);

            joinParty(
              player,
              data.code
            );

            break;
          }

          /* -------------------------
             READY
          ------------------------- */

          case "ready":

            toggleReady(
              player
            );

            break;

          /* -------------------------
             START
          ------------------------- */

          case "start":{

            const party =
              parties.get(
                player.partyCode
              );

            if(
              party &&
              party.hostId ===
              player.id
            ){

              startParty(
                party
              );
            }

            break;
          }

          /* -------------------------
             LEAVE
          ------------------------- */

          case "leaveParty":

            removeFromParty(
              player
            );

            break;

          /* -------------------------
             UPDATE
          ------------------------- */

          case "update":

            updatePlayer(
              player,
              data
            );

            break;

          /* -------------------------
             SHOOT
          ------------------------- */

          case "shoot":

            if(
              typeof data.angle ===
              "number"
            ){

              player.angle =
                data.angle;
            }

            shoot(
              player
            );

            break;

          /* -------------------------
             RELOAD
          ------------------------- */

          case "reload":

            reload(
              player
            );

            break;

          /* -------------------------
             BUILD
          ------------------------- */

          case "build":

            build(
              player
            );

            break;

          /* -------------------------
             PICKAXE
          ------------------------- */

          case "pickaxe":

            if(
              typeof data.angle ===
              "number"
            ){

              player.angle =
                data.angle;
            }

            pickaxe(
              player
            );

            break;

          /* -------------------------
             PICKUP
          ------------------------- */

          case "pickup":

            pickup(
              player
            );

            break;

          /* -------------------------
             CHAT
          ------------------------- */

          case "chat":

            chat(
              player,
              data.message
            );

            break;

          /* -------------------------
             EMOTE
          ------------------------- */

          case "emote":

            emote(
              player,
              data.emote
            );

            break;

          /* -------------------------
             PING
          ------------------------- */

          case "ping":

            send(ws,{
              type:"pong",
              clientTime:
                data.clientTime
            });

            break;
        }
      }
    );

    /* =====================================================
       CLOSE
    ===================================================== */

    ws.on(
      "close",
      () => {

        removeFromParty(
          player
        );

        players.delete(
          ws
        );
      }
    );

    ws.on(
      "error",
      () => {

        removeFromParty(
          player
        );

        players.delete(
          ws
        );
      }
    );
  }
);

/* =========================================================
   GAME LOOP
========================================================= */

let lastGameUpdate =
  Date.now();

setInterval(
  () => {

    const now =
      Date.now();

    const delta =
      now - lastGameUpdate;

    lastGameUpdate =
      now;

    updateBullets(
      delta
    );

    broadcastStates();

  },
  STATE_INTERVAL
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
  PORT,
  () => {

    console.log(
      "================================="
    );

    console.log(
      " PIXEL ROYALE SERVER"
    );

    console.log(
      " Server running on port " +
      PORT
    );

    console.log(
      " http://localhost:" +
      PORT
    );

    console.log(
      "================================="
    );
  }
);
