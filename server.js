const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// =====================================================
// سرور بازی ریاضی آنلاین دو نفره - نسخه فوق پیشرفته
// با قابلیت: مچ میکینگ، پینگ، reconnect، اتاق‌ها، چت
// =====================================================

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Math Game Server Running');
});

const wss = new WebSocket.Server({ server });

// ==================== داده‌های سرور ====================
let waitingPlayers = [];
let activeGames = new Map();
let players = new Map();
let playerId = 0;
let roomId = 0;

// آمار سرور
let stats = {
    totalConnections: 0,
    activeConnections: 0,
    totalGames: 0,
    activeGames: 0
};

console.log('🎮 Math Game Server Started on port', PORT);
console.log('📡 Waiting for connections...');

// ==================== کلاس Player ====================
class Player {
    constructor(socket) {
        this.id = ++playerId;
        this.socket = socket;
        this.roomId = null;
        this.isConnected = true;
        this.color = null;
        this.score = 0;
        this.ping = 0;
        this.lastPing = Date.now();
        this.pingInterval = null;
        this.heartbeatInterval = null;
        this.joinTime = Date.now();
        this.ip = socket._socket.remoteAddress;
    }
    
    send(data) {
        if (this.isConnected && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
            return true;
        }
        return false;
    }
    
    disconnect() {
        this.isConnected = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    }
}

// ==================== کلاس GameRoom ====================
class GameRoom {
    constructor(player1, player2) {
        this.id = ++roomId;
        this.player1 = player1;
        this.player2 = player2;
        this.createdAt = Date.now();
        this.status = 'playing';
        this.round = 1;
        this.scores = { [player1.id]: 0, [player2.id]: 0 };
        
        player1.roomId = this.id;
        player2.roomId = this.id;
        player1.color = 'white';
        player2.color = 'black';
        
        stats.activeGames++;
        stats.totalGames++;
        activeGames.set(this.id, this);
    }
    
    getOpponent(player) {
        return player.id === this.player1.id ? this.player2 : this.player1;
    }
    
    updateScore(player, score) {
        this.scores[player.id] = score;
    }
    
    end() {
        this.status = 'ended';
        activeGames.delete(this.id);
        stats.activeGames--;
    }
    
    broadcast(data, excludePlayer = null) {
        if (this.player1 !== excludePlayer) this.player1.send(data);
        if (this.player2 !== excludePlayer) this.player2.send(data);
    }
}

// ==================== WebSocket Connection ====================
wss.on('connection', (socket, req) => {
    const player = new Player(socket);
    players.set(player.id, player);
    stats.totalConnections++;
    stats.activeConnections++;
    
    console.log(`✅ Player ${player.id} connected [Total: ${stats.activeConnections}]`);
    
    // ارسال ID به کلاینت
    player.send({ type: 'connected', id: player.id });
    
    // ========== راه‌اندازی پینگ (هر 1 ثانیه) ==========
    player.pingInterval = setInterval(() => {
        if (player.isConnected && socket.readyState === WebSocket.OPEN) {
            const pingTime = Date.now();
            player.lastPing = pingTime;
            player.send({ type: 'ping', time: pingTime });
        }
    }, 1000);
    
    // ========== راه‌اندازی هارت‌بیت (هر 5 ثانیه) ==========
    player.heartbeatInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastPing = now - player.lastPing;
        
        if (timeSinceLastPing > 10000) {
            console.log(`⚠️ Player ${player.id} timeout (${timeSinceLastPing}ms)`);
            handleDisconnect(player);
        }
    }, 5000);
    
    // ========== مدیریت پیام‌ها ==========
    socket.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(player, message);
        } catch (e) {
            console.log(`❌ Player ${player.id} invalid message:`, e.message);
        }
    });
    
    socket.on('close', () => {
        console.log(`❌ Player ${player.id} disconnected`);
        handleDisconnect(player);
    });
    
    socket.on('error', (error) => {
        console.log(`⚠️ Player ${player.id} error:`, error.message);
        handleDisconnect(player);
    });
});

// ==================== مدیریت پیام‌ها ====================
function handleMessage(player, message) {
    switch(message.type) {
        case 'pong':
            const ping = Date.now() - message.time;
            player.ping = ping;
            player.send({ type: 'ping_result', ping: ping });
            break;
            
        case 'search':
            handleSearch(player);
            break;
            
        case 'answer':
            handleAnswer(player, message);
            break;
            
        case 'chat':
            handleChat(player, message);
            break;
            
        case 'leave':
            handleLeave(player);
            break;
            
        default:
            console.log(`⚠️ Unknown message type from ${player.id}:`, message.type);
    }
}

// ==================== مچ میکینگ پیشرفته ====================
function handleSearch(player) {
    if (player.roomId) {
        player.send({ type: 'error', message: 'You are already in a game!' });
        return;
    }
    
    // حذف بازیکن از صف انتظار اگر قبلاً وجود داشت
    waitingPlayers = waitingPlayers.filter(p => p !== player);
    
    if (waitingPlayers.length > 0) {
        // پیدا کردن حریف
        const opponent = waitingPlayers.shift();
        
        // ایجاد اتاق بازی
        const game = new GameRoom(opponent, player);
        
        console.log(`🎯 Game ${game.id} started: White=${opponent.id}, Black=${player.id}`);
        
        // ارسال نقش‌ها
        opponent.send({ type: 'role', color: opponent.color });
        player.send({ type: 'role', color: player.color });
        
        // شروع بازی
        opponent.send({ type: 'start', round: 1 });
        player.send({ type: 'start', round: 1 });
        
        // اطلاع به هر دو بازیکن
        game.broadcast({ type: 'game_start', opponent: opponent.id });
        
    } else {
        // اضافه کردن به صف انتظار
        waitingPlayers.push(player);
        player.send({ type: 'search_start' });
        console.log(`🔍 Player ${player.id} waiting for opponent...`);
    }
}

// ==================== مدیریت پاسخ‌ها ====================
function handleAnswer(player, message) {
    if (!player.roomId) return;
    
    const game = activeGames.get(player.roomId);
    if (!game || game.status !== 'playing') return;
    
    const opponent = game.getOpponent(player);
    
    // به‌روزرسانی امتیاز
    player.score = message.score;
    game.updateScore(player, message.score);
    
    // ارسال امتیاز به حریف
    opponent.send({ 
        type: 'answer', 
        correct: message.correct, 
        score: player.score 
    });
    
    // اگر دور 10 تمام شد، بازی را پایان بده
    if (message.round >= 10) {
        endGame(game);
    }
}

// ==================== مدیریت چت ====================
function handleChat(player, message) {
    if (!player.roomId) return;
    
    const game = activeGames.get(player.roomId);
    if (!game) return;
    
    const opponent = game.getOpponent(player);
    opponent.send({ type: 'chat', message: message.message, sender: player.id });
}

// ==================== پایان بازی ====================
function endGame(game) {
    game.status = 'ended';
    
    const p1Score = game.scores[game.player1.id];
    const p2Score = game.scores[game.player2.id];
    const winner = p1Score > p2Score ? game.player1 : (p2Score > p1Score ? game.player2 : null);
    
    game.broadcast({ 
        type: 'game_end', 
        scores: { [game.player1.id]: p1Score, [game.player2.id]: p2Score },
        winner: winner ? winner.id : null
    });
    
    // پاک کردن اتاق
    game.player1.roomId = null;
    game.player2.roomId = null;
    game.end();
    
    console.log(`🏆 Game ${game.id} ended. Winner: ${winner ? winner.id : 'Draw'}`);
}

// ==================== مدیریت قطع اتصال ====================
function handleDisconnect(player) {
    if (!players.has(player.id)) return;
    
    player.disconnect();
    players.delete(player.id);
    stats.activeConnections--;
    
    // حذف از صف انتظار
    waitingPlayers = waitingPlayers.filter(p => p !== player);
    
    // اگر در بازی بود، به حریف اطلاع بده
    if (player.roomId) {
        const game = activeGames.get(player.roomId);
        if (game) {
            const opponent = game.getOpponent(player);
            opponent.send({ type: 'opponent_left' });
            game.end();
            console.log(`💀 Player ${player.id} left game ${game.id}`);
        }
    }
    
    console.log(`📊 Stats - Active: ${stats.activeConnections}, Games: ${stats.activeGames}`);
}

function handleLeave(player) {
    if (player.roomId) {
        const game = activeGames.get(player.roomId);
        if (game) {
            const opponent = game.getOpponent(player);
            opponent.send({ type: 'opponent_left', message: 'Opponent left the game' });
            game.end();
        }
        player.roomId = null;
    }
    player.send({ type: 'left' });
}

// ==================== آمار سرور ====================
setInterval(() => {
    console.log(`📊 SERVER STATS - Connections: ${stats.activeConnections}, Games: ${stats.activeGames}, Waiting: ${waitingPlayers.length}`);
}, 30000);

// ==================== سلامت سرور ====================
process.on('uncaughtException', (error) => {
    console.log('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('❌ Unhandled Rejection:', reason);
});

// ==================== شروع سرور ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 WebSocket endpoint: ws://localhost:${PORT}`);
});