const WebSocket = require('ws');
const server = new WebSocket.Server({ port: process.env.PORT || 3000 });

let waitingPlayers = [];
let games = [];
let playerId = 0;

console.log('🎮 Chess Server Started!');

server.on('connection', (socket) => {
    const player = {
        id: ++playerId,
        socket: socket,
        isConnected: true,
        pingInterval: null
    };
    
    console.log(`✅ Player ${player.id} connected`);
    
    // راه‌اندازی پینگ
    player.pingInterval = setInterval(() => {
        if (player.isConnected && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping', time: Date.now() }));
        }
    }, 1000);
    
    // پاسخ به پینگ
    socket.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'pong') {
                const ping = Date.now() - message.time;
                socket.send(JSON.stringify({ type: 'ping_result', ping: ping }));
            }
            else if (message.type === 'search') {
                handleSearch(player);
            }
            else if (message.type === 'move') {
                handleMove(player, message.data);
            }
            else if (message.type === 'chat') {
                handleChat(player, message.message);
            }
        } catch(e) { console.log('Error:', e); }
    });
    
    socket.on('close', () => {
        console.log(`❌ Player ${player.id} disconnected`);
        player.isConnected = false;
        clearInterval(player.pingInterval);
        handleDisconnect(player);
    });
});

function handleSearch(player) {
    if (waitingPlayers.length > 0) {
        const opponent = waitingPlayers.shift();
        const gameId = Date.now();
        
        games.push({
            id: gameId,
            white: opponent,
            black: player,
            isActive: true
        });
        
        opponent.socket.send(JSON.stringify({ type: 'role', color: 'white' }));
        player.socket.send(JSON.stringify({ type: 'role', color: 'black' }));
        
        opponent.socket.send(JSON.stringify({ type: 'start' }));
        player.socket.send(JSON.stringify({ type: 'start' }));
        
        console.log(`🎯 Game started: White=${opponent.id}, Black=${player.id}`);
    } else {
        waitingPlayers.push(player);
        player.socket.send(JSON.stringify({ type: 'search_start' }));
        console.log(`🔍 Player ${player.id} is waiting...`);
    }
}

function handleMove(player, moveData) {
    const game = games.find(g => (g.white === player || g.black === player) && g.isActive);
    if (game) {
        const opponent = game.white === player ? game.black : game.white;
        if (opponent && opponent.isConnected) {
            opponent.socket.send(JSON.stringify({ type: 'move', data: moveData }));
        }
    }
}

function handleChat(player, message) {
    const game = games.find(g => (g.white === player || g.black === player) && g.isActive);
    if (game) {
        const opponent = game.white === player ? game.black : game.white;
        if (opponent && opponent.isConnected) {
            opponent.socket.send(JSON.stringify({ type: 'chat', message: message }));
        }
    }
}

function handleDisconnect(player) {
    waitingPlayers = waitingPlayers.filter(p => p !== player);
    
    const game = games.find(g => (g.white === player || g.black === player));
    if (game) {
        game.isActive = false;
        const opponent = game.white === player ? game.black : game.white;
        if (opponent && opponent.isConnected) {
            opponent.socket.send(JSON.stringify({ type: 'opponent_left' }));
        }
        games = games.filter(g => g !== game);
    }
}